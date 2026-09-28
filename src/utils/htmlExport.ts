// 以苒纪 — 家谱导出 HTML（思维导图 / 大纲形态）
//
// 不做卡片图谱、不做坐标计算：以最年长的祖先为根，子女逐级向右缩进，
// 输出纯静态的嵌套列表（标准 CSS 树形连接线，全员展开状态）。
// 纯文本行 + 系统默认字体，零 JS 零依赖，单文件离线打开，
// 矢量文字、可搜索、可复制，页面随内容自然流动，无横竖滚动裁剪问题。

import type { Person } from '../types';
import { getFullName, getLifeSpan, formatAge } from './index';
import { useFamilyStore } from '../store/familyStore';
import {
  BRAND_AUTHOR,
  BRAND_LOGO_URL,
  BRAND_TEXT,
  BRAND_WEBSITE,
  fetchAsDataUrl,
  textToBase64,
  saveExportFile,
  type SaveResult,
} from './exportUtils';

/** HTML 转义 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** 成员显示名（含脱敏处理） */
function displayName(
  person: Person,
  anonymized: boolean,
  anonymizedNames: Record<string, string>
): string {
  if (anonymized) return anonymizedNames[person.id] || '未知';
  return getFullName(person.surname, person.givenName) || '未命名';
}

/** 生卒/年龄文本 */
function lifeText(person: Person): string {
  if (person.isAlive !== false) {
    return person.birthDateSolar ? formatAge(person.birthDateSolar) : '';
  }
  return getLifeSpan(person.birthDateSolar, person.deathDateSolar, person.isAlive);
}

/**
 * 胶囊配色档位（四类身份各用一个独立色相，一眼可辨）：
 * - clan  本宗成员      → 蓝
 * - in    嫁入/入赘配偶 → 红
 * - out   外嫁本宗      → 紫
 * - other 外姓分支      → 绿
 */
type TagTone = 'clan' | 'in' | 'out' | 'other';

/** 子女的姓氏是否全部随外姓（用于判定外嫁） */
function allChildrenOtherSurname(
  person: Person,
  persons: Record<string, Person>,
  familySurname: string
): boolean {
  const children = (person.relations.children || [])
    .map((c) => persons[c.id])
    .filter((p): p is Person => !!p);
  return children.length > 0 && children.every((c) => c.surname !== familySurname);
}

/**
 * 判断成员所属支系，决定胶囊配色：
 * - 本宗姓氏且子女仍姓本宗（或无子女）→ 本宗（蓝）
 * - 本宗姓氏但子女随外姓 → 外嫁本宗（紫）
 * - 外姓但配偶是本宗（且配偶未外嫁）→ 嫁入/入赘配偶（红）
 * - 其余外姓 → 外姓分支（绿；分支内后代随父系同色）
 */
function classifyTone(
  person: Person,
  persons: Record<string, Person>,
  familySurname: string
): TagTone {
  if (person.surname === familySurname) {
    return allChildrenOtherSurname(person, persons, familySurname) ? 'out' : 'clan';
  }
  const spouses = (person.relations.spouses || [])
    .map((s) => persons[s.id])
    .filter((p): p is Person => !!p);
  const marriedIntoClan = spouses.some(
    (s) => s.surname === familySurname && !allChildrenOtherSurname(s, persons, familySurname)
  );
  return marriedIntoClan ? 'in' : 'other';
}

/** 生成成员/配偶胶囊标签（性别符号 + 姓名 + 年龄，配色由支系决定） */
function renderTag(
  person: Person,
  persons: Record<string, Person>,
  context: RenderContext,
  isSpouse: boolean
): string {
  const tone = classifyTone(person, persons, context.familySurname);
  const name = escapeHtml(displayName(person, context.anonymized, context.anonymizedNames));
  const life = escapeHtml(lifeText(person));
  const mark = isSpouse ? '<span class="sp-mark">♡</span>' : '';
  const sex = `<span class="sex">${person.gender === 'male' ? '♂' : '♀'}</span>`;
  const lifeSpan = life ? `<span class="life">${life}</span>` : '';
  return `<span class="tag tag-${tone}" title="${name}">${mark}${sex}<span class="who">${name}</span>${lifeSpan}</span>`;
}

interface RenderContext {
  perspectiveId?: string;
  anonymized: boolean;
  anonymizedNames: Record<string, string>;
  familySurname: string;
}

/**
 * 递归渲染成员分支（嵌套列表项）
 * 配偶以胶囊标签跟随在成员行尾；每个成员在整棵树中只出现一次
 */
function renderBranch(
  person: Person,
  persons: Record<string, Person>,
  visited: Set<string>,
  context: RenderContext
): string {
  visited.add(person.id);

  const star =
    person.id === context.perspectiveId ? '<span class="star" title="主视角">★</span>' : '';
  const selfTag = renderTag(person, persons, context, false);

  // 配偶（未在其他分支出现过的）
  const spouseParts = (person.relations.spouses || [])
    .map((s) => persons[s.id])
    .filter((sp): sp is Person => !!sp && !visited.has(sp.id))
    .map((sp) => {
      visited.add(sp.id);
      return renderTag(sp, persons, context, true);
    });

  // 子女（按出生日期排序，未在其他分支出现过的）
  const children = (person.relations.children || [])
    .map((c) => persons[c.id])
    .filter((cp): cp is Person => !!cp && !visited.has(cp.id))
    .sort((a, b) =>
      (a.birthDateSolar || '9999').localeCompare(b.birthDateSolar || '9999')
    );

  const childrenBlock = children.length
    ? `<ul>${children.map((c) => renderBranch(c, persons, visited, context)).join('\n')}</ul>`
    : '';

  return `<li><div class="row">${star}${selfTag}${spouseParts.join('')}</div>${childrenBlock}</li>`;
}

/** 品牌徽标 HTML（页脚，logo + 文字，点击跳转官网） */
async function buildBadgeHtml(): Promise<string> {
  const logoDataUrl = await fetchAsDataUrl(BRAND_LOGO_URL);
  const logoImg = logoDataUrl
    ? `<img src="${logoDataUrl}" alt="以苒纪" style="width:18px;height:18px;border-radius:4px;display:block;">`
    : '';
  return `
  <a href="${BRAND_WEBSITE}" target="_blank" rel="noopener noreferrer"
     title="以苒纪 · ${BRAND_WEBSITE}"
     style="display:inline-flex;align-items:center;gap:7px;text-decoration:none;opacity:0.75;">
    ${logoImg}
    <span style="font-size:13px;font-weight:500;color:rgba(80,68,55,0.75);line-height:1;">由 ${BRAND_TEXT} 生成</span>
  </a>`.trim();
}

/**
 * 根据家谱数据导出思维导图形态的单文件 HTML
 *
 * @param defaultName 默认保存文件名（含 .html 扩展名）
 * @param title       页面标题（通常为家族名）
 */
export async function exportTreeHtml(
  defaultName: string,
  title: string
): Promise<SaveResult> {
  const { project, isAnonymized, anonymizedNames } = useFamilyStore.getState();
  if (!project) {
    throw new Error('未打开家谱档案');
  }

  const persons = project.persons;
  const personList = Object.values(persons);
  const context: RenderContext = {
    perspectiveId: project.meta.defaultPerspectiveId,
    anonymized: isAnonymized,
    anonymizedNames,
    familySurname: project.meta.surname,
  };

  // ---- 构建树 ----
  // 根成员判定：无父母记录的人中——
  //   a) 无配偶，或所有配偶也没有父母记录 → 真正的祖辈，作为根
  //     （夫妻双方都没父母记录时，优先让与本家族姓氏一致的一方当根）
  //   b) 存在有父母记录的配偶 → 嫁入/入赘对方家族，归属配偶所在分支，
  //     由对方行以「♡ 名字」呈现（如示例中的王秀兰、林雪琴）
  const hasParents = (p: Person) => !!(p.relations.father || p.relations.mother);
  const familySurname = project.meta.surname;

  const visited = new Set<string>();
  const rootList: string[] = [];

  const rootCandidates = personList.filter(
    (p) => !visited.has(p.id) && !hasParents(p)
  );
  // 双方都无父母记录的夫妻对中，优先本家族姓氏的一方当根
  const sortedCandidates = [...rootCandidates].sort((a, b) => {
    const aMatch = a.surname === familySurname ? 0 : 1;
    const bMatch = b.surname === familySurname ? 0 : 1;
    return aMatch - bMatch;
  });

  for (const person of sortedCandidates) {
    if (visited.has(person.id)) continue;
    const spouses = (person.relations.spouses || [])
      .map((s) => persons[s.id])
      .filter((sp): sp is Person => !!sp);
    // 存在有父母记录的配偶 → 嫁入对方家族，不作为根
    if (spouses.length > 0 && spouses.some((sp) => hasParents(sp))) continue;
    rootList.push(renderBranch(person, persons, visited, context));
  }

  // 兜底：异常数据（环等）中仍未访问到的成员，作为独立分支追加
  for (const person of personList) {
    if (!visited.has(person.id)) {
      rootList.push(renderBranch(person, persons, visited, context));
    }
  }

  const badgeHtml = await buildBadgeHtml();
  const safeTitle = escapeHtml(title);

  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="${BRAND_AUTHOR}">
<meta name="author" content="${BRAND_AUTHOR}">
<meta name="description" content="${safeTitle} · 家谱 · 由以苒纪 (Yiranji) 生成 · ${BRAND_WEBSITE}">
<title>${safeTitle} · 家谱</title>
<style>
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; background: #faf9f5; }
body {
  font-family: 'Microsoft YaHei', 'PingFang SC', 'Noto Sans SC', -apple-system, 'Segoe UI', sans-serif;
  color: #3d3529;
  padding: 48px 32px 40px;
  line-height: 1.6;
}
.wrap { max-width: 860px; margin: 0 auto; }
h1 {
  font-size: 22px;
  font-weight: 600;
  margin: 0 0 6px;
}
.meta-line { font-size: 12px; color: #9a9186; margin: 0; }
/* 副信息居左、颜色图例居右（同一行） */
.meta-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  flex-wrap: wrap;
}
hr { border: none; border-top: 1px solid #e8e2d6; margin: 18px 0 28px; }

/* ===== 树形缩进（标准 CSS 连接线方案，零依赖） ===== */
ul.tree, ul.tree ul {
  list-style: none;
  margin: 0;
  padding-left: 26px;
}
ul.tree { padding-left: 0; }
ul.tree li {
  position: relative;
  padding: 3px 0 3px 22px;
}
/* 纵向连接线 */
ul.tree li::before {
  content: '';
  position: absolute;
  left: 9px;
  top: 0;
  bottom: 0;
  border-left: 1.5px solid #ddd5c6;
}
/* 最后一个子项的纵向线只延伸到行中部 */
ul.tree li:last-child::before {
  height: 17px;
}
/* 横向连接线 */
ul.tree li::after {
  content: '';
  position: absolute;
  left: 9px;
  top: 17px;
  width: 12px;
  border-top: 1.5px solid #ddd5c6;
}
/* 根层不画线 */
ul.tree > li { padding-left: 0; }
ul.tree > li::before, ul.tree > li::after { display: none; }

.row { display: inline-flex; align-items: center; gap: 8px; flex-wrap: wrap; }

/* ===== 成员胶囊标签（配色区分支系） ===== */
.tag {
  display: inline-flex;
  align-items: baseline;
  gap: 7px;
  padding: 2px 12px;
  border-radius: 999px;
  border-width: 1px;
  border-style: solid;
  font-size: 14px;
  line-height: 1.7;
}
.tag .who { font-weight: 600; }
.tag .life { font-size: 11px; opacity: 0.72; }
.tag .sp-mark { opacity: 0.6; }
.tag .sex { font-size: 10px; opacity: 0.55; }

/* 本宗成员 → 蓝 */
.tag-clan {
  background: oklch(97% 0.025 250);
  border-color: oklch(60% 0.14 250);
  color: oklch(42% 0.14 250);
}
/* 嫁入 / 入赘配偶 → 红 */
.tag-in {
  background: oklch(97% 0.03 350);
  border-color: oklch(65% 0.16 350);
  color: oklch(45% 0.16 350);
}
/* 外嫁本宗 → 紫 */
.tag-out {
  background: oklch(97% 0.025 305);
  border-color: oklch(58% 0.17 305);
  color: oklch(45% 0.17 305);
}
/* 外姓分支 → 绿 */
.tag-other {
  background: oklch(97% 0.03 150);
  border-color: oklch(58% 0.13 150);
  color: oklch(42% 0.13 150);
}

/* ===== 颜色图例 ===== */
/* 颜色图例：标题下方独立一行，右对齐 */
.legend {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 16px;
  flex-wrap: wrap;
  font-size: 12px;
  color: #9a9186;
}
.legend-item { display: inline-flex; align-items: center; gap: 6px; }
.legend-item .tag { font-size: 12px; padding: 0 9px; line-height: 1.6; }
.star {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: #b5493a;
  color: #fff;
  font-size: 10px;
  align-self: center;
}
.footer {
  margin-top: 40px;
  padding-top: 20px;
  border-top: 1px solid #e8e2d6;
  display: flex;
  justify-content: center;
}
</style>
</head>
<body>
<div class="wrap">
<h1>${safeTitle}</h1>
<div class="meta-row">
  <p class="meta-line">共 ${personList.length} 位成员 · 全员展开视图 · 生成于 ${new Date().toLocaleDateString('zh-CN')}</p>
  <div class="legend">
    <span class="legend-item"><span class="tag tag-clan">本宗成员</span></span>
    <span class="legend-item"><span class="tag tag-in">嫁入配偶</span></span>
    <span class="legend-item"><span class="tag tag-out">外嫁本宗</span></span>
    <span class="legend-item"><span class="tag tag-other">外姓分支</span></span>
  </div>
</div>
<hr>
<ul class="tree">
${rootList.join('\n')}
</ul>
<div class="footer">
${badgeHtml}
</div>
</div>
</body>
</html>`;

  const base64 = textToBase64(html);
  return saveExportFile(defaultName, 'HTML 网页 (*.html)', ['html'], base64);
}
