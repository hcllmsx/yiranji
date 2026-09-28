// 以苒纪 — 导出公共工具
//
// 图片（JPG/PNG）与 HTML 导出共享的逻辑：
// DOM 画布定位与包围盒计算、品牌标识常量、图片 data URL 化、
// 二进制 base64 编码、Tauri 原生保存对话框封装。

import { selectExportFilePath, writeBinaryFile, isTauri } from './tauri';

// ==================== 品牌标识常量 ====================

/** 品牌角标文字 */
export const BRAND_TEXT = '以苒纪';
/** 软件官网 */
export const BRAND_WEBSITE = 'https://github.com/hcllmsx/yiranji';
/** 文件元数据中的软件标识 */
export const BRAND_AUTHOR = '以苒纪 (Yiranji)';
/** 品牌 logo 资源地址（public 目录） */
export const BRAND_LOGO_URL = '/yiranji-logo-512px.png';

// ==================== 画布定位 ====================

/** 画布四周留白（逻辑 px） */
export const EXPORT_PAD_PX = 80;
/** WebView 渲染画布安全上限（px） */
export const MAX_CANVAS_PX = 8192;
/** 页面背景色（与画布主题一致的暖纸色） */
export const EXPORT_BACKGROUND = '#faf9f5';

/**
 * 获取家谱树画布的 viewport 元素（包含全部节点与连线的容器）
 */
export function getTreeViewport(): HTMLElement | null {
  return document.querySelector<HTMLElement>('.react-flow__viewport');
}

/**
 * 轮询等待家谱树画布挂载完成（从其他页面切换到 /tree 后使用）
 * @param timeoutMs 超时时间，默认 10 秒
 */
export async function waitTreeCanvasReady(timeoutMs = 10000): Promise<HTMLElement> {
  const startAt = Date.now();
  while (Date.now() - startAt < timeoutMs) {
    const viewport = getTreeViewport();
    if (viewport && viewport.querySelector('.react-flow__node')) {
      return viewport;
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error('等待家谱树画布加载超时，请重试');
}

/** 画布内容包围盒（React Flow 流坐标系） */
export interface TreeBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * 基于 DOM 实测计算全部人员节点的包围盒。
 *
 * React Flow 的节点包装元素位于 viewport 内，其 computed transform 即为
 * 流坐标系中的位置（viewport 自身的平移缩放不影响子节点 transform）。
 * 该方式与 React 组件状态完全解耦，天然包含用户手动拖拽后的自定义布局。
 */
export function getTreeDomBounds(viewport: HTMLElement): TreeBounds {
  const nodeEls = Array.from(viewport.querySelectorAll<HTMLElement>('.react-flow__node'));
  if (nodeEls.length === 0) {
    throw new Error('画布上没有人员节点，无法导出');
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  nodeEls.forEach((el) => {
    const m = new DOMMatrix(getComputedStyle(el).transform === 'none' ? '' : getComputedStyle(el).transform);
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const x = m.e; // translate X（流坐标）
    const y = m.f; // translate Y（流坐标）

    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x + w);
    maxY = Math.max(maxY, y + h);
  });

  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

// ==================== 图片 / 编码工具 ====================

/**
 * 将任意同源 URL 资源预取为 data URL（用于头像、logo 内联）
 */
export async function fetchAsDataUrl(url: string): Promise<string | null> {
  try {
    const resp = await fetch(url);
    if (!resp.ok) return null;
    const blob = await resp.blob();
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

/**
 * 将容器内所有非 data: 的图片（Tauri asset:// 本地头像等）临时预取并替换为
 * data URL，确保 html-to-image 内嵌渲染时不会因跨域导致头像空白。
 * 返回恢复函数，导出结束后还原原始 src。
 */
export async function inlineImagesAsDataUrl(root: HTMLElement): Promise<() => void> {
  const imgs = Array.from(root.querySelectorAll('img'));
  const restored: Array<{ img: HTMLImageElement; src: string }> = [];

  await Promise.all(
    imgs.map(async (img) => {
      const src = img.getAttribute('src') || '';
      if (!src || src.startsWith('data:')) return;
      const dataUrl = await fetchAsDataUrl(src);
      if (dataUrl) {
        restored.push({ img, src });
        img.setAttribute('src', dataUrl);
      }
    })
  );

  return () => {
    restored.forEach(({ img, src }) => img.setAttribute('src', src));
  };
}

/**
 * ArrayBuffer 分块转 base64（避免大文件栈溢出）
 */
export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const chunk = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)) as unknown as number[]);
  }
  return btoa(binary);
}

/**
 * 文本（UTF-8）转 base64
 */
export function textToBase64(text: string): string {
  return arrayBufferToBase64(new TextEncoder().encode(text).buffer as ArrayBuffer);
}

// ==================== 保存 ====================

export type SaveResult = 'saved' | 'cancelled';

/**
 * 弹出原生保存对话框并将 base64 二进制写入指定路径。
 * 用户取消时返回 'cancelled'。
 */
export async function saveExportFile(
  defaultName: string,
  filterName: string,
  extensions: string[],
  base64Data: string
): Promise<SaveResult> {
  if (!isTauri()) {
    throw new Error('导出功能仅在桌面应用环境下可用');
  }

  const path = await selectExportFilePath(defaultName, filterName, extensions);
  if (!path) return 'cancelled';

  await writeBinaryFile(path, base64Data);
  return 'saved';
}
