// 以苒纪 — 工作区媒体目录布局（唯一真理源）
//
// 工作区下的所有媒体统一放在 media/ 里，按类型分目录存放：
//
//   media/photo/<id>.<ext>                  照片原图（原样保存，不压缩）
//   media/avatar/circle/<id>_cropped.png    圆形头像（由原图裁剪而来）
//   media/avatar/rect/<id>_cropped.jpg      方形形象照（由原图裁剪而来）
//   media/video/<id>.<ext>                  视频
//   media/video/<id>_thumb.jpg              视频封面
//   media/audio/<id>.<ext>                  音频
//
// <id> 一律为 UUID；相对路径统一用 '/' 分隔，落盘时由 saveMediaFile 负责建目录。

/** 按类型分子目录的媒体种类 */
export type MediaKind = 'photo' | 'video' | 'audio';

/** 头像裁剪形态：circle 圆形头像 / rect 方形形象照 */
export type AvatarMode = 'circle' | 'rect';

/** media 目录名 */
export const MEDIA_ROOT = 'media';

/** 裁剪图的扩展名：圆形头像走 png（保留透明圆角），形象照走 jpg */
export const AVATAR_DEFAULT_EXT: Record<AvatarMode, string> = {
  circle: 'png',
  rect: 'jpg',
};

/** 生成一个新的媒体 ID */
export function newMediaId(): string {
  return crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2);
}

/** 照片原图在 media/ 下的相对路径 */
export function photoRelPath(id: string, ext: string): string {
  return `photo/${id}.${ext}`;
}

/** 头像裁剪图在 media/ 下的相对路径 */
export function avatarRelPath(mode: AvatarMode, id: string, ext: string): string {
  return `avatar/${mode}/${id}_cropped.${ext}`;
}

/** 视频 / 音频等按类型分目录的媒体在 media/ 下的相对路径 */
export function mediaRelPath(kind: MediaKind, id: string, ext: string): string {
  return `${kind}/${id}.${ext}`;
}

/** 视频封面在 media/ 下的相对路径（与视频同 ID、同目录） */
export function videoThumbRelPath(id: string): string {
  return `video/${id}_thumb.jpg`;
}

/** 相对路径 → 工作区绝对路径 */
export function mediaAbsPath(workspacePath: string, relPath: string): string {
  return `${workspacePath}/${MEDIA_ROOT}/${relPath}`;
}

/** 从 data URL 中取出扩展名，取不到时用 fallback */
export function dataUrlExt(dataUrl: string, fallback = 'jpg'): string {
  const match = dataUrl.match(/^data:image\/([a-zA-Z0-9+.-]+);base64/);
  if (!match || !match[1]) return fallback;
  const raw = match[1].toLowerCase();
  return raw === 'jpeg' ? 'jpg' : raw.replace(/[^a-z0-9]/g, '') || fallback;
}
