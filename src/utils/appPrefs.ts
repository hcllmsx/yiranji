// 以苒纪 — 应用级偏好设置（与具体家谱项目无关，存 localStorage）
//
// 目前包含：
// - defaultSaveDir：新建家谱档案时的默认父目录（用户可在"设置 → 档案存储"中修改）
// - treeLayoutMode：家谱树节点布局方式（经典模式：主脉居中、长幼错落；同辈齐平：同高拉齐、从左到右）

const PREFS_KEY = 'yiranji_app_prefs';

/** 家谱树节点布局方式：
 * - classic（经典模式，默认）：以主视角一脉为中心或偏左，其他脉左右交替排开；同辈手足纵向有 50px 阶梯高低差
 * - aligned（同辈齐平）：同辈所有成员在同一高度绝对齐平，从左到右平铺排序
 */
export type TreeLayoutMode = 'classic' | 'aligned';

/** 家谱树节点布局变更事件（通知 TreePage 重建图） */
export const TREE_LAYOUT_MODE_EVENT = 'yiranji-tree-layout-mode-changed';

export interface AppPrefs {
  /** 新建档案默认保存到的父目录；为空表示每次新建都弹出选择框 */
  defaultSaveDir?: string;
  /** 家谱树节点布局模式；未设置视为 classic（经典模式，原版行为） */
  treeLayoutMode?: TreeLayoutMode;
  /** 已点击体验过示例家谱的软件版本号。为空或不等于当前版本时，首页显示「示例家谱」按钮 */
  sampleDismissedVersion?: string;
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

/** 判断首页是否应该显示「示例家谱」按钮：首次未点击过，或安装了新版本时显示 */
export function shouldShowSampleEntry(currentAppVersion: string): boolean {
  const prefs = getAppPrefs();
  return prefs.sampleDismissedVersion !== currentAppVersion;
}

/** 标记当前版本的示例家谱已被点击过，之后在本版本下不再在首页显示 */
export function dismissSampleEntry(currentAppVersion: string) {
  const prefs = getAppPrefs();
  prefs.sampleDismissedVersion = currentAppVersion;
  saveAppPrefs(prefs);
}

/** 在设置页重置：允许在首页再次显示示例家谱按钮 */
export function resetSampleEntry() {
  const prefs = getAppPrefs();
  delete prefs.sampleDismissedVersion;
  saveAppPrefs(prefs);
}
