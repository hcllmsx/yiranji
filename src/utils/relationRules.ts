// 家庭关系规则：候选人屏蔽、排序与保存前校验
//
// 三条设计原则：
// 1) 下拉候选与保存校验共用同一套判定，避免"选得到却存不了"或"存得了却把树种乱"；
// 2) 年龄未知 ≠ 年龄错误：缺少出生日期的一方不参与任何年龄判定，关系正常就原样保留；
// 3) 结构错误（自指 / 成环 / 一人多角色）必须拦死，常识错误（年龄差）按阈值拦。
//
// 本文件是纯函数模块，不依赖 React，也不直接读写项目数据：
// PersonEditPage 用它生成候选与校验，dataMigration 用它修复旧档案。

import type { AdoptiveParentGroup, ChildRelationType, Gender, Person } from '../types';
import { getAdoptiveFathers, getAdoptiveMothers } from '../types';
import { birthTimeOf, compareByAge, parentIdsOf } from './siblingOrder';

// ==================== 角色与规则配置 ====================

export type RelationRole =
  | 'father'
  | 'mother'
  | 'adoptiveFather'
  | 'adoptiveMother'
  | 'stepFather'
  | 'stepMother'
  | 'spouse'
  | 'child'
  | 'sibling';

export const RELATION_ROLE_LABELS: Record<RelationRole, string> = {
  father: '父亲',
  mother: '母亲',
  adoptiveFather: '养父',
  adoptiveMother: '养母',
  stepFather: '继父',
  stepMother: '继母',
  spouse: '配偶',
  child: '子女',
  sibling: '手足',
};

const PARENT_ROLES: RelationRole[] = [
  'father',
  'mother',
  'adoptiveFather',
  'adoptiveMother',
  'stepFather',
  'stepMother',
];

/** 角色分组：同组角色之间靠"排除已选"去重，跨组一律互斥 */
const ROLE_GROUP: Record<RelationRole, 'parent' | 'spouse' | 'child' | 'sibling'> = {
  father: 'parent',
  mother: 'parent',
  adoptiveFather: 'parent',
  adoptiveMother: 'parent',
  stepFather: 'parent',
  stepMother: 'parent',
  spouse: 'spouse',
  child: 'child',
  sibling: 'sibling',
};

/**
 * 需要限定性别的角色：只有亲生父母（必须一男一女）与继父母。
 * 养父母不限性别——“养父”可以是女性、“养母”可以是男性，
 * 也允许两位养父 / 两位养母，且可以有多组（adoptiveFathers / adoptiveMothers 均为数组）。
 */
const MALE_ONLY_ROLES: RelationRole[] = ['father', 'stepFather'];
const FEMALE_ONLY_ROLES: RelationRole[] = ['mother', 'stepMother'];

export function isParentRole(role: RelationRole): boolean {
  return PARENT_ROLES.includes(role);
}

export type CandidateSortDirection = 'youngestFirst' | 'oldestFirst';

export interface RelationRuleOptions {
  /** 父母与子女之间的最小年龄差（岁）：差值低于此值视为不可能 */
  minParentChildAgeGap: number;
  /** 候选人排序方向：默认年龄小→大 */
  candidateSort: CandidateSortDirection;
  /** 是否允许同性配偶（沿用产品现状：允许） */
  allowSameSexSpouse: boolean;
}

export const DEFAULT_RELATION_RULES: RelationRuleOptions = {
  minParentChildAgeGap: 10,
  candidateSort: 'youngestFirst',
  allowSameSexSpouse: true,
};

// ==================== 表单草稿 ====================

/** 编辑页当前填写的关系草稿（尚未保存） */
export interface RelationDraft {
  /** 编辑已有人员时的 id；新建人员为 undefined */
  selfId?: string;
  gender: Gender;
  /** 表单当前出生日期；"出生日期未知"时为 undefined */
  birthDateSolar?: string;
  isAlive: boolean;
  deathDateSolar?: string;
  fatherId?: string;
  motherId?: string;
  /** 养父母分组：一组 = 养父 + 养母，任一方可为空 */
  adoptiveGroups: AdoptiveParentGroup[];
  stepFatherId?: string;
  stepMotherId?: string;
  spouseIds: string[];
  childEntries: { id: string; type: ChildRelationType }[];
  siblingIds: string[];
}

export interface RelationContext {
  draft: RelationDraft;
  /** 已保存的全谱人员（不含草稿覆盖） */
  persons: Record<string, Person>;
  options?: Partial<RelationRuleOptions>;
}

// ==================== 基础工具 ====================

function rulesOf(ctx: RelationContext): RelationRuleOptions {
  return { ...DEFAULT_RELATION_RULES, ...(ctx.options || {}) };
}

export function personDisplayName(person?: Person | null): string {
  if (!person) return '未命名';
  return `${person.surname || ''}${person.givenName || ''}`.trim() || '未命名';
}

/**
 * 某人在 referenceValue 那天已满多少岁。
 * 任一方缺失 / 日期非法 / 参考日早于出生日 → undefined（视为"无法判定"，调用方应放行）。
 */
export function ageAt(birthValue?: string, referenceValue?: string): number | undefined {
  if (!birthValue || !referenceValue) return undefined;
  const birth = new Date(birthValue);
  const reference = new Date(referenceValue);
  if (Number.isNaN(birth.getTime()) || Number.isNaN(reference.getTime()) || reference < birth) {
    return undefined;
  }
  let age = reference.getFullYear() - birth.getFullYear();
  if (
    reference.getMonth() < birth.getMonth() ||
    (reference.getMonth() === birth.getMonth() && reference.getDate() < birth.getDate())
  ) {
    age--;
  }
  return age;
}

/** 两人出生日期相差的整年数（不分长幼）；任一方未知 → undefined */
export function ageGapBetween(firstBirth?: string, secondBirth?: string): number | undefined {
  return ageAt(firstBirth, secondBirth) ?? ageAt(secondBirth, firstBirth);
}

/** 按当前状态算年龄：在世算到今天，已故算到逝世日；缺日期 → undefined */
export function currentAgeOf(person?: Person | null): number | undefined {
  if (!person?.birthDateSolar) return undefined;
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(
    today.getDate()
  ).padStart(2, '0')}`;
  const reference = person.isAlive === false ? person.deathDateSolar : todayStr;
  return ageAt(person.birthDateSolar, reference);
}

/** 草稿里已占用的全部父母 id（生 / 养 / 继） */
export function draftParentIds(draft: RelationDraft): string[] {
  const ids = [
    draft.fatherId,
    draft.motherId,
    ...draft.adoptiveGroups.flatMap((group) => [group.fatherId, group.motherId]),
    draft.stepFatherId,
    draft.stepMotherId,
  ].filter((id): id is string => Boolean(id));
  return Array.from(new Set(ids));
}

/** 草稿里所有非空的养父 id */
export function draftAdoptiveFatherIds(draft: RelationDraft): string[] {
  return draft.adoptiveGroups
    .map((group) => group.fatherId)
    .filter((id): id is string => Boolean(id));
}

/** 草稿里所有非空的养母 id */
export function draftAdoptiveMotherIds(draft: RelationDraft): string[] {
  return draft.adoptiveGroups
    .map((group) => group.motherId)
    .filter((id): id is string => Boolean(id));
}

function draftChildIds(draft: RelationDraft): string[] {
  return Array.from(new Set(draft.childEntries.map((entry) => entry.id).filter(Boolean)));
}

function draftSpouseIds(draft: RelationDraft): string[] {
  return Array.from(new Set(draft.spouseIds.filter(Boolean)));
}

function draftSiblingIds(draft: RelationDraft): string[] {
  return Array.from(new Set(draft.siblingIds.filter(Boolean)));
}

// ==================== 关系图预处理 ====================

interface PreparedRelations {
  parentIds: string[];
  childIds: string[];
  spouseIds: string[];
  siblingIds: string[];
  /** 仅按已保存数据计算的直接子女（用于区分“直接子女”与更远的后代） */
  savedChildIds: Set<string>;
  /** 本人祖先（含草稿里刚选的父母及其祖先），用于候选屏蔽 */
  ancestors: Set<string>;
  /** 本人后代（含草稿里刚选的子女及其后代），用于候选屏蔽 */
  descendants: Set<string>;
  /** 仅按已保存数据计算的祖先，用于校验成环（不含草稿，避免把刚选的父母误判成环） */
  savedAncestors: Set<string>;
  /** 仅按已保存数据计算的后代，用于校验成环 */
  savedDescendants: Set<string>;
  /** personId → 已被草稿占用的角色 */
  occupied: Map<string, RelationRole[]>;
  /** 已经通过"共享父母"构成本人手足的人 */
  impliedSiblings: Set<string>;
}

/**
 * 关系预处理结果按「人员表 + 草稿」缓存。
 * 编辑页每渲染一次会为 7 个以上下拉各算一遍候选，不缓存则每次输入都要重扫全谱。
 */
const preparedCache = new WeakMap<
  Record<string, Person>,
  WeakMap<RelationDraft, PreparedRelations>
>();

function prepareCached(ctx: RelationContext): PreparedRelations {
  const { draft, persons } = ctx;
  let byDraft = preparedCache.get(persons);
  if (!byDraft) {
    byDraft = new WeakMap();
    preparedCache.set(persons, byDraft);
  }
  const hit = byDraft.get(draft);
  if (hit) return hit;
  const prepared = prepareRelations(ctx);
  byDraft.set(draft, prepared);
  return prepared;
}

function prepareRelations(ctx: RelationContext): PreparedRelations {
  const { draft, persons } = ctx;
  const savedSelf = draft.selfId ? persons[draft.selfId] : undefined;

  const parentIds = draftParentIds(draft);
  // 表单暂不维护继父母；编辑既有数据时按原值兜底参与祖先计算
  for (const inherited of [savedSelf?.relations?.stepFather, savedSelf?.relations?.stepMother]) {
    if (inherited && !parentIds.includes(inherited)) parentIds.push(inherited);
  }

  // ---- 祖先：从父母一路向上 ----
  const ancestors = new Set<string>();
  const upStack: string[] = [];
  parentIds.forEach((id) => {
    if (id === draft.selfId || ancestors.has(id)) return;
    ancestors.add(id);
    upStack.push(id);
  });
  while (upStack.length) {
    const id = upStack.pop()!;
    const person = persons[id];
    if (!person) continue;
    parentIdsOf(person).forEach((parentId) => {
      if (parentId === draft.selfId || ancestors.has(parentId)) return;
      ancestors.add(parentId);
      upStack.push(parentId);
    });
  }

  // ---- 仅按已保存数据计算的祖先（校验成环用） ----
  const savedAncestors = new Set<string>();
  if (savedSelf) {
    const savedStack = parentIdsOf(savedSelf).filter((id) => id !== draft.selfId);
    savedStack.forEach((id) => savedAncestors.add(id));
    while (savedStack.length) {
      const id = savedStack.pop()!;
      const person = persons[id];
      if (!person) continue;
      parentIdsOf(person).forEach((parentId) => {
        if (parentId === draft.selfId || savedAncestors.has(parentId)) return;
        savedAncestors.add(parentId);
        savedStack.push(parentId);
      });
    }
  }

  // ---- 子女索引：childId ← 父母们 ----
  const childrenOf = new Map<string, string[]>();
  Object.values(persons).forEach((person) => {
    parentIdsOf(person).forEach((parentId) => {
      if (!childrenOf.has(parentId)) childrenOf.set(parentId, []);
      childrenOf.get(parentId)!.push(person.id);
    });
  });

  // ---- 后代：从草稿子女 + 已有正向/反向子女关系一路向下 ----
  const childIds = draftChildIds(draft);

  // 已保存的直接子女：他们本来就在后代集合里，不能当成“隔代后代”拦截
  const savedChildIds = new Set<string>();
  if (draft.selfId) {
    (savedSelf?.relations?.children || []).forEach((child) => {
      if (child?.id) savedChildIds.add(child.id);
    });
    (childrenOf.get(draft.selfId) || []).forEach((id) => savedChildIds.add(id));
  }
  const descendants = new Set<string>();
  const downQueue: string[] = [];
  const pushChild = (id: string) => {
    if (!id || id === draft.selfId || descendants.has(id)) return;
    descendants.add(id);
    downQueue.push(id);
  };
  childIds.forEach(pushChild);
  if (draft.selfId) {
    (childrenOf.get(draft.selfId) || []).forEach(pushChild);
    (savedSelf?.relations?.children || []).forEach((child) => child?.id && pushChild(child.id));
  }
  while (downQueue.length) {
    const id = downQueue.pop()!;
    (childrenOf.get(id) || []).forEach(pushChild);
    (persons[id]?.relations?.children || []).forEach((child) => child?.id && pushChild(child.id));
  }

  // ---- 仅按已保存数据计算的后代（校验成环用） ----
  const savedDescendants = new Set<string>();
  if (draft.selfId) {
    const savedQueue: string[] = [];
    const pushSaved = (id: string) => {
      if (!id || id === draft.selfId || savedDescendants.has(id)) return;
      savedDescendants.add(id);
      savedQueue.push(id);
    };
    (childrenOf.get(draft.selfId) || []).forEach(pushSaved);
    (savedSelf?.relations?.children || []).forEach((child) => child?.id && pushSaved(child.id));
    while (savedQueue.length) {
      const id = savedQueue.pop()!;
      (childrenOf.get(id) || []).forEach(pushSaved);
      (persons[id]?.relations?.children || []).forEach((child) => child?.id && pushSaved(child.id));
    }
  }

  // ---- 草稿已占用的角色 ----
  const occupied = new Map<string, RelationRole[]>();
  const occupy = (id: string | undefined, role: RelationRole) => {
    if (!id) return;
    const roles = occupied.get(id) || [];
    roles.push(role);
    occupied.set(id, roles);
  };
  occupy(draft.fatherId, 'father');
  occupy(draft.motherId, 'mother');
  draft.adoptiveGroups.forEach((group) => {
    occupy(group.fatherId, 'adoptiveFather');
    occupy(group.motherId, 'adoptiveMother');
  });
  occupy(draft.stepFatherId, 'stepFather');
  occupy(draft.stepMotherId, 'stepMother');
  draftSpouseIds(draft).forEach((id) => occupy(id, 'spouse'));
  draftChildIds(draft).forEach((id) => occupy(id, 'child'));
  draftSiblingIds(draft).forEach((id) => occupy(id, 'sibling'));

  // ---- 隐含手足：与本人共享任一父母 ----
  const impliedSiblings = new Set<string>();
  if (draft.selfId && parentIds.length > 0) {
    Object.values(persons).forEach((person) => {
      if (person.id === draft.selfId) return;
      if (parentIdsOf(person).some((parentId) => parentIds.includes(parentId))) {
        impliedSiblings.add(person.id);
      }
    });
  }

  return {
    parentIds,
    childIds,
    spouseIds: draftSpouseIds(draft),
    siblingIds: draftSiblingIds(draft),
    ancestors,
    descendants,
    savedAncestors,
    savedDescendants,
    occupied,
    impliedSiblings,
    savedChildIds,
  };
}

// ==================== 候选屏蔽判定 ====================

export type CandidateBlockReason =
  | 'self'
  | 'gender'
  | 'role-conflict'
  | 'ancestor'
  | 'descendant'
  | 'already-sibling'
  | 'parent-not-older'
  | 'parent-too-young'
  | 'child-not-younger'
  | 'child-too-old';

export interface CandidateBlock {
  reason: CandidateBlockReason;
  message: string;
}

export interface CandidateFilterOptions {
  /** 额外排除的人（同一角色的其他行通常无需传，占用检查已覆盖） */
  excludeIds?: string[];
  /** 子女行当前选择的关系类型：亲生才卡 10 岁年龄差 */
  childType?: ChildRelationType;
  /** 评估"当前已选的人"时用：忽略此人已被本行占用 */
  ignoreRoleOccupancy?: boolean;
  /**
   * 本行当前已选的人：生成该行候选时忽略此人的角色占用，
   * 让它按年龄正常排序，而不是被自己的占用规则挤到列表首位。
   */
  ignoreOccupancyFor?: string;
}

/** 父母：必须早于本人生日，且年龄差达到阈值；缺生日的一方直接放行 */
function parentAgeBlock(
  candidate: Person,
  selfBirth: string | undefined,
  minGap: number
): CandidateBlock | null {
  if (!selfBirth || !candidate.birthDateSolar) return null;
  const parentBirth = new Date(candidate.birthDateSolar).getTime();
  const childBirth = new Date(selfBirth).getTime();
  if (Number.isNaN(parentBirth) || Number.isNaN(childBirth)) return null;
  if (parentBirth >= childBirth) {
    return { reason: 'parent-not-older', message: '出生日期不早于本人' };
  }
  if (minGap <= 0) return null;
  const gap = ageAt(candidate.birthDateSolar, selfBirth);
  if (gap !== undefined && gap < minGap) {
    return { reason: 'parent-too-young', message: `只比本人大 ${gap} 岁，不足 ${minGap} 岁` };
  }
  return null;
}

/** 最小生育年龄差只约束亲生父母；养父母 / 继父母允许年龄相近，但仍需早于本人 */
function parentMinGapOf(role: RelationRole, rules: RelationRuleOptions): number {
  return role === 'father' || role === 'mother' ? rules.minParentChildAgeGap : 0;
}

/** 子女：必须晚于本人生日；亲生子女还要满足最小年龄差 */
function childAgeBlock(
  candidate: Person,
  selfBirth: string | undefined,
  childType: ChildRelationType,
  minGap: number
): CandidateBlock | null {
  if (!selfBirth || !candidate.birthDateSolar) return null;
  const selfBirthTime = new Date(selfBirth).getTime();
  const childBirth = new Date(candidate.birthDateSolar).getTime();
  if (Number.isNaN(selfBirthTime) || Number.isNaN(childBirth)) return null;
  if (childBirth <= selfBirthTime) {
    return { reason: 'child-not-younger', message: '出生日期不晚于本人' };
  }
  if (childType !== 'biological') return null;
  const gap = ageAt(selfBirth, candidate.birthDateSolar);
  if (gap !== undefined && gap < minGap) {
    return { reason: 'child-too-old', message: `本人只比 TA 大 ${gap} 岁，不足 ${minGap} 岁` };
  }
  return null;
}

function blockReason(
  role: RelationRole,
  candidate: Person,
  ctx: RelationContext,
  prepared: PreparedRelations,
  extra: CandidateFilterOptions
): CandidateBlock | null {
  const { draft } = ctx;
  const rules = rulesOf(ctx);

  if (!candidate?.id) return { reason: 'self', message: '人员不存在' };
  if (draft.selfId && candidate.id === draft.selfId) {
    return { reason: 'self', message: '不能选择本人' };
  }
  if (extra.excludeIds?.includes(candidate.id)) {
    return { reason: 'role-conflict', message: '已在其他关系中选中' };
  }

  // 角色互斥：已经被任何槽位占用的人不再出现在候选里
  if (!extra.ignoreRoleOccupancy && candidate.id !== extra.ignoreOccupancyFor) {
    const roles = prepared.occupied.get(candidate.id);
    if (roles && roles.length > 0) {
      const conflict = roles.find((item) => ROLE_GROUP[item] !== ROLE_GROUP[role]) || roles[0];
      return {
        reason: 'role-conflict',
        message: `已被设为${RELATION_ROLE_LABELS[conflict]}`,
      };
    }
  }

  // 性别：未填写的按"未知"放行，资料缺失不等于关系错误
  if (MALE_ONLY_ROLES.includes(role) && candidate.gender && candidate.gender !== 'male') {
    return { reason: 'gender', message: '该角色需要男性' };
  }
  if (FEMALE_ONLY_ROLES.includes(role) && candidate.gender && candidate.gender !== 'female') {
    return { reason: 'gender', message: '该角色需要女性' };
  }
  if (
    role === 'spouse' &&
    !rules.allowSameSexSpouse &&
    candidate.gender &&
    candidate.gender === draft.gender
  ) {
    return { reason: 'gender', message: '该角色需要异性' };
  }

  // 父母类：不能是本人后代，也不能同时占用其他槽位
  if (isParentRole(role)) {
    if (prepared.descendants.has(candidate.id)) {
      return { reason: 'descendant', message: '是本人的后代，不能同时作为长辈' };
    }
    if (prepared.spouseIds.includes(candidate.id)) {
      return { reason: 'role-conflict', message: '已被设为配偶' };
    }
    if (prepared.siblingIds.includes(candidate.id)) {
      return { reason: 'role-conflict', message: '已被设为手足' };
    }
    return parentAgeBlock(candidate, draft.birthDateSolar, parentMinGapOf(role, rules));
  }

  // 子女：不能是本人祖先，也不能是已经构成手足的人
  if (role === 'child') {
    if (prepared.ancestors.has(candidate.id)) {
      return { reason: 'ancestor', message: '是本人的长辈，不能作为子女' };
    }
    // 孙辈等更远的后代不能再挂成直接子女；已保存 / 本行已选的直接子女不受影响
    if (
      prepared.descendants.has(candidate.id) &&
      !prepared.savedChildIds.has(candidate.id) &&
      !prepared.childIds.includes(candidate.id)
    ) {
      return { reason: 'descendant', message: '是本人的隔代后代，不能再作为子女' };
    }
    if (prepared.spouseIds.includes(candidate.id)) {
      return { reason: 'role-conflict', message: '已被设为配偶' };
    }
    if (prepared.siblingIds.includes(candidate.id)) {
      return { reason: 'role-conflict', message: '已被设为手足' };
    }
    if (prepared.impliedSiblings.has(candidate.id)) {
      return { reason: 'already-sibling', message: '与本人共享父母，已经是手足' };
    }
    return childAgeBlock(candidate, draft.birthDateSolar, extra.childType || 'biological', rules.minParentChildAgeGap);
  }

  // 配偶：不能是直系长辈 / 晚辈
  if (role === 'spouse') {
    if (prepared.ancestors.has(candidate.id)) {
      return { reason: 'ancestor', message: '是本人的长辈，不能作为配偶' };
    }
    if (prepared.descendants.has(candidate.id)) {
      return { reason: 'descendant', message: '是本人的后代，不能作为配偶' };
    }
    if (prepared.siblingIds.includes(candidate.id)) {
      return { reason: 'role-conflict', message: '已被设为手足' };
    }
    return null;
  }

  // 手足：不能是直系长辈 / 晚辈，也不能重复已是手足的人
  if (prepared.ancestors.has(candidate.id)) {
    return { reason: 'ancestor', message: '是本人的长辈，不能作为手足' };
  }
  if (prepared.descendants.has(candidate.id)) {
    return { reason: 'descendant', message: '是本人的后代，不能作为手足' };
  }
  if (prepared.spouseIds.includes(candidate.id)) {
    return { reason: 'role-conflict', message: '已被设为配偶' };
  }
  if (prepared.impliedSiblings.has(candidate.id)) {
    return { reason: 'already-sibling', message: '与本人共享父母，已经是手足' };
  }
  if (prepared.childIds.includes(candidate.id)) {
    return { reason: 'role-conflict', message: '已被设为子女' };
  }
  return null;
}

// ==================== 排序 ====================

/**
 * 按出生日期排序：默认"年龄小→大"（越年轻越靠前）。
 * 无出生日期的人永远排在最后，彼此按录入时间 / id 稳定排序。
 */
export function sortCandidatesByAge<T extends Person>(
  list: T[],
  direction: CandidateSortDirection = 'youngestFirst'
): T[] {
  return [...list].sort((a, b) => {
    const timeA = birthTimeOf(a);
    const timeB = birthTimeOf(b);
    const unknownA = timeA === Number.POSITIVE_INFINITY;
    const unknownB = timeB === Number.POSITIVE_INFINITY;
    if (unknownA && unknownB) return compareByAge(a, b);
    if (unknownA) return 1;
    if (unknownB) return -1;
    const diff = direction === 'youngestFirst' ? timeB - timeA : timeA - timeB;
    return diff !== 0 ? diff : compareByAge(a, b);
  });
}

// ==================== 对外：候选列表 ====================

/**
 * 配偶候选排序：异性优先，同性其次；组内按出生日期排序，无生日者落在各自性别组末尾。
 * 例（本人男）：女有生日 → 男有生日 → 女生日未知 → 男生日未知。
 */
export function sortSpouseCandidates<T extends Person>(
  list: T[],
  selfGender: Gender,
  direction: CandidateSortDirection = 'youngestFirst'
): T[] {
  const opposite = list.filter((person) => person.gender !== selfGender);
  const same = list.filter((person) => person.gender === selfGender);
  return [
    ...sortCandidatesByAge(opposite, direction),
    ...sortCandidatesByAge(same, direction),
  ];
}

/** 生成某个关系角色的下拉候选：已按规则屏蔽、已排序 */
export function findRelationCandidates(
  role: RelationRole,
  ctx: RelationContext,
  extra: CandidateFilterOptions = {}
): Person[] {
  const prepared = prepareCached(ctx);
  const rules = rulesOf(ctx);
  const result = Object.values(ctx.persons).filter(
    (person) => !blockReason(role, person, ctx, prepared, extra)
  );
  // 配偶先按性别分组（异性优先），再在组内按年龄排
  if (role === 'spouse') {
    return sortSpouseCandidates(result, ctx.draft.gender, rules.candidateSort);
  }
  return sortCandidatesByAge(result, rules.candidateSort);
}

/** 当前已选项若被规则屏蔽，返回原因文案；否则返回 null（用于下拉旁的红字提示） */
export function getSelectionMismatch(
  role: RelationRole,
  personId: string | undefined,
  ctx: RelationContext,
  childType?: ChildRelationType
): string | null {
  if (!personId) return null;
  const candidate = ctx.persons[personId];
  if (!candidate) return '人员已不存在';
  const block = blockReason(role, candidate, ctx, prepareCached(ctx), {
    childType,
    ignoreRoleOccupancy: true,
  });
  // "已经是手足"不是错误：共享父母的人本就应该出现在手足列表里
  if (role === 'sibling' && block?.reason === 'already-sibling') return null;
  return block ? block.message : null;
}

/**
 * 保证当前已选项一定出现在下拉里。
 * 修改生日 / 关系后，已选的人可能不再满足规则；直接移除会让 select 变空白、用户以为数据丢了。
 */
export function withSelectedPerson(
  list: Person[],
  selectedId: string | undefined,
  persons: Record<string, Person>
): Person[] {
  if (!selectedId) return list;
  if (list.some((person) => person.id === selectedId)) return list;
  const selected = persons[selectedId];
  return selected ? [selected, ...list] : list;
}

// ==================== 对外：保存前校验 ====================

export type RelationIssueLevel = 'error' | 'warning';

export interface RelationIssue {
  level: RelationIssueLevel;
  /** 稳定错误码，便于排查与后续做文案映射 */
  code: string;
  role: RelationRole | 'self';
  message: string;
  personIds: string[];
  /** 是否由本次编辑引入：历史遗留问题只提示、不阻断 */
  introducedByEdit: boolean;
}

interface DraftDiff {
  birthChanged: boolean;
  changedKeys: Set<string>;
}

function savedSiblingIds(ctx: RelationContext): Set<string> {
  const { draft, persons } = ctx;
  const self = draft.selfId ? persons[draft.selfId] : undefined;
  if (!self) return new Set();
  const ownParentIds = parentIdsOf(self);
  if (ownParentIds.length === 0) return new Set();
  const result = new Set<string>();
  Object.values(persons).forEach((person) => {
    if (person.id === self.id) return;
    if (parentIdsOf(person).some((id) => ownParentIds.includes(id))) result.add(person.id);
  });
  return result;
}

/** 对比草稿与已保存数据，标记本次改动涉及的关系 */
function diffDraft(ctx: RelationContext): DraftDiff {
  const { draft, persons } = ctx;
  const saved = draft.selfId ? persons[draft.selfId] : undefined;
  const changedKeys = new Set<string>();

  if (!saved) {
    // 新建人员：已填的一切都算本次新增
    const addAll = (role: RelationRole, ids: string[]) => ids.forEach((id) => changedKeys.add(`${role}:${id}`));
    if (draft.fatherId) addAll('father', [draft.fatherId]);
    if (draft.motherId) addAll('mother', [draft.motherId]);
    addAll('adoptiveFather', draftAdoptiveFatherIds(draft));
    addAll('adoptiveMother', draftAdoptiveMotherIds(draft));
    addAll('spouse', draftSpouseIds(draft));
    addAll('child', draftChildIds(draft));
    addAll('sibling', draftSiblingIds(draft));
    return { birthChanged: Boolean(draft.birthDateSolar), changedKeys };
  }

  const mark = (role: RelationRole, newIds: string[], oldIds: string[]) => {
    const oldSet = new Set(oldIds.filter(Boolean));
    const newSet = new Set(newIds.filter(Boolean));
    newSet.forEach((id) => {
      if (!oldSet.has(id)) changedKeys.add(`${role}:${id}`);
    });
    oldSet.forEach((id) => {
      if (!newSet.has(id)) changedKeys.add(`${role}:${id}`);
    });
  };

  const relations = saved.relations || { spouses: [], children: [] };
  mark('father', draft.fatherId ? [draft.fatherId] : [], relations.father ? [relations.father] : []);
  mark('mother', draft.motherId ? [draft.motherId] : [], relations.mother ? [relations.mother] : []);
  mark('adoptiveFather', draftAdoptiveFatherIds(draft), getAdoptiveFathers(relations));
  mark('adoptiveMother', draftAdoptiveMotherIds(draft), getAdoptiveMothers(relations));
  mark('spouse', draftSpouseIds(draft), (relations.spouses || []).map((item) => item.id));

  const oldChildIds = (relations.children || []).map((item) => item.id);
  mark('child', draftChildIds(draft), oldChildIds);
  // 关系类型变化同样视为改动
  const oldChildType = new Map((relations.children || []).map((item) => [item.id, item.type]));
  draft.childEntries.forEach((entry) => {
    if (!entry.id) return;
    const before = oldChildType.get(entry.id);
    if (before && before !== entry.type) changedKeys.add(`child:${entry.id}`);
  });

  mark('sibling', draftSiblingIds(draft), Array.from(savedSiblingIds(ctx)));

  return {
    birthChanged: (draft.birthDateSolar || '') !== (saved.birthDateSolar || ''),
    changedKeys,
  };
}

interface IssueInput {
  level: RelationIssueLevel;
  code: string;
  role: RelationRole | 'self';
  message: string;
  personIds: string[];
  keys?: string[];
  /** 该问题是否与生日有关：本人改生日后需要重新判定 */
  birthSensitive?: boolean;
}

/**
 * 保存前校验主入口。
 * error 必须修正才能保存；warning 需用户确认，但仍可保存。
 */
export function validateRelations(ctx: RelationContext): RelationIssue[] {
  const { draft, persons } = ctx;
  const rules = rulesOf(ctx);
  const prepared = prepareCached(ctx);
  const diff = diffDraft(ctx);
  const issues: RelationIssue[] = [];

  const push = (input: IssueInput) => {
    const introducedByEdit =
      !draft.selfId ||
      Boolean(input.birthSensitive && diff.birthChanged) ||
      (input.keys || []).some((key) => diff.changedKeys.has(key));
    issues.push({
      level: input.level,
      code: input.code,
      role: input.role,
      message: input.message,
      personIds: input.personIds,
      introducedByEdit,
    });
  };

  const name = (id?: string) => personDisplayName(id ? persons[id] : undefined);

  // ---- 收集所有已填槽位 ----
  interface Slot {
    role: RelationRole;
    id: string;
    childType?: ChildRelationType;
  }
  const parentSlots: Slot[] = [];
  if (draft.fatherId) parentSlots.push({ role: 'father', id: draft.fatherId });
  if (draft.motherId) parentSlots.push({ role: 'mother', id: draft.motherId });
  draft.adoptiveGroups.forEach((group) => {
    if (group.fatherId) parentSlots.push({ role: 'adoptiveFather', id: group.fatherId });
    if (group.motherId) parentSlots.push({ role: 'adoptiveMother', id: group.motherId });
  });
  if (draft.stepFatherId) parentSlots.push({ role: 'stepFather', id: draft.stepFatherId });
  if (draft.stepMotherId) parentSlots.push({ role: 'stepMother', id: draft.stepMotherId });

  const childSlots: Slot[] = draft.childEntries
    .filter((entry) => entry.id)
    .map((entry) => ({ role: 'child' as RelationRole, id: entry.id, childType: entry.type }));
  const spouseSlots: Slot[] = draftSpouseIds(draft).map((id) => ({ role: 'spouse' as RelationRole, id }));
  const siblingSlots: Slot[] = draftSiblingIds(draft).map((id) => ({ role: 'sibling' as RelationRole, id }));
  const allSlots: Slot[] = [...parentSlots, ...childSlots, ...spouseSlots, ...siblingSlots];

  // ---- 1. 自指 ----
  if (draft.selfId) {
    allSlots.forEach((slot) => {
      if (slot.id !== draft.selfId) return;
      push({
        level: 'error',
        code: 'self-reference',
        role: slot.role,
        message: `不能把本人设为${RELATION_ROLE_LABELS[slot.role]}`,
        personIds: [slot.id],
        keys: [`${slot.role}:${slot.id}`],
      });
    });
  }

  // ---- 2. 重复 / 角色互斥 ----
  const seenRoles = new Map<string, RelationRole>();
  allSlots.forEach((slot) => {
    if (draft.selfId && slot.id === draft.selfId) return;
    const previous = seenRoles.get(slot.id);
    if (!previous) {
      seenRoles.set(slot.id, slot.role);
      return;
    }
    if (ROLE_GROUP[previous] === ROLE_GROUP[slot.role]) {
      push({
        level: 'error',
        code: 'duplicate-role',
        role: slot.role,
        message: `「${name(slot.id)}」被重复选为${RELATION_ROLE_LABELS[previous]}`,
        personIds: [slot.id],
        keys: [`${previous}:${slot.id}`, `${slot.role}:${slot.id}`],
      });
      return;
    }
    push({
      level: 'error',
      code: 'role-conflict',
      role: slot.role,
      message: `「${name(slot.id)}」同时被设为${RELATION_ROLE_LABELS[previous]}和${RELATION_ROLE_LABELS[slot.role]}，两种关系互斥`,
      personIds: [slot.id],
      keys: [`${previous}:${slot.id}`, `${slot.role}:${slot.id}`],
    });
  });

  // ---- 3. 成环（只看已保存数据，草稿内的重复已由角色互斥覆盖） ----
  parentSlots.forEach((slot) => {
    if (!prepared.savedDescendants.has(slot.id)) return;
    push({
      level: 'error',
      code: 'cycle',
      role: slot.role,
      message: `「${name(slot.id)}」是本人的后代，不能再作为${RELATION_ROLE_LABELS[slot.role]}`,
      personIds: [slot.id],
      keys: [`${slot.role}:${slot.id}`],
    });
  });
  childSlots.forEach((slot) => {
    if (prepared.savedAncestors.has(slot.id)) {
      push({
        level: 'error',
        code: 'cycle',
        role: slot.role,
        message: `「${name(slot.id)}」是本人的长辈，不能再作为子女`,
        personIds: [slot.id],
        keys: [`${slot.role}:${slot.id}`],
      });
      return;
    }
    // 已是直接子女的人在 savedDescendants 里属正常，只有隔代后代才是重复登记
    if (prepared.savedDescendants.has(slot.id) && !prepared.savedChildIds.has(slot.id)) {
      push({
        level: 'error',
        code: 'cycle',
        role: slot.role,
        message: `「${name(slot.id)}」是本人的隔代后代，不能再作为子女`,
        personIds: [slot.id],
        keys: [`${slot.role}:${slot.id}`],
      });
    }
  });
  siblingSlots.forEach((slot) => {
    if (!prepared.savedAncestors.has(slot.id) && !prepared.savedDescendants.has(slot.id)) return;
    push({
      level: 'error',
      code: 'cycle',
      role: slot.role,
      message: `「${name(slot.id)}」是本人的直系亲属，不能作为手足`,
      personIds: [slot.id],
      keys: [`${slot.role}:${slot.id}`],
    });
  });
  spouseSlots.forEach((slot) => {
    if (!prepared.savedAncestors.has(slot.id) && !prepared.savedDescendants.has(slot.id)) return;
    push({
      level: 'error',
      code: 'cycle',
      role: slot.role,
      message: `「${name(slot.id)}」与本人是直系亲属，不能作为配偶`,
      personIds: [slot.id],
      keys: [`${slot.role}:${slot.id}`],
    });
  });

  // ---- 4. 父母年龄 ----
  parentSlots.forEach((slot) => {
    const person = persons[slot.id];
    if (!person) return;
    const block = parentAgeBlock(person, draft.birthDateSolar, parentMinGapOf(slot.role, rules));
    if (!block) return;
    push({
      level: 'error',
      code: block.reason,
      role: slot.role,
      message: `「${name(slot.id)}」${block.message}，不能作为本人的${RELATION_ROLE_LABELS[slot.role]}`,
      personIds: [slot.id],
      keys: [`${slot.role}:${slot.id}`],
      birthSensitive: true,
    });
  });

  // ---- 5. 子女生育年龄 ----
  childSlots.forEach((slot) => {
    const person = persons[slot.id];
    if (!person) return;
    const block = childAgeBlock(person, draft.birthDateSolar, slot.childType || 'biological', rules.minParentChildAgeGap);
    if (!block) return;
    push({
      level: 'error',
      code: block.reason,
      role: slot.role,
      message: `「${name(slot.id)}」${block.message}，不能作为本人的子女`,
      personIds: [slot.id],
      keys: [`${slot.role}:${slot.id}`],
      birthSensitive: true,
    });
  });

  // ---- 6. 性别与角色不符（历史数据才可能出现，提示去改性别） ----
  parentSlots.forEach((slot) => {
    const person = persons[slot.id];
    if (!person) return;
    const expected: Gender | undefined = MALE_ONLY_ROLES.includes(slot.role)
      ? 'male'
      : FEMALE_ONLY_ROLES.includes(slot.role)
        ? 'female'
        : undefined;
    // 未填写性别的人不做判定，避免把资料缺失当成关系错误
    if (!expected || !person.gender || person.gender === expected) return;
    push({
      level: 'warning',
      code: 'gender-mismatch',
      role: slot.role,
      message: `「${name(slot.id)}」的性别与「${RELATION_ROLE_LABELS[slot.role]}」不符，请核对该人员的性别资料`,
      personIds: [slot.id],
      keys: [`${slot.role}:${slot.id}`],
    });
  });

  // ---- 7. 配偶年龄 / 未成年 ----
  const now = new Date();
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
    now.getDate()
  ).padStart(2, '0')}`;
  const selfAge = ageAt(draft.birthDateSolar, draft.isAlive ? todayStr : draft.deathDateSolar);
  spouseSlots.forEach((slot) => {
    const person = persons[slot.id];
    if (!person) return;
    const gap = ageGapBetween(draft.birthDateSolar, person.birthDateSolar);
    if (gap !== undefined && gap >= 40) {
      push({
        level: 'warning',
        code: 'spouse-age-gap',
        role: slot.role,
        message: `配偶「${name(slot.id)}」与本人相差 ${gap} 岁，请核对出生日期`,
        personIds: [slot.id],
        keys: [`${slot.role}:${slot.id}`],
        birthSensitive: true,
      });
    }
    const partnerAge = currentAgeOf(person);
    if ((selfAge !== undefined && selfAge < 18) || (partnerAge !== undefined && partnerAge < 18)) {
      push({
        level: 'warning',
        code: 'spouse-minor',
        role: slot.role,
        message: `配偶「${name(slot.id)}」或本人未满 18 岁，请核对`,
        personIds: [slot.id],
        keys: [`${slot.role}:${slot.id}`],
        birthSensitive: true,
      });
    }
  });

  // ---- 8. 父母已故早于本人生日（可能是遗腹子，也可能是日期录错） ----
  parentSlots.forEach((slot) => {
    const person = persons[slot.id];
    if (!person || person.isAlive !== false || !person.deathDateSolar || !draft.birthDateSolar) return;
    const death = new Date(person.deathDateSolar).getTime();
    const birth = new Date(draft.birthDateSolar).getTime();
    if (Number.isNaN(death) || Number.isNaN(birth) || death >= birth) return;
    push({
      level: 'warning',
      code: 'parent-dead-before-birth',
      role: slot.role,
      message: `「${name(slot.id)}」的逝世日期早于本人出生日期，请核对`,
      personIds: [slot.id],
      keys: [`${slot.role}:${slot.id}`],
      birthSensitive: true,
    });
  });

  // ---- 9. 手足：保存会覆盖其现有父母 ----
  const draftParentIdList = prepared.parentIds;
  if (draftParentIdList.length > 0) {
    siblingSlots.forEach((slot) => {
      const person = persons[slot.id];
      if (!person) return;
      const ownParentIds = parentIdsOf(person);
      if (ownParentIds.length === 0) return;
      if (!ownParentIds.some((id) => !draftParentIdList.includes(id))) return;
      push({
        level: 'warning',
        code: 'sibling-parents-overwritten',
        role: slot.role,
        message: `「${name(slot.id)}」已有不同的父母，保存后其父母将被改为与本人一致`,
        personIds: [slot.id],
        keys: [`${slot.role}:${slot.id}`],
      });
    });
  }

  // ---- 10. 子女：保存会覆盖其现有父亲 / 母亲 ----
  if (draft.selfId) {
    childSlots.forEach((slot) => {
      const person = persons[slot.id];
      if (!person) return;
      const existingParent = draft.gender === 'male' ? person.relations?.father : person.relations?.mother;
      if (!existingParent || existingParent === draft.selfId) return;
      push({
        level: 'warning',
        code: 'child-parents-overwritten',
        role: slot.role,
        message: `「${name(slot.id)}」已有${draft.gender === 'male' ? '父亲' : '母亲'}，保存后将被改为本人`,
        personIds: [slot.id],
        keys: [`${slot.role}:${slot.id}`],
      });
    });
  }

  // ---- 11. 配偶与本人共享父母（疑似近亲，仅提示） ----
  if (draftParentIdList.length > 0) {
    spouseSlots.forEach((slot) => {
      const person = persons[slot.id];
      if (!person) return;
      if (!parentIdsOf(person).some((id) => draftParentIdList.includes(id))) return;
      push({
        level: 'warning',
        code: 'spouse-shares-parent',
        role: slot.role,
        message: `配偶「${name(slot.id)}」与本人拥有相同父母，请确认关系是否录入有误`,
        personIds: [slot.id],
        keys: [`${slot.role}:${slot.id}`],
      });
    });
  }

  // 去重（同一问题可能被多条规则命中）
  const seenMessages = new Set<string>();
  return issues.filter((issue) => {
    const key = `${issue.level}|${issue.message}`;
    if (seenMessages.has(key)) return false;
    seenMessages.add(key);
    return true;
  });
}

/** 取需要阻止保存的问题（历史遗留问题不算） */
export function blockingIssues(issues: RelationIssue[]): RelationIssue[] {
  return issues.filter((issue) => issue.level === 'error' && issue.introducedByEdit);
}
