// 以苒纪 — 应用级偏好设置（与具体家谱项目无关，存 localStorage）
//
// 目前包含：
// - defaultSaveDir：新建家谱档案时的默认父目录（用户可在"设置 → 档案存储"中修改）
// - treeLayoutMode：家谱树节点布局方式（经典模式：主脉居中、长幼错落；同辈齐平：同高拉齐、从左到右）
// - treeDisplayMode：家谱树亲子连线的显示模式（用户可在"设置 → 家谱树显示"中切换）

const PREFS_KEY = 'yiranji_app_prefs';

/** 家谱树节点布局方式：
 * - classic（经典模式，默认）：以主视角一脉为中心或偏左，其他脉左右交替排开；同辈手足纵向有 50px 阶梯高低差
 * - aligned（同辈齐平）：同辈所有成员在同一高度绝对齐平，从左到右平铺排序
 */
export type TreeLayoutMode = 'classic' | 'aligned';

/** 家谱树节点布局变更事件（通知 TreePage 重建图） */
export const TREE_LAYOUT_MODE_EVENT = 'yiranji-tree-layout-mode-changed';

/** 家谱树亲子连线显示模式：
 * - classic（经典模式）：原版连线——生父/生母各画一条完整 smoothstep，无固定称呼标签
 * - enhanced（增强模式）：生父/生母称呼标签固定贴在家长卡片下沿，且父母双方连线
 *   的横杠只画一次（远端家长边在 junction 竖线处截断），避免高亮虚线互补成"假实线"
 */
export type TreeDisplayMode = 'classic' | 'enhanced';

/** 家谱树显示模式变更时派发的自定义事件名（跨页面通知 TreePage 重建图） */
export const TREE_DISPLAY_MODE_EVENT = 'yiranji-tree-display-mode-changed';

export interface AppPrefs {
  /** 新建档案默认保存到的父目录；为空表示每次新建都弹出选择框 */
  defaultSaveDir?: string;
  /** 家谱树节点布局模式；未设置视为 classic（经典模式，原版行为） */
  treeLayoutMode?: TreeLayoutMode;
  /** 家谱树显示模式；未设置视为 classic（与原版行为一致） */
  treeDisplayMode?: TreeDisplayMode;
}

export function getAppPrefs(): AppPrefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    return parsed as AppPrefs;
  } catch {
    return {};
  }
}

function saveAppPrefs(prefs: AppPrefs) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // localStorage 不可用时静默失败
  }
}

/** 读取默认保存目录（未设置返回空字符串） */
export function getDefaultSaveDir(): string {
  return getAppPrefs().defaultSaveDir || '';
}

/** 设置默认保存目录；传空字符串表示清除（恢复为每次询问） */
export function setDefaultSaveDir(dir: string) {
  const prefs = getAppPrefs();
  if (dir) {
    prefs.defaultSaveDir = dir;
  } else {
    delete prefs.defaultSaveDir;
  }
  saveAppPrefs(prefs);
}

/** 取路径的最后一级目录名，用于界面提示 */
export function getFolderName(path: string): string {
  if (!path) return '';
  const normalized = path.replace(/[\\/]+$/, '');
  const idx = Math.max(normalized.lastIndexOf('/'), normalized.lastIndexOf('\\'));
  return idx === -1 ? normalized : normalized.slice(idx + 1);
}

/** 读取家谱树节点布局方式（未设置返回 classic，即原版行为） */
export function getTreeLayoutMode(): TreeLayoutMode {
  return getAppPrefs().treeLayoutMode === 'aligned' ? 'aligned' : 'classic';
}

/** 设置家谱树节点布局方式，并广播变更事件（TreePage 监听后重建图） */
export function setTreeLayoutMode(mode: TreeLayoutMode) {
  const prefs = getAppPrefs();
  prefs.treeLayoutMode = mode;
  saveAppPrefs(prefs);
  try {
    window.dispatchEvent(new CustomEvent(TREE_LAYOUT_MODE_EVENT, { detail: mode }));
  } catch {
    // 环境不支持 CustomEvent 时忽略
  }
}

/** 读取家谱树连线显示模式（未设置返回 classic，即原版行为） */
export function getTreeDisplayMode(): TreeDisplayMode {
  return getAppPrefs().treeDisplayMode === 'enhanced' ? 'enhanced' : 'classic';
}

/** 设置家谱树连线显示模式，并广播变更事件（TreePage 监听后重建图） */
export function setTreeDisplayMode(mode: TreeDisplayMode) {
  const prefs = getAppPrefs();
  prefs.treeDisplayMode = mode;
  saveAppPrefs(prefs);
  try {
    window.dispatchEvent(new CustomEvent(TREE_DISPLAY_MODE_EVENT, { detail: mode }));
  } catch {
    // 环境不支持 CustomEvent 时忽略（下次进入家谱树页面也会读到新值）
  }
}
