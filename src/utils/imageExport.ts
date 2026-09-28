// 以苒纪 — 家谱树导出图片（JPG / PNG）
//
// 流程：DOM 实测包围盒 → html-to-image 高清位图渲染 → Canvas 叠加品牌角标
// （logo + 「以苒纪」文字）→ JPG 采用 Squoosh 系 MozJPEG（@jsquash/jpeg）有损压缩，
// PNG 采用 Oxipng（@jsquash/oxipng）无损优化；WASM 编解码失败时自动回退浏览器原生编码。
//
// 许可合规：@jsquash 系列（Apache-2.0）及其底层编解码器（MozJPEG、Oxipng）
// 均允许商用与闭源集成，详见 docs/THIRD_PARTY_LICENSES.md。

import { toPng } from 'html-to-image';
import {
  BRAND_LOGO_URL,
  BRAND_TEXT,
  EXPORT_BACKGROUND,
  EXPORT_PAD_PX,
  MAX_CANVAS_PX,
  getTreeDomBounds,
  getTreeViewport,
  inlineImagesAsDataUrl,
  fetchAsDataUrl,
  arrayBufferToBase64,
  saveExportFile,
} from './exportUtils';

/** JPG 质量（Squoosh MozJPEG 风格，0-100） */
const JPEG_QUALITY = 92;
/** 支持的渲染倍率档位 */
export type RenderScale = 1 | 2 | 3 | 4;

export interface ImageExportResult {
  status: 'saved' | 'cancelled';
  /** 倍率被自动回退时的提示信息 */
  warning?: string;
}

/**
 * 加载品牌 logo 为 Image 元素（Canvas 绘制用）
 */
async function loadLogoImage(): Promise<HTMLImageElement | null> {
  const dataUrl = await fetchAsDataUrl(BRAND_LOGO_URL);
  if (!dataUrl) return null;
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = dataUrl;
  });
}

/**
 * 在渲染完成的画布右下角绘制品牌角标（logo + 「以苒纪」文字）
 * 尺寸随渲染倍率缩放，保证不同清晰度下视觉大小一致。
 */
function drawBrandBadge(
  ctx: CanvasRenderingContext2D,
  canvasW: number,
  canvasH: number,
  scale: number,
  logoImg: HTMLImageElement | null
) {
  const fontSize = Math.max(13, Math.round(15 * scale));
  const logoSize = Math.round(fontSize * 1.25);
  const paddingX = Math.round(fontSize * 0.7);
  const paddingY = Math.round(fontSize * 0.5);
  const margin = Math.round(fontSize * 0.9);
  const gap = Math.round(fontSize * 0.45);

  const textW = ctx.measureText(BRAND_TEXT).width;
  const hasLogo = !!logoImg;
  const boxW = textW + paddingX * 2 + (hasLogo ? logoSize + gap : 0);
  const boxH = Math.max(fontSize, logoSize) + paddingY * 2;
  const boxX = canvasW - boxW - margin;
  const boxY = canvasH - boxH - margin;
  const radius = Math.round(boxH / 2);

  // 半透明暖纸色圆角胶囊底
  ctx.fillStyle = 'rgba(250, 249, 245, 0.85)';
  ctx.beginPath();
  if (typeof ctx.roundRect === 'function') {
    ctx.roundRect(boxX, boxY, boxW, boxH, radius);
  } else {
    ctx.rect(boxX, boxY, boxW, boxH);
  }
  ctx.fill();

  // logo（垂直居中于胶囊）
  let cursorX = boxX + paddingX;
  if (logoImg) {
    const logoY = boxY + (boxH - logoSize) / 2;
    ctx.drawImage(logoImg, cursorX, logoY, logoSize, logoSize);
    cursorX += logoSize + gap;
  }

  // 品牌文字
  ctx.font = `500 ${fontSize}px "Microsoft YaHei", "PingFang SC", "Noto Sans SC", sans-serif`;
  ctx.fillStyle = 'rgba(80, 68, 55, 0.72)';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(BRAND_TEXT, cursorX, boxY + boxH / 2 + 1);
}

/**
 * 将 Blob 编码为 ArrayBuffer
 */
function blobToArrayBuffer(blob: Blob): Promise<ArrayBuffer> {
  return blob.arrayBuffer();
}

/**
 * 用 @jsquash/jpeg（MozJPEG WASM）编码 JPG，失败回退浏览器原生编码
 */
async function encodeJpeg(canvas: HTMLCanvasElement): Promise<ArrayBuffer> {
  try {
    const { encode } = await import('@jsquash/jpeg');
    const imageData = canvas
      .getContext('2d')!
      .getImageData(0, 0, canvas.width, canvas.height);
    return await encode(imageData, { quality: JPEG_QUALITY });
  } catch (e) {
    console.warn('MozJPEG 编码不可用，回退浏览器原生 JPEG 编码:', e);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY / 100)
    );
    if (!blob) throw new Error('JPEG 编码失败');
    return blobToArrayBuffer(blob);
  }
}

/**
 * 用 @jsquash/oxipng 无损优化 PNG，失败或无收益时回退原生编码
 */
async function encodePng(canvas: HTMLCanvasElement): Promise<ArrayBuffer> {
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/png')
  );
  if (!blob) throw new Error('PNG 编码失败');
  const raw = await blobToArrayBuffer(blob);

  try {
    const { optimise } = await import('@jsquash/oxipng');
    const optimised = await optimise(raw, { level: 2 });
    // 仅当优化确有收益时采用优化结果
    if (optimised.byteLength > 0 && optimised.byteLength < raw.byteLength) {
      return optimised;
    }
    return raw;
  } catch (e) {
    console.warn('Oxipng 优化不可用，使用浏览器原生 PNG 编码:', e);
    return raw;
  }
}

/**
 * 导出当前家谱树画布为 JPG / PNG 图片
 *
 * @param format      目标格式
 * @param renderScale 渲染倍率（1x ~ 4x），超过画布安全上限时自动回退并在返回值中提示
 * @param defaultName 默认保存文件名
 */
export async function exportTreeImage(
  format: 'jpg' | 'png',
  renderScale: RenderScale,
  defaultName: string
): Promise<ImageExportResult> {
  const viewportEl = getTreeViewport();
  if (!viewportEl) {
    throw new Error('未找到家谱树画布，请先进入家谱树页面');
  }

  const bounds = getTreeDomBounds(viewportEl);
  const logicalW = bounds.width + EXPORT_PAD_PX * 2;
  const logicalH = bounds.height + EXPORT_PAD_PX * 2;

  // 倍率回退：画布任一边超过安全上限时按比例缩小
  const maxSide = Math.max(logicalW, logicalH);
  const actualScale = Math.min(renderScale, MAX_CANVAS_PX / maxSide);
  const warning =
    actualScale < renderScale
      ? `家谱图幅面较大，渲染倍率已自动从 ${renderScale}x 回退至 ${actualScale.toFixed(1)}x`
      : undefined;

  const canvasW = Math.ceil(logicalW * actualScale);
  const canvasH = Math.ceil(logicalH * actualScale);

  // 头像等本地资源预取为 data URL，避免跨域渲染空白
  const restoreImages = await inlineImagesAsDataUrl(viewportEl);

  let pngDataUrl: string;
  try {
    pngDataUrl = await toPng(viewportEl, {
      backgroundColor: EXPORT_BACKGROUND,
      width: canvasW,
      height: canvasH,
      pixelRatio: 1,
      skipFonts: true,
      style: {
        width: `${canvasW}px`,
        height: `${canvasH}px`,
        transformOrigin: '0 0',
        // 整棵树平移缩放进画布：左上角对齐 + 四周留白
        transform: `translate(${(-bounds.x + EXPORT_PAD_PX) * actualScale}px, ${
          (-bounds.y + EXPORT_PAD_PX) * actualScale
        }px) scale(${actualScale})`,
      },
    });
  } finally {
    restoreImages();
  }

  // 载入 canvas 并叠加品牌角标
  const renderedImg = await new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('渲染结果载入失败'));
    img.src = pngDataUrl;
  });

  const canvas = document.createElement('canvas');
  canvas.width = canvasW;
  canvas.height = canvasH;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(renderedImg, 0, 0, canvasW, canvasH);

  // 先设置字体再测量（drawBrandBadge 内部也会重设，此处仅为统一）
  ctx.font = `500 ${Math.max(13, Math.round(15 * actualScale))}px "Microsoft YaHei", sans-serif`;
  const logoImg = await loadLogoImage();
  drawBrandBadge(ctx, canvasW, canvasH, actualScale, logoImg);

  // 编码（JPG 走 MozJPEG，PNG 走原生 + Oxipng 优化）
  const buffer = format === 'jpg' ? await encodeJpeg(canvas) : await encodePng(canvas);
  const base64 = arrayBufferToBase64(buffer);

  const status = await saveExportFile(
    defaultName,
    format === 'jpg' ? 'JPEG 图片 (*.jpg)' : 'PNG 图片 (*.png)',
    [format],
    base64
  );

  return { status, warning };
}
