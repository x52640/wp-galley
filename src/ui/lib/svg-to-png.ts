/**
 * SVG → PNG。
 *
 * 為什麼要有這個檔：**WordPress 核心不收 SVG**（SVG 可以內嵌 script，是已知的
 * 攻擊面），要開啟只能裝外掛或改 PHP，兩件事這個專案都明文禁止。所以使用者選了
 * SVG 檔的時候，一律先在瀏覽器裡轉成 PNG 再上傳。
 *
 * ⚠️ 目前**只有使用者手動選檔**會走到這裡。沒有任何程式碼會讓 Agent 產出 SVG——
 * 那是還沒做的事（見 plan.md Q-4、Q-6）。這段註解以前寫成「或 Agent
 * 產出 SVG 時」，讓人以為一鍵配圖會生圖，已經改掉。
 *
 * 不需要任何套件——瀏覽器本來就會：`<img>` 載入 SVG、`canvas.drawImage` 光柵化、
 * `canvas.toBlob` 輸出 PNG。
 *
 * 順帶一提，這條路徑也比較安全：`<img>` 載入的 SVG **不會執行裡面的 script**，
 * 也不會載入外部資源。轉出來的 PNG 是純點陣資料，沒有任何可執行的東西。
 */

export interface SvgToPngResult {
  blob: Blob;
  filename: string;
  width: number;
  height: number;
}

export interface SvgToPngOptions {
  /** 輸出寬度上限。1600 對應站上大圖的實際使用尺寸。 */
  maxWidth?: number;
  /** 沒指定尺寸時的預設寬度。 */
  fallbackWidth?: number;
  /** 透明底填成白色。文章插圖多半要，圖示不用。 */
  background?: string | null;
}

export class SvgConvertError extends Error {
  override readonly name = 'SvgConvertError';
}

export function isSvgFile(file: File | Blob, name?: string): boolean {
  const filename = name ?? (file instanceof File ? file.name : '');
  return file.type === 'image/svg+xml' || filename.toLowerCase().endsWith('.svg');
}

/** 把 `120`、`120px`、`7.5rem` 這種值取出數字；取不到就回 null。 */
function toNumber(raw: string | null): number | null {
  if (!raw) return null;
  const match = /^\s*(-?[\d.]+)\s*(px)?\s*$/.exec(raw);
  if (!match?.[1]) return null;
  const value = Number.parseFloat(match[1]);
  return Number.isFinite(value) && value > 0 ? value : null;
}

interface Intrinsic {
  width: number;
  height: number;
  /** 補過 width／height 屬性的 SVG 原始碼。缺尺寸時 Safari 會畫成 0×0。 */
  markup: string;
}

function measure(svgText: string, fallbackWidth: number): Intrinsic {
  const doc = new DOMParser().parseFromString(svgText, 'image/svg+xml');
  const root = doc.documentElement;
  if (root.nodeName === 'parsererror' || root.nodeName.toLowerCase() !== 'svg') {
    throw new SvgConvertError('這個檔案不是有效的 SVG，無法轉檔。請換一個檔案，或直接提供 PNG。');
  }

  let width = toNumber(root.getAttribute('width'));
  let height = toNumber(root.getAttribute('height'));

  const viewBox = root.getAttribute('viewBox')?.trim().split(/[\s,]+/).map(Number);
  const boxWidth = viewBox?.length === 4 ? viewBox[2] : undefined;
  const boxHeight = viewBox?.length === 4 ? viewBox[3] : undefined;
  const ratio =
    boxWidth !== undefined && boxHeight !== undefined && boxWidth > 0 && boxHeight > 0
      ? boxHeight / boxWidth
      : null;

  if (width === null && height === null) {
    width = boxWidth && boxWidth > 0 ? boxWidth : fallbackWidth;
    height = ratio !== null ? width * ratio : width;
  } else if (width === null) {
    width = ratio !== null && height !== null ? height / ratio : fallbackWidth;
  } else if (height === null) {
    height = ratio !== null ? width * ratio : width;
  }

  root.setAttribute('width', String(width));
  root.setAttribute('height', String(height));
  if (!root.getAttribute('xmlns')) root.setAttribute('xmlns', 'http://www.w3.org/2000/svg');

  return {
    width: width ?? fallbackWidth,
    height: height ?? fallbackWidth,
    markup: new XMLSerializer().serializeToString(root),
  };
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () =>
      reject(
        new SvgConvertError(
          'SVG 畫不出來。常見原因是檔案裡引用了外部字型或圖片——請把它們嵌進檔案，或直接提供 PNG。',
        ),
      );
    image.src = url;
  });
}

export async function svgToPng(
  source: Blob | string,
  filename: string,
  options: SvgToPngOptions = {},
): Promise<SvgToPngResult> {
  const { maxWidth = 1600, fallbackWidth = 1200, background = '#FFFFFF' } = options;

  const svgText = typeof source === 'string' ? source : await source.text();
  const intrinsic = measure(svgText, fallbackWidth);

  const scale = intrinsic.width > maxWidth ? maxWidth / intrinsic.width : 1;
  const width = Math.max(1, Math.round(intrinsic.width * scale));
  const height = Math.max(1, Math.round(intrinsic.height * scale));

  // blob: 是同源的，畫進 canvas 不會把它汙染成 tainted，toBlob 才拿得到資料。
  const url = URL.createObjectURL(new Blob([intrinsic.markup], { type: 'image/svg+xml;charset=utf-8' }));
  try {
    const image = await loadImage(url);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new SvgConvertError('這個瀏覽器沒有 canvas 2D，無法轉檔。');

    if (background !== null) {
      context.fillStyle = background;
      context.fillRect(0, 0, width, height);
    }
    context.drawImage(image, 0, 0, width, height);

    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob) throw new SvgConvertError('PNG 輸出失敗，請再試一次。');

    return {
      blob,
      filename: filename.replace(/\.svg$/i, '') + '.png',
      width,
      height,
    };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** 上傳前的統一入口：SVG 轉 PNG，其他格式原樣通過。 */
export async function prepareForUpload(
  file: File,
): Promise<{ blob: Blob; filename: string; converted: boolean }> {
  if (!isSvgFile(file)) return { blob: file, filename: file.name, converted: false };
  const result = await svgToPng(file, file.name);
  return { blob: result.blob, filename: result.filename, converted: true };
}
