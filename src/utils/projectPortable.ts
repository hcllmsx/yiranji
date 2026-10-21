// 以苒纪 — 工作区路径工具
import type { FamilyProject, Person } from '../types';

/**
 * 递归修复工程数据中指向 media/ 的媒体绝对路径。
 * 典型场景：从别处移动或拷贝整个家谱文件夹后，路径中的绝对路径需要重基为新工作区路径。
 */
export function rebaseMediaPathsToWorkspace(
  project: FamilyProject,
  workspacePath: string,
  onChange?: () => void
): FamilyProject {
  const normalized = workspacePath.replace(/[\\/]+/g, '/').replace(/\/+$/, '');
  const base = `${normalized}/media/`;
  const MEDIA_MARK = '/media/';

  const fix = (value?: string): string | undefined => {
    if (!value) return value;
    if (value.startsWith('data:') || value.startsWith('http') || value.startsWith('blob:')) {
      return value;
    }
    const posix = value.replace(/\\/g, '/');
    const idx = posix.lastIndexOf(MEDIA_MARK);
    const relative = idx >= 0 ? posix.slice(idx + MEDIA_MARK.length) : posix.split('/').pop() || '';
    if (!relative) return value;
    const target = base + relative;
    // 已经是本机正确路径就不动，避免无意义改写
    if (target === posix) return value;
    onChange?.();
    return target;
  };

  Object.values(project.persons || {}).forEach((person: Person) => {
    person.avatar = fix(person.avatar);
    person.avatarRect = fix(person.avatarRect);

    (person.photos || []).forEach((photo) => {
      photo.path = fix(photo.path) as string;
    });
    (person.audioFiles || []).forEach((audio) => {
      audio.path = fix(audio.path) as string;
    });
    (person.videoFiles || []).forEach((video) => {
      video.path = fix(video.path) as string;
      video.thumbnail = fix(video.thumbnail);
    });
  });

  return project;
}
