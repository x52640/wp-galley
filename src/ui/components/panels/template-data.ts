/**
 * 面板送出前組 templateData 的純函式（P5-T021）。
 *
 * templateData 是**整份取代**，所以現有欄位一定要帶上；但「清空」某個選填欄位時要把那個鍵
 * 拿掉，不能送空字串（schema 的 minLength 會擋），也不能沿用舊值（等於沒清）。
 */

type Data = Readonly<Record<string, unknown>> | null | undefined;

function without(data: Data, key: string): Record<string, unknown> {
  const { [key]: _removed, ...rest } = data ?? {};
  return rest;
}

/** 分類面板：多選（長文 tags）照送陣列；單選（category）清空就拿掉鍵。 */
export function taxonomyTemplateData(data: Data, multiple: boolean, selected: readonly string[]): Record<string, unknown> {
  if (multiple) return { ...(data ?? {}), tags: [...selected] };
  const first = selected[0];
  return first === undefined || first === '' ? without(data, 'category') : { ...(data ?? {}), category: first };
}

/** 原稿面板：標題、正文一定寫；網址片段清空就拿掉鍵，讓 WordPress 自己產生。 */
export function sourceTemplateData(
  data: Data,
  fields: { readonly title: string; readonly body: string; readonly slug: string },
): Record<string, unknown> {
  const rest = without(data, 'slug');
  return { ...rest, title: fields.title, body: fields.body, ...(fields.slug === '' ? {} : { slug: fields.slug }) };
}
