// 以苒纪 — 家谱树导出 HTML（单文件网页）
//
// 原理：将 React Flow 画布 DOM 克隆为静态快照，内联全部样式与头像图片，
// 产出双击即可打开的单文件 HTML。文字为浏览器原生矢量渲染，无限缩放
// 均保持清晰，且可搜索、可复制。右下角带品牌角标（logo + 文字 + 官网链接），
// 文件元数据携带以苒纪标识（meta generator / author）。

import {
  BRAND_AUTHOR,
  BRAND_LOGO_URL,
  BRAND_TEXT,
  BRAND_WEBSITE,
  EXPORT_BACKGROUND,
  EXPORT_PAD_PX,
  getTreeDomBounds,
  getTreeViewport,
  inlineImagesAsDataUrl,
  fetchAsDataUrl,
  textToBase64,
  saveExportFile,
  type SaveResult,
} from './exportUtils';

/** HTML 标题与 meta 中的标题 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * 收集当前页面全部可访问的样式表文本，内联进导出 HTML。
 * 跳过 @font-face（相对路径字体在独立文件中无法解析，交由系统字体回退），
 * 跳过跨域样式表（读取 cssRules 会抛异常）。
 */
function collectPageCss(): string {
  const parts: string[] = [];
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      const rules = sheet.cssRules;
      if (!rules) continue;
      for (const rule of Array.from(rules)) {
        // @font-face 的 url() 相对路径在单文件中失效，直接跳过
        if (rule instanceof CSSFontFaceRule) continue;
        parts.push(rule.cssText);
      }
    } catch {
      // 跨域样式表无法读取，跳过
    }
  }
  return parts.join('\n');
}

/**
 * 构建品牌角标 HTML（右下角，logo + 文字，点击跳转官网）
 */
async function buildBadgeHtml(): Promise<string> {
  const logoDataUrl = await fetchAsDataUrl(BRAND_LOGO_URL);
  const logoImg = logoDataUrl
    ? `<img src="${logoDataUrl}" alt="以苒纪" style="width:19px;height:19px;border-radius:4px;display:block;">`
    : '';
  return `
  <a href="${BRAND_WEBSITE}" target="_blank" rel="noopener noreferrer"
     title="以苒纪 · ${BRAND_WEBSITE}"
     style="position:absolute;right:24px;bottom:24px;display:flex;align-items:center;gap:7px;
            padding:7px 14px;background:rgba(250,249,245,0.85);border:1px solid rgba(139,94,60,0.18);
            border-radius:999px;text-decoration:none;box-shadow:0 2px 10px rgba(61,53,41,0.08);
            font-family:'Microsoft YaHei','PingFang SC','Noto Sans SC',sans-serif;">
    ${logoImg}
    <span style="font-size:13px;font-weight:500;color:rgba(80,68,55,0.75);line-height:1;">${BRAND_TEXT}</span>
  </a>`.trim();
}

/**
 * 导出当前家谱树画布为单文件 HTML
 *
 * @param defaultName 默认保存文件名（含 .html 扩展名）
 * @param title       页面标题（通常为家族名）
 */
export async function exportTreeHtml(
  defaultName: string,
  title: string
): Promise<SaveResult> {
  const viewportEl = getTreeViewport();
  if (!viewportEl) {
    throw new Error('未找到家谱树画布，请先进入家谱树页面');
  }

  const bounds = getTreeDomBounds(viewportEl);
  const logicalW = Math.ceil(bounds.width + EXPORT_PAD_PX * 2);
  const logicalH = Math.ceil(bounds.height + EXPORT_PAD_PX * 2);

  // 先将头像等本地资源内联为 data URL，再克隆（克隆体随之携带），随后还原原始 DOM
  const restoreImages = await inlineImagesAsDataUrl(viewportEl);
  let clonedViewport: HTMLElement;
  try {
    clonedViewport = viewportEl.cloneNode(true) as HTMLElement;
  } finally {
    restoreImages();
  }

  // 重置克隆画布的变换：把整棵树平移到左上角并留白（不受任何上限约束）
  clonedViewport.style.transform = `translate(${EXPORT_PAD_PX - bounds.x}px, ${EXPORT_PAD_PX - bounds.y}px)`;
  clonedViewport.style.width = `${logicalW}px`;
  clonedViewport.style.height = `${logicalH}px`;
  clonedViewport.style.position = 'absolute';
  clonedViewport.style.top = '0';
  clonedViewport.style.left = '0';

  const pageCss = collectPageCss();
  const badgeHtml = await buildBadgeHtml();
  const safeTitle = escapeHtml(title);

  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="${BRAND_AUTHOR}">
<meta name="author" content="${BRAND_AUTHOR}">
<meta name="description" content="${safeTitle} · 家谱图 · 由以苒纪 (Yiranji) 生成 · ${BRAND_WEBSITE}">
<title>${safeTitle} · 家谱图</title>
<style>
${pageCss}
/* ===== 导出快照容器样式 ===== */
html, body {
  margin: 0;
  padding: 0;
  width: 100%;
  height: 100%;
  background: ${EXPORT_BACKGROUND};
}
body {
  display: flex;
}
.yrj-export-stage {
  position: relative;
  width: ${logicalW}px;
  height: ${logicalH}px;
  background: ${EXPORT_BACKGROUND};
  overflow: hidden;
  /* margin:auto 实现窗口居中；内容超出窗口时自动回退为靠左，不会裁剪 */
  margin: auto;
  flex-shrink: 0;
}
.yrj-export-stage .react-flow__viewport { pointer-events: none; }
/* xyflow 原样式选择器要求 .react-flow 祖先，导出文档中不存在，此处补齐等效规则，
   否则每条边独立的 <svg> 会回退 300x150 默认尺寸且被裁剪，导致连线不可见 */
.yrj-export-stage .react-flow__edges {
  position: absolute;
  top: 0;
  left: 0;
}
.yrj-export-stage .react-flow__edges svg {
  overflow: visible;
  position: absolute;
  pointer-events: none;
}
</style>
</head>
<body>
<div class="yrj-export-stage">
${clonedViewport.outerHTML}
${badgeHtml}
</div>
</body>
</html>`;

  const base64 = textToBase64(html);
  return saveExportFile(defaultName, 'HTML 网页 (*.html)', ['html'], base64);
}
