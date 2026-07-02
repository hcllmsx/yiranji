// 以苒纪 — 核心类型定义

// ==================== 基础类型 ====================

export type Gender = 'male' | 'female';

/** 时间精度：只记录日期 or 精确到时分秒 */
export type TimePrecision = 'date' | 'time';

/** 农历日期 */
export interface LunarDate {
  year: number;
  month: number;       // 绝对月份（1-12），不区分闰
  day: number;
  isLeap: boolean;     // 是否闰月
  monthChinese?: string; // 库返回的中文月名，如"三"或"闰三"
  dayChinese?: string;   // 库返回的中文日名，如"廿三"
}

/** 照片 */
export interface Photo {
  id: string;
  path: string;      // 资源路径（相对路径或 blob URL）
  date?: string;      // 拍摄日期 YYYY-MM-DD
  caption?: string;   // 描述
}

/** 音频文件 */
export interface AudioFile {
  id: string;
  path: string;
  date?: string;
  caption?: string;
}

/** 视频文件 */
export interface VideoFile {
  id: string;
  path: string;
  date?: string;
  caption?: string;
  thumbnail?: string;     // 视频封面缩略图（base64 或路径）
  width?: number;         // 视频原始宽度
  height?: number;        // 视频原始高度
  duration?: number;      // 视频时长（秒）
}

// ==================== 关系类型 ====================

/** 配偶关系类型 */
export type SpouseRelationType = 'married' | 'divorced' | 'deceased';

/** 子女关系类型 */
export type ChildRelationType = 'biological' | 'adopted' | 'step';

/** 配偶关系 */
export interface SpouseRelation {
  id: string;             // 对方的 person id
  type: SpouseRelationType;
  marriageDate?: string;
  divorceDate?: string;
}

/** 子女关系 */
export interface ChildRelation {
  id: string;             // 对方的 person id
  type: ChildRelationType;
}

/** 人物关系集合 */
export interface Relations {
  father?: string;
  mother?: string;
  adoptiveFather?: string;
  adoptiveMother?: string;
  stepFather?: string;
  stepMother?: string;
  spouses: SpouseRelation[];
  children: ChildRelation[];
}

// ==================== 人物 ====================

export interface Person {
  id: string;
  surname: string;            // 姓
  givenName: string;          // 名
  gender: Gender;

  // 出生日期
  birthDateSolar?: string;    // ISO datetime string, e.g. "1990-01-15T08:30:00"
  birthTimePrecision: TimePrecision;
  birthDateLunar?: LunarDate;

  // 逝世日期
  deathDateSolar?: string;
  deathTimePrecision: TimePrecision;
  deathDateLunar?: LunarDate;

  isAlive: boolean;
  birthPlace?: string;
  bio?: string;               // 个人简介

  // 头像
  avatar?: string;            // 头像路径（圆形裁剪，用于家谱树/列表展示）
  avatarRect?: string;        // 头像原始图片路径（矩形/正方形，用于个人信息页左侧展示）
  avatarPhotoDate?: string;   // 头像拍摄日期 YYYY-MM-DD

  // 媒体文件
  photos: Photo[];
  audioFiles: AudioFile[];
  videoFiles: VideoFile[];

  // 关系
  relations: Relations;

  // 是否为默认视角
  isDefaultPerspective: boolean;

  createdAt: string;
  updatedAt: string;
}

// ==================== 家谱元数据 ====================

export interface FamilyMeta {
  version: string;
  familyName: string;         // e.g. "莫氏-以苒纪"
  surname: string;            // e.g. "莫"
  hasPassword: boolean;
  passwordHash?: string;      // 密码安全哈希（加盐）
  createdAt: string;
  updatedAt: string;
  defaultPerspectiveId?: string;
  description?: string;
}

// ==================== 应用状态 ====================

export interface FamilyProject {
  meta: FamilyMeta;
  persons: Record<string, Person>;
  customLayout?: Record<string, { x: number; y: number }>;
}

/** 最近打开的项目记录 */
export interface RecentProject {
  familyName: string;
  surname: string;
  lastOpenedAt: string;
  filePath?: string;          // 将来用于 Tauri 文件路径
  projectId: string;          // localStorage key
}

// ==================== 创建人物的默认值工厂 ====================

export function createDefaultPerson(surname: string): Omit<Person, 'id' | 'createdAt' | 'updatedAt'> {
  return {
    surname,
    givenName: '',
    gender: 'male',
    birthTimePrecision: 'date',
    deathTimePrecision: 'date',
    isAlive: true,
    photos: [],
    audioFiles: [],
    videoFiles: [],
    relations: {
      spouses: [],
      children: [],
    },
    isDefaultPerspective: false,
  };
}

export function createDefaultMeta(surname: string): Omit<FamilyMeta, 'createdAt' | 'updatedAt'> {
  return {
    version: '1.0.0',
    familyName: `${surname}氏-以苒纪`,
    surname,
    hasPassword: false,
  };
}
