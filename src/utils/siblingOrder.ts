// 同辈（兄弟姐妹）排序
// 默认按出生日期：年长者在左，出生日期"未知"的人排在已知者右侧（彼此按录入先后）。
// 现实中常有"虽然不知道生日，但知道他排行老大"的情况，因此支持手动排序：
// meta.siblingOrder 记录 personId → 组内位次（0 = 最年长），一旦存在即优先于出生日期。
// 排序结果同时参与称谓推导（兄/弟、姐/妹、伯/叔 等），保证树上左右顺序与称呼一致。

import type { Person } from '../types';

/** personId → 组内位次（0 起） */
export type SiblingOrderMap = Record<string, number>;

/** 出生时间（毫秒）。无出生日期（"未知"）返回 Infinity —— 默认排在同辈最右 */
export function birthTimeOf(person?: Person | null): number {
  if (!person?.birthDateSolar) return Number.POSITIVE_INFINITY;
  const t = new Date(person.birthDateSolar).getTime();
  return Number.isNaN(t) ? Number.POSITIVE_INFINITY : t;
}

/** 纯年龄比较：生日早的在前；无生日者靠后；再按录入时间与 id 稳定排序 */
export function compareByAge(a: Person, b: Person): number {
  const ta = birthTimeOf(a);
  const tb = birthTimeOf(b);
  if (ta !== tb) return ta - tb;
  const ca = a.createdAt || '';
  const cb = b.createdAt || '';
  if (ca !== cb) return ca.localeCompare(cb);
  return (a.id || '').localeCompare(b.id || '');
}

/** 一个人的全部父母 id（生 / 养 / 继） */
export function parentIdsOf(person?: Person | null): string[] {
  const r: any = person?.relations;
  if (!r) return [];
  const adoptiveFathers: string[] = Array.isArray(r.adoptiveFathers) && r.adoptiveFathers.length
    ? r.adoptiveFathers
    : r.adoptiveFather
      ? [r.adoptiveFather]
      : [];
  const adoptiveMothers: string[] = Array.isArray(r.adoptiveMothers) && r.adoptiveMothers.length
    ? r.adoptiveMothers
    : r.adoptiveMother
      ? [r.adoptiveMother]
      : [];
  const ids = [r.father, r.mother, ...adoptiveFathers, ...adoptiveMothers, r.stepFather, r.stepMother]
    .filter(Boolean) as string[];
  return Array.from(new Set(ids));
}

/** 两人是否为同辈兄弟姐妹（共享任一父母，含养父母 / 继父母） */
export function areSiblings(a?: Person | null, b?: Person | null): boolean {
  if (!a || !b || a.id === b.id) return false;
  const pa = parentIdsOf(a);
  if (!pa.length) return false;
  const pb = parentIdsOf(b);
  return pb.some((id) => pa.includes(id));
}

/**
 * 同辈比较：同一组兄弟姐妹若已有手动位次，按位次；未指定位次的成员排在其后。
 * 跨组（堂表、无共同父母）时一律按出生日期。
 */
export function compareSiblings(a: Person, b: Person, order?: SiblingOrderMap): number {
  // 若两人都有明确出生日期，永远以客观年龄为准，绝不允许长幼颠倒
  if (a.birthDateSolar && b.birthDateSolar) {
    return compareByAge(a, b);
  }
  if (order) {
    const oa = order[a.id];
    const ob = order[b.id];
    const hasA = typeof oa === 'number';
    const hasB = typeof ob === 'number';
    if ((hasA || hasB) && areSiblings(a, b)) {
      if (hasA && hasB) return oa === ob ? compareByAge(a, b) : oa - ob;
      // 手动排过序的组里，尚未指定位次（新录入）的成员默认排在最后
      return hasA ? -1 : 1;
    }
  }
  return compareByAge(a, b);
}

/** 按当前生效规则（手动位次优先）排序一组人员，返回新数组 */
export function sortSiblings<T extends Person>(list: T[], order?: SiblingOrderMap): T[] {
  return [...list].sort((a, b) => compareSiblings(a, b, order));
}

/** 该组是否已有手动排序（任一人带位次） */
export function hasManualOrder(list: Person[], order?: SiblingOrderMap): boolean {
  if (!order) return false;
  return list.some((p) => typeof order[p.id] === 'number');
}

/**
 * 用一个新的排列覆盖整组位次（保持其他组不受影响）。
 * orderedIds 为从最年长到最年幼的 id 列表。
 */
export function applyGroupOrder(
  current: SiblingOrderMap | undefined,
  groupIds: string[],
  orderedIds: string[]
): SiblingOrderMap {
  const next: SiblingOrderMap = { ...(current || {}) };
  // 先把旧位次往上抬，避免与本次写入的 0..n 冲突（同组外的人不受影响）
  groupIds.forEach((id) => {
    delete next[id];
  });
  orderedIds.forEach((id, idx) => {
    next[id] = idx;
  });
  return next;
}

/** 清除某组的全部位次（回退到按出生日期排序） */
export function clearGroupOrder(
  current: SiblingOrderMap | undefined,
  groupIds: string[]
): SiblingOrderMap {
  const next: SiblingOrderMap = { ...(current || {}) };
  groupIds.forEach((id) => {
    delete next[id];
  });
  return next;
}
