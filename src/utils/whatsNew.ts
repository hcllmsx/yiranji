// 以苒纪 — 本次更新内容
//
// release-notes.json 随安装包一起打包，因此升级后首次启动无需联网即可展示
// 当前版本的更新说明。启动时对比 settings.json 里记录的上次运行版本：
// - 无记录且本机没有历史使用痕迹：视为全新安装，只记录版本、不打扰；
// - 无记录但存在最近项目：是引入版本记录机制之前的老用户，按升级处理；
// - 与上次相同：不展示；
// - 检测到升级：返回内置说明并记录当前版本。
// 说明文件缺失或版本不匹配（如改完 VERSION 还没重新生成）则跳过展示。

import bundledNotes from '../../release-notes.json';
import type { ReleaseNotes, ReleaseNoteSection } from './updateChecker';
import { getAppPrefs, saveAppPrefs } from './appPrefs';

/** 校验并规范化随包内置的说明数据 */
function getBundledReleaseNotes(): ReleaseNotes | null {
  const data = bundledNotes as ReleaseNotes;
  if (data.version !== __APP_VERSION__ || !Array.isArray(data.sections)) {
    return null;
  }

  const sections: ReleaseNoteSection[] = [];
  for (const section of data.sections) {
    if (typeof section?.title !== 'string' || !Array.isArray(section.items)) continue;

    const items = section.items.filter((item): item is string => typeof item === 'string');
    if (items.length > 0) {
      sections.push({ title: section.title, items });
    }
  }

  return sections.length > 0 ? { version: data.version, sections } : null;
}

/** 与 familyStore 的最近项目记录共用同一个键，用于识别引入版本记录机制之前的老用户 */
const RECENT_PROJECTS_KEY = 'yiranji_recent_projects';

function hasLocalHistory(): boolean {
  try {
    return !!localStorage.getItem(RECENT_PROJECTS_KEY);
  } catch {
    return false;
  }
}

/**
 * 启动时判断是否需要展示「本次更新内容」。
 * 无论是否展示，都会把当前版本写回 lastRunVersion，避免下次重复判断。
 */
export function getStartupReleaseNotes(): ReleaseNotes | null {
  const prefs = getAppPrefs();
  const currentVersion = __APP_VERSION__;
  const previousVersion = prefs.lastRunVersion;

  if (!previousVersion) {
    saveAppPrefs({ ...prefs, lastRunVersion: currentVersion });
    return hasLocalHistory() ? getBundledReleaseNotes() : null;
  }

  if (previousVersion === currentVersion) {
    return null;
  }

  saveAppPrefs({ ...prefs, lastRunVersion: currentVersion });
  return getBundledReleaseNotes();
}
