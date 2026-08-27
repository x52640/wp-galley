import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { TemplateManifestSchema, type LoadedTemplate } from './types.js';

/**
 * 模板 registry：從磁碟載入模板資料夾，驗證結構，計算 hash。
 *
 * hash 涵蓋全部五個檔案。每個 revision 會記下當時的模板 hash，
 * 模板改動後仍能辨識舊 revision 是用哪一版渲染的（計畫 §4.1）。
 */

const REQUIRED_FILES = ['manifest.json', 'template.html', 'schema.json', 'rules.md', 'preview.css'] as const;

export class TemplateLoadError extends Error {
  override readonly name = 'TemplateLoadError';
  constructor(
    message: string,
    readonly templateId?: string,
  ) {
    super(message);
  }
}

export interface TemplateRegistry {
  list(): LoadedTemplate[];
  get(id: string): LoadedTemplate;
  has(id: string): boolean;
}

async function loadOne(directory: string, folderName: string): Promise<LoadedTemplate> {
  const contents: Record<string, string> = {};
  for (const file of REQUIRED_FILES) {
    try {
      contents[file] = await readFile(join(directory, file), 'utf8');
    } catch {
      throw new TemplateLoadError(`模板 ${folderName} 缺少 ${file}`, folderName);
    }
  }

  let rawManifest: unknown;
  try {
    rawManifest = JSON.parse(contents['manifest.json']!);
  } catch (error) {
    throw new TemplateLoadError(
      `模板 ${folderName} 的 manifest.json 不是合法 JSON：${error instanceof Error ? error.message : String(error)}`,
      folderName,
    );
  }

  const parsed = TemplateManifestSchema.safeParse(rawManifest);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`);
    throw new TemplateLoadError(`模板 ${folderName} 的 manifest 不合法：\n- ${issues.join('\n- ')}`, folderName);
  }
  const manifest = parsed.data;

  if (manifest.id !== folderName) {
    throw new TemplateLoadError(`模板資料夾名稱是 ${folderName}，但 manifest.id 是 ${manifest.id}；兩者必須相同`, folderName);
  }

  let schema: Record<string, unknown>;
  try {
    schema = JSON.parse(contents['schema.json']!) as Record<string, unknown>;
  } catch (error) {
    throw new TemplateLoadError(
      `模板 ${folderName} 的 schema.json 不是合法 JSON：${error instanceof Error ? error.message : String(error)}`,
      folderName,
    );
  }

  // hash 依固定順序計算，確保跨機器可重現。
  const hasher = createHash('sha256');
  for (const file of REQUIRED_FILES) {
    hasher.update(file);
    hasher.update('\0');
    hasher.update(contents[file]!);
    hasher.update('\0');
  }

  return {
    manifest,
    schema: schema as LoadedTemplate['schema'],
    templateHtml: contents['template.html']!,
    rulesMarkdown: contents['rules.md']!,
    previewCss: contents['preview.css']!,
    hash: hasher.digest('hex'),
    directory,
  };
}

export async function loadTemplateRegistry(templatesRoot: string): Promise<TemplateRegistry> {
  let entries;
  try {
    entries = await readdir(templatesRoot, { withFileTypes: true });
  } catch {
    throw new TemplateLoadError(`找不到模板目錄：${templatesRoot}`);
  }

  const templates = new Map<string, LoadedTemplate>();
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    const template = await loadOne(join(templatesRoot, entry.name), entry.name);
    templates.set(template.manifest.id, template);
  }

  if (templates.size === 0) {
    throw new TemplateLoadError(`模板目錄 ${templatesRoot} 裡沒有任何模板`);
  }

  return {
    list: () => [...templates.values()].sort((a, b) => a.manifest.id.localeCompare(b.manifest.id)),
    has: (id) => templates.has(id),
    get: (id) => {
      const found = templates.get(id);
      if (!found) {
        throw new TemplateLoadError(`找不到模板 ${id}；可用的有：${[...templates.keys()].join('、')}`, id);
      }
      return found;
    },
  };
}
