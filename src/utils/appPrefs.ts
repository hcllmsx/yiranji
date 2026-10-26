// 以苒纪 — 应用级偏好设置（基于 settings.json 统一管理）
import type {
  AppPrefs,
  TreeLayoutMode,
} from './appSettings';
import {
  getAppPrefs,
  saveAppPrefs,
} from './appSettings';

export type { AppPrefs, TreeLayoutMode };
export { getAppPrefs, saveAppPrefs };

/** 家谱树节点布局变更事件（通知 TreePage 重建图） */
export const TREE_LAYOUT_MODE_EVENT = 'yiranji-tree-layout-mode-changed';

/** 读取默认保存目录（未设置返回空字符串） */
export function getDefaultSaveDir(): string {
  return getAppPrefs().defaultSaveDir || '';
}

/** 设置默认保存目录；传空字符串表示清除（恢复为每次询问） */
export function setDefaultSaveDir(dir: string) {
  const prefs = { ...getAppPrefs() };
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
  const prefs = { ...getAppPrefs() };
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
  const prefs = { ...getAppPrefs() };
  prefs.sampleDismissedVersion = currentAppVersion;
  saveAppPrefs(prefs);
}

/** 在设置页重置：允许在首页再次显示示例家谱按钮 */
export function resetSampleEntry() {
  const prefs = { ...getAppPrefs() };
  delete prefs.sampleDismissedVersion;
  saveAppPrefs(prefs);
}

/** 重大更新提示：本机还没读过才需要弹（读过一次后永久不再打扰） */
export function shouldShowMajorUpdateNotice(): boolean {
  return !getAppPrefs().majorUpdateNoticeDismissed;
}

/** 标记重大更新提示已读 */
export function dismissMajorUpdateNotice() {
  const prefs = { ...getAppPrefs() };
  prefs.majorUpdateNoticeDismissed = true;
  saveAppPrefs(prefs);
}

/** 设置是否在首页显示示例家谱按钮 */
export function setSampleEntryEnabled(enabled: boolean, currentAppVersion: string) {
  const prefs = { ...getAppPrefs() };
  if (enabled) {
    delete prefs.sampleDismissedVersion;
  } else {
    prefs.sampleDismissedVersion = currentAppVersion;
  }
  saveAppPrefs(prefs);
}
