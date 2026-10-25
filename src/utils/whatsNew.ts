// 以苒纪 — 本次更新内容
//
// release-notes.json 随安装包一起打包，因此升级后首次启动无需联网即可展示
// 当前版本的更新说明。启动时对比 settings.json 里记录的上次运行版本：
// - 全新安装（无记录）：只记录版本，不打扰；
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

/**
 * 启动时判断是否需要展示「本次更新内容」。
 * 无论是否展示，都会把当前版本写回 lastRunVersion，避免下次重复判断。
 */
export function getStartupReleaseNotes(): ReleaseNotes | null {
  const prefs = getAppPrefs();
  const currentVersion = __APP_VERSION__;
  const previousVersion = prefs.lastRunVersion;

  if (!previousVersion) {
    // 全新安装：记录版本但不弹窗
    saveAppPrefs({ ...prefs, lastRunVersion: currentVersion });
    return null;
  }

  if (previousVersion === currentVersion) {
    return null;
  }

  saveAppPrefs({ ...prefs, lastRunVersion: currentVersion });
  return getBundledReleaseNotes();
}
