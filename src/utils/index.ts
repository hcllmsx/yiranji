// 以苒纪 — 工具函数

import { Solar, Lunar } from 'lunar-javascript';
import type { LunarDate } from '../types';

/**
 * 原生 SHA-256 异步哈希辅助函数
 */
export async function sha256(message: string): Promise<string> {
  const msgBuffer = new TextEncoder().encode(message);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// ==================== 日期工具 ====================

/**
 * 公历日期转农历日期
 * lunar-javascript 的 getMonth() 返回负数表示闰月（如 -3 = 闰三月）
 */
export function solarToLunar(solarDateStr: string): LunarDate | null {
  try {
    const date = new Date(solarDateStr);
    if (isNaN(date.getTime())) return null;
    const solar = Solar.fromYmd(date.getFullYear(), date.getMonth() + 1, date.getDate());
    const lunar = solar.getLunar();
    const rawMonth = lunar.getMonth(); // 负数表示闰月
    return {
      year: lunar.getYear(),
      month: Math.abs(rawMonth),
      day: lunar.getDay(),
      isLeap: rawMonth < 0,
      monthChinese: lunar.getMonthInChinese(),
      dayChinese: lunar.getDayInChinese(),
    };
  } catch {
    return null;
  }
}

/**
 * 农历日期转公历日期字符串
 */
export function lunarToSolar(lunar: LunarDate): string | null {
  try {
    // lunar-javascript 的 fromYmd 中，闰月用负数月份
    const month = lunar.isLeap ? -lunar.month : lunar.month;
    const lunarObj = Lunar.fromYmd(lunar.year, month, lunar.day);
    const solar = lunarObj.getSolar();
    return `${solar.getYear()}-${String(solar.getMonth()).padStart(2, '0')}-${String(solar.getDay()).padStart(2, '0')}`;
  } catch {
    return null;
  }
}

/**
 * 格式化农历日期为中文字符串
 * 优先使用库返回的中文名，兜底使用自行计算
 */
export function formatLunarDate(lunar: LunarDate): string {
  const monthName = lunar.monthChinese
    ? `${lunar.monthChinese}月`
    : `${lunar.isLeap ? '闰' : ''}${getLunarMonthName(lunar.month)}月`;
  const dayName = lunar.dayChinese || getLunarDayName(lunar.day);
  return `${lunar.year}年 ${monthName} ${dayName}`;
}

/**
 * 获取农历月份中文名（兜底用）
 */
function getLunarMonthName(month: number): string {
  const names = ['', '正', '二', '三', '四', '五', '六', '七', '八', '九', '十', '冬', '腊'];
  return names[month] || String(month);
}

/**
 * 获取农历日期中文名（兜底用）
 */
function getLunarDayName(day: number): string {
  const dayNames = [
    '', '初一', '初二', '初三', '初四', '初五', '初六', '初七', '初八', '初九', '初十',
    '十一', '十二', '十三', '十四', '十五', '十六', '十七', '十八', '十九', '二十',
    '廿一', '廿二', '廿三', '廿四', '廿五', '廿六', '廿7', '廿八', '廿九', '三十'
  ];
  // 修正中国传统“廿七”写为“廿七”而非“廿7”
  dayNames[27] = '廿七';
  return dayNames[day] || String(day);
}

/**
 * 获取农历年的生肖
 */
export function getZodiac(year: number): string {
  const zodiac = ['鼠', '牛', '虎', '兔', '龙', '蛇', '马', '羊', '猴', '鸡', '狗', '猪'];
  return zodiac[(year - 4) % 12];
}

// ==================== 年龄计算 ====================

/**
 * 计算两个日期之间的年龄
 */
export function calculateAge(birthDateStr: string, referenceDateStr?: string): number {
  const birth = new Date(birthDateStr);
  const ref = referenceDateStr ? new Date(referenceDateStr) : new Date();

  let age = ref.getFullYear() - birth.getFullYear();
  const monthDiff = ref.getMonth() - birth.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && ref.getDate() < birth.getDate())) {
    age--;
  }
  return Math.max(0, age);
}

/**
 * 格式化年龄展示：满一岁显示“x岁”，不足一岁显示“x个月”，不足一个月显示“x天”。
 */
export function formatAge(birthDateStr: string, referenceDateStr?: string): string {
  const birth = new Date(birthDateStr);
  const ref = referenceDateStr ? new Date(referenceDateStr) : new Date();

  if (isNaN(birth.getTime()) || isNaN(ref.getTime())) return '';

  const age = calculateAge(birthDateStr, referenceDateStr);
  if (age >= 1) {
    return `${age}岁`;
  }

  let months = (ref.getFullYear() - birth.getFullYear()) * 12 + ref.getMonth() - birth.getMonth();
  if (ref.getDate() < birth.getDate()) {
    months--;
  }

  if (months >= 1) {
    return `${months}个月`;
  }

  const dayMs = 24 * 60 * 60 * 1000;
  const days = Math.max(1, Math.ceil((ref.getTime() - birth.getTime()) / dayMs));
  return `${days}天`;
}

/**
 * 计算照片拍摄时此人的年龄
 */
export function calculatePhotoAge(birthDateStr: string, photoDateStr: string): string {
  return formatAge(birthDateStr, photoDateStr);
}

// ==================== 格式化工具 ====================

/**
 * 格式化日期为展示字符串
 */
export function formatDate(dateStr: string, precision: 'date' | 'time' = 'date'): string {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');

  if (precision === 'time') {
    const h = String(date.getHours()).padStart(2, '0');
    const min = String(date.getMinutes()).padStart(2, '0');
    const s = String(date.getSeconds()).padStart(2, '0');
    if (h === '00' && min === '00' && s === '00') {
      return `${y}年${m}月${d}日`;
    }
    return `${y}年${m}月${d}日 ${h}:${min}:${s}`;
  }

  return `${y}年${m}月${d}日`;
}

/**
 * 获取人物的全名
 */
export function getFullName(surname: string, givenName: string): string {
  return `${surname}${givenName}`;
}

/**
 * 获取人物的年龄描述
 */
export function getAgeDescription(
  birthDateSolar?: string,
  deathDateSolar?: string,
  isAlive?: boolean
): string {
  if (!birthDateSolar) return '';
  if (!isAlive && deathDateSolar) {
    return `享年${formatAge(birthDateSolar, deathDateSolar)}`;
  }
  return formatAge(birthDateSolar);
}

/**
 * 获取生卒年份简写
 */
export function getLifeSpan(birthDateSolar?: string, deathDateSolar?: string, isAlive?: boolean): string {
  if (!birthDateSolar) return '';
  const birthYear = new Date(birthDateSolar).getFullYear();
  if (!isAlive && deathDateSolar) {
    const deathYear = new Date(deathDateSolar).getFullYear();
    return `${birthYear}—${deathYear}`;
  }
  return `${birthYear}—`;
}

// ==================== 中国省份数据 ====================

export const CHINESE_PROVINCES = [
  // 直辖市
  '北京市', '天津市', '上海市', '重庆市',
  // 省
  '河北省', '山西省', '辽宁省', '吉林省', '黑龙江省',
  '江苏省', '浙江省', '安徽省', '福建省', '江西省',
  '山东省', '河南省', '湖北省', '湖南省', '广东省',
  '海南省', '四川省', '贵州省', '云南省', '陕西省',
  '甘肃省', '青海省', '台湾省',
  // 自治区
  '内蒙古自治区', '广西壮族自治区', '西藏自治区',
  '宁夏回族自治区', '新疆维吾尔自治区',
  // 特别行政区
  '香港特别行政区', '澳门特别行政区',
  // 其他
  '海外',
];

// ==================== 日期校验与限制工具 ====================

/**
 * 校验指定公历年月日是否合法
 */
export function isValidSolarDate(year: number, month: number, day: number): boolean {
  if (year < 1900 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) {
    return false;
  }
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && (date.getMonth() + 1) === month && date.getDate() === day;
}

// 兼容浏览器 ES Module 引入形式：从全局或 import 引入 LunarYear 
import { LunarYear } from 'lunar-javascript';

/**
 * 获取农历某年份包含的闰月（返回 0 表示当年无闰月）
 */
export function getLunarLeapMonth(year: number): number {
  try {
    return LunarYear.fromYear(year).getLeapMonth();
  } catch {
    return 0;
  }
}

/**
 * 获取农历某月的天数（29或30天）
 */
export function getLunarMonthDays(year: number, month: number, isLeap: boolean): number {
  try {
    const m = isLeap ? -month : month;
    const lunarObj = Lunar.fromYmd(year, m, 30);
    return lunarObj.getDay() === 30 ? 30 : 29;
  } catch {
    return 29;
  }
}

/**
 * 计算某人在全家庭兄弟姐妹中的排行称呼（支持相对于 selfId 的相对排行）
 */
export function getSiblingRank(
  personId: string,
  persons: Record<string, any>,
  selfId?: string
): string {
  const person = persons[personId];
  if (!person) return '';

  const father = person.relations.father;
  const mother = person.relations.mother;
  const adoptiveFather = person.relations.adoptiveFather;
  const adoptiveMother = person.relations.adoptiveMother;

  // 1. 找出包含主体和所有手足在内的集合
  const allSiblings = Object.values(persons).filter((p: any) => {
    const shareFather = father && p.relations.father === father;
    const shareMother = mother && p.relations.mother === mother;
    const shareAdoptiveFather = adoptiveFather && p.relations.adoptiveFather === adoptiveFather;
    const shareAdoptiveMother = adoptiveMother && p.relations.adoptiveMother === adoptiveMother;
    
    return p.id === personId || p.id === selfId || shareFather || shareMother || shareAdoptiveFather || shareAdoptiveMother;
  });

  // 去重以防万一
  const uniqueSibs = Array.from(new Map(allSiblings.map(p => [p.id, p])).values());

  if (uniqueSibs.length <= 1) {
    return person.gender === 'male' ? '独子' : '独女';
  }

  // 2. 排序：按出生日期从早到晚（年龄从大到小），未填生日者排在最后
  uniqueSibs.sort((a, b) => {
    const dateA = a.birthDateSolar ? new Date(a.birthDateSolar).getTime() : Infinity;
    const dateB = b.birthDateSolar ? new Date(b.birthDateSolar).getTime() : Infinity;
    if (dateA !== dateB) return dateA - dateB;
    return a.createdAt.localeCompare(b.createdAt);
  });

  // 3. 找到主体 (selfId) 和目标 (personId) 在全排行里的索引和出生早晚
  const selfIdx = uniqueSibs.findIndex((p) => p.id === (selfId || ''));
  const targetIdx = uniqueSibs.findIndex((p) => p.id === personId);

  if (targetIdx === -1) return '';

  // 如果没有提供 selfId，退化为传统同性别大排行逻辑
  if (!selfId || selfIdx === -1) {
    const sameGenderSiblings = uniqueSibs.filter((p) => p.gender === person.gender);
    const gIndex = sameGenderSiblings.findIndex((p) => p.id === personId);
    if (gIndex === -1) return '';
    const chineseNumbers = ['大', '二', '三', '四', '五', '六', '七', '八', '九', '十'];
    const rankNum = gIndex < chineseNumbers.length ? chineseNumbers[gIndex] : `${gIndex + 1}`;
    return person.gender === 'male' ? `${rankNum}哥` : `${rankNum}姐`;
  }

  // 核心相对称呼逻辑
  const isOlderThanSelf = targetIdx < selfIdx;
  const isMale = person.gender === 'male';

  // 两个孩子的情况下，不加“大”、“二”，直接叫“哥哥/姐姐/弟弟/妹妹”
  if (uniqueSibs.length === 2) {
    if (isOlderThanSelf) {
      return isMale ? '哥哥' : '姐姐';
    } else {
      return isMale ? '弟弟' : '妹妹';
    }
  }

  // 三个及以上孩子的情况下，大排行数字作为前缀，结合性别和年龄早晚作为后缀
  const chineseNumbers = ['大', '二', '三', '四', '五', '六', '七', '八', '九', '十'];
  const rankNum = targetIdx < chineseNumbers.length ? chineseNumbers[targetIdx] : `${targetIdx + 1}`;

  if (isOlderThanSelf) {
    return `${rankNum}${isMale ? '哥' : '姐'}`;
  } else {
    return `${rankNum}${isMale ? '弟' : '妹'}`;
  }
}

/**
 * 智能计算目标人与主视角的家庭关系称呼（支持两代以内主要直系/旁系亲属）
 */
export function getRelationshipText(
  targetId: string,
  perspectiveId: string | undefined,
  persons: Record<string, any>
): string {
  if (!perspectiveId) return '';
  if (targetId === perspectiveId) return '主视角';

  const target = persons[targetId];
  const perspect = persons[perspectiveId];
  if (!target || !perspect) return '';

  // 1. 直系父母
  if (perspect.relations.father === targetId) return '父亲';
  if (perspect.relations.mother === targetId) return '母亲';
  if (perspect.relations.adoptiveFather === targetId) return '养父';
  if (perspect.relations.adoptiveMother === targetId) return '养母';

  // 2. 配偶
  if (perspect.relations.spouses && perspect.relations.spouses.some((s: any) => s.id === targetId)) {
    return '配偶';
  }

  // 3. 子女
  if (target.relations.father === perspectiveId || target.relations.mother === perspectiveId) {
    return target.gender === 'male' ? '儿子' : '女儿';
  }
  if (target.relations.adoptiveFather === perspectiveId || target.relations.adoptiveMother === perspectiveId) {
    return target.gender === 'male' ? '养子' : '养女';
  }

  // 4. 兄弟姐妹
  const f_p = perspect.relations.father;
  const m_p = perspect.relations.mother;
  const af_p = perspect.relations.adoptiveFather;
  const am_p = perspect.relations.adoptiveMother;

  const f_t = target.relations.father;
  const m_t = target.relations.mother;
  const af_t = target.relations.adoptiveFather;
  const am_t = target.relations.adoptiveMother;

  const shareFather = f_p && f_t && f_p === f_t;
  const shareMother = m_p && m_t && m_p === m_t;
  const shareAdoptiveFather = af_p && af_t && af_p === af_t;
  const shareAdoptiveMother = am_p && am_t && am_p === am_t;

  if (shareFather || shareMother || shareAdoptiveFather || shareAdoptiveMother) {
    return getSiblingRank(targetId, persons, perspectiveId);
  }

  // 5. 祖辈
  if (f_p && persons[f_p]) {
    const grandpa = persons[f_p].relations.father;
    const grandma = persons[f_p].relations.mother;
    if (grandpa === targetId) return '祖父 (爷爷)';
    if (grandma === targetId) return '祖母 (奶奶)';
  }
  if (m_p && persons[m_p]) {
    const grandpa_m = persons[m_p].relations.father;
    const grandma_m = persons[m_p].relations.mother;
    if (grandpa_m === targetId) return '外祖父 (姥爷)';
    if (grandma_m === targetId) return '外祖母 (姥姥)';
  }

  // 6. 孙辈
  const pChildren = Object.values(persons).filter(
    (p: any) => p.relations.father === perspectiveId || p.relations.mother === perspectiveId
  );
  for (const child of pChildren) {
    if (target.relations.father === child.id || target.relations.mother === child.id) {
      if (child.gender === 'male') {
        return target.gender === 'male' ? '孙子' : '孙女';
      } else {
        return target.gender === 'male' ? '外孙' : '外外孙女';
      }
    }
  }

  return '家族成员';
}
