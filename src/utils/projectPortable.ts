// 以苒纪 — 工作区路径工具
import { v4 as uuidv4 } from 'uuid';
import type { FamilyProject, Person } from '../types';
import { checkMediaFilesExist } from './tauri';

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

const normPath = (p?: string) => (p || '').replace(/\\/g, '/');

/**
 * 旧数据迁移：早期版本把头像原图以 original.xxx 存放在头像目录里，没有登记到照片栏。
 * 这里把仍然存在的原图登记为带「头像原图」标签的照片。返回是否有改动。
 */
export async function registerLegacyAvatarOriginals(project: FamilyProject): Promise<boolean> {
  type Job = { person: Person; mode: 'circle' | 'rect'; path: string };
  const jobs: Job[] = [];
  Object.values(project.persons || {}).forEach((person) => {
    person.photos = person.photos || [];
    (['circle', 'rect'] as const).forEach((mode) => {
      const cropped = mode === 'circle' ? person.avatar : person.avatarRect;
      if (!cropped || cropped.startsWith('data:') || !/cropped\.[a-z0-9]+$/i.test(cropped)) return;
      if (person.photos.some((p) => p.avatarOriginalFor?.includes(mode))) return;
      jobs.push({ person, mode, path: cropped.replace(/cropped\.([a-z0-9]+)$/i, 'original.$1') });
    });
  });
  if (jobs.length === 0) return false;

  const exists = await checkMediaFilesExist(jobs.map((j) => j.path));
  let changed = false;
  jobs.forEach((job, i) => {
    if (!exists[i]) return;
    let photo = job.person.photos.find((p) => normPath(p.path) === normPath(job.path));
    if (!photo) {
      photo = {
        id: uuidv4(),
        path: job.path,
        date: (job.mode === 'circle' ? job.person.avatarPhotoDate : job.person.avatarRectPhotoDate) || undefined,
      };
      job.person.photos.push(photo);
    }
    photo.avatarOriginalFor = Array.from(new Set([...(photo.avatarOriginalFor || []), job.mode]));
    changed = true;
  });
  return changed;
}
