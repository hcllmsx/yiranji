// 家谱数据版本与迁移
//
// meta.version 表示"家谱数据结构版本"（不是软件版本）。每次打开旧档案时：
//   1) 先按需备份 project.yrp（由调用方在密码校验通过后执行）；
//   2) 把旧格式规范化成当前格式；
//   3) 用与编辑页完全相同的硬规则扫描关系图，只断开违规的那一条边，
//      其余合法关系原样保留；缺出生日期的人不参与年龄判定。
//
// 这样既能让家谱树的计算保持干净，又不会因为一条生日录错就毁掉整片真实关系。

import type { FamilyMeta, FamilyProject, Person } from '../types';
import {
  CURRENT_DATA_VERSION,
  getAdoptiveFathers,
  getAdoptiveGroups,
  getAdoptiveMothers,
  removePersonFromAdoptiveGroups,
} from '../types';
import {
  DEFAULT_RELATION_RULES,
  RELATION_ROLE_LABELS,
  ageAt,
  personDisplayName,
  type RelationRole,
  type RelationRuleOptions,
} from './relationRules';
import { parentIdsOf } from './siblingOrder';

// ==================== 迁移报告 ====================

export interface BrokenRelation {
  /** 被断开关系里"子女 / 晚辈"一侧的人 */
  personId: string;
  personName: string;
  /** 被断开的角色，如"父亲" */
  role: string;
  /** 关系另一端的人 */
  targetId: string;
  targetName: string;
  reason: string;
}

export interface MigrationReport {
  fromVersion: string;
  toVersion: string;
  /** 是否发生了版本升级 */
  versionBumped: boolean;
  /** 实际断开了哪些关系 */
  brokenRelations: BrokenRelation[];
  /** 因断链而不再有任何亲属关系的人 */
  isolatedPersons: { id: string; name: string }[];
  /** 因缺少出生日期而跳过年龄判定的亲子关系条数（仅统计，不做任何处理） */
  skippedUnknownAge: number;
  /** 是否修改过关系数据 */
  repaired: boolean;
  /** Tauri 环境下自动备份文件的绝对路径 */
  backupPath?: string;
}

// ==================== 版本比较 ====================

/** 比较两个点分版本号：a<b 返回负数，相等返回 0，a>b 返回正数 */
export function compareVersions(a: string, b: string): number {
  const parse = (value: string) =>
    String(value || '0')
      .split(/[.\-+]/)
      .map((part) => {
        const num = parseInt(part, 10);
        return Number.isFinite(num) ? num : 0;
      });
  const left = parse(a);
  const right = parse(b);
  const length = Math.max(left.length, right.length);
  for (let i = 0; i < length; i++) {
    const diff = (left[i] || 0) - (right[i] || 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

// ==================== 格式规范化 ====================

function ensureRelations(person: Person) {
  if (!person.relations) {
    person.relations = { spouses: [], children: [] };
  }
  const relations = person.relations;
  if (!Array.isArray(relations.spouses)) relations.spouses = [];
  if (!Array.isArray(relations.children)) relations.children = [];
  // 旧版单值 / 数组养父母 → 新版分组（按索引配对，多出的一方单独成组）。
  // 存在 adoptiveParents 即视为已迁移，只清理残留的旧字段。
  if (!Array.isArray(relations.adoptiveParents)) {
    const groups = getAdoptiveGroups(relations);
    if (groups.length > 0) relations.adoptiveParents = groups;
  }
  delete relations.adoptiveFather;
  delete relations.adoptiveMother;
  delete relations.adoptiveFathers;
  delete relations.adoptiveMothers;
}

function normalizeRelations(project: FamilyProject) {
  Object.values(project.persons).forEach((person) => {
    if (!person) return;
    ensureRelations(person);
    person.photos = person.photos || [];
    person.audioFiles = person.audioFiles || [];
    person.videoFiles = person.videoFiles || [];
  });
}

// ==================== 关系边收集 ====================

type ParentGroup = 'biological' | 'adopted' | 'step';

interface ParentEdge {
  parentId: string;
  childId: string;
  role: RelationRole;
  group: ParentGroup;
}

function groupWeight(group: ParentGroup): number {
  return group === 'biological' ? 3 : group === 'adopted' ? 2 : 1;
}

/**
 * 收集全谱的父母→子女边。
 * 以"子女侧"记录为准，父母侧 children 只补缺；同一对关系只保留一条边。
 */
function collectParentEdges(persons: Record<string, Person>): ParentEdge[] {
  const map = new Map<string, ParentEdge>();
  const add = (parentId: string, childId: string, role: RelationRole, group: ParentGroup) => {
    if (!parentId || !childId) return;
    const key = `${parentId}>${childId}`;
    const existing = map.get(key);
    if (existing) {
      // 两侧记录类型不一致时取更"强"的一种（亲生 > 养 > 继）
      if (groupWeight(group) > groupWeight(existing.group)) {
        map.set(key, { parentId, childId, role, group });
      }
      return;
    }
    map.set(key, { parentId, childId, role, group });
  };

  // 1) 子女视角（权威）
  Object.values(persons).forEach((person) => {
    const relations = person?.relations;
    if (!relations) return;
    if (relations.father) add(relations.father, person.id, 'father', 'biological');
    if (relations.mother) add(relations.mother, person.id, 'mother', 'biological');
    getAdoptiveFathers(relations).forEach((id) => add(id, person.id, 'adoptiveFather', 'adopted'));
    getAdoptiveMothers(relations).forEach((id) => add(id, person.id, 'adoptiveMother', 'adopted'));
    if (relations.stepFather) add(relations.stepFather, person.id, 'stepFather', 'step');
    if (relations.stepMother) add(relations.stepMother, person.id, 'stepMother', 'step');
  });

  // 2) 父母视角补缺
  Object.values(persons).forEach((parent) => {
    (parent?.relations?.children || []).forEach((child) => {
      if (!child?.id || !persons[child.id]) return;
      const group: ParentGroup =
        child.type === 'adopted' ? 'adopted' : child.type === 'step' ? 'step' : 'biological';
      const role: RelationRole =
        group === 'adopted'
          ? parent.gender === 'male'
            ? 'adoptiveFather'
            : 'adoptiveMother'
          : group === 'step'
            ? parent.gender === 'male'
              ? 'stepFather'
              : 'stepMother'
            : parent.gender === 'male'
              ? 'father'
              : 'mother';
      add(parent.id, child.id, role, group);
    });
  });

  return Array.from(map.values());
}

/** 断开一条父母→子女边（两侧同时清理，兼容旧版单值养父母字段） */
function detachParentEdge(persons: Record<string, Person>, parentId: string, childId: string) {
  const child = persons[childId];
  if (child?.relations) {
    const relations = child.relations;
    if (relations.father === parentId) relations.father = undefined;
    if (relations.mother === parentId) relations.mother = undefined;
    if (relations.stepFather === parentId) relations.stepFather = undefined;
    if (relations.stepMother === parentId) relations.stepMother = undefined;
    if (relations.adoptiveFather === parentId) relations.adoptiveFather = undefined;
    if (relations.adoptiveMother === parentId) relations.adoptiveMother = undefined;
    if (Array.isArray(relations.adoptiveFathers)) {
      relations.adoptiveFathers = relations.adoptiveFathers.filter((id) => id !== parentId);
    }
    if (Array.isArray(relations.adoptiveMothers)) {
      relations.adoptiveMothers = relations.adoptiveMothers.filter((id) => id !== parentId);
    }
    relations.adoptiveParents = removePersonFromAdoptiveGroups(relations.adoptiveParents, parentId);
  }
  const parent = persons[parentId];
  if (parent?.relations?.children) {
    parent.relations.children = parent.relations.children.filter((item) => item?.id !== childId);
  }
}

function isSpouseOf(persons: Record<string, Person>, firstId: string, secondId: string): boolean {
  return Boolean(persons[firstId]?.relations?.spouses?.some((item) => item?.id === secondId));
}

function detachSpouse(persons: Record<string, Person>, firstId: string, secondId: string) {
  const first = persons[firstId];
  if (first?.relations?.spouses) {
    first.relations.spouses = first.relations.spouses.filter((item) => item?.id !== secondId);
  }
  const second = persons[secondId];
  if (second?.relations?.spouses) {
    second.relations.spouses = second.relations.spouses.filter((item) => item?.id !== firstId);
  }
}

/** DFS 找出一条或多条"闭合环"的父母边 */
function findCycleEdges(persons: Record<string, Person>, edges: ParentEdge[]): ParentEdge[] {
  const childrenOf = new Map<string, ParentEdge[]>();
  edges.forEach((edge) => {
    if (!childrenOf.has(edge.parentId)) childrenOf.set(edge.parentId, []);
    childrenOf.get(edge.parentId)!.push(edge);
  });

  const state = new Map<string, 1 | 2>();
  const cycleEdges: ParentEdge[] = [];
  const visit = (id: string) => {
    state.set(id, 1);
    for (const edge of childrenOf.get(id) || []) {
      if (!persons[edge.childId]) continue;
      const childState = state.get(edge.childId);
      if (childState === 1) {
        cycleEdges.push(edge);
      } else if (!childState) {
        visit(edge.childId);
      }
    }
    state.set(id, 2);
  };

  Object.keys(persons)
    .sort()
    .forEach((id) => {
      if (!state.get(id)) visit(id);
    });
  return cycleEdges;
}

/** 清理指向已不存在人员的关系 */
function cleanupDanglingRelations(persons: Record<string, Person>): number {
  const exists = new Set(Object.keys(persons));
  let removed = 0;
  const drop = (value?: string) => {
    if (!value || exists.has(value)) return value;
    removed++;
    return undefined;
  };

  Object.values(persons).forEach((person) => {
    const relations = person?.relations;
    if (!relations) return;
    relations.father = drop(relations.father);
    relations.mother = drop(relations.mother);
    relations.stepFather = drop(relations.stepFather);
    relations.stepMother = drop(relations.stepMother);
    relations.adoptiveFather = drop(relations.adoptiveFather);
    relations.adoptiveMother = drop(relations.adoptiveMother);
    if (Array.isArray(relations.adoptiveFathers)) {
      relations.adoptiveFathers = relations.adoptiveFathers.filter((id) => {
        if (exists.has(id)) return true;
        removed++;
        return false;
      });
    }
    if (Array.isArray(relations.adoptiveMothers)) {
      relations.adoptiveMothers = relations.adoptiveMothers.filter((id) => {
        if (exists.has(id)) return true;
        removed++;
        return false;
      });
    }
    if (Array.isArray(relations.adoptiveParents)) {
      relations.adoptiveParents = relations.adoptiveParents
        .map((group) => ({
          ...group,
          fatherId: drop(group.fatherId),
          motherId: drop(group.motherId),
        }))
        .filter((group) => Boolean(group.fatherId || group.motherId));
    }
    if (Array.isArray(relations.spouses)) {
      relations.spouses = relations.spouses.filter((item) => {
        if (item?.id && exists.has(item.id)) return true;
        removed++;
        return false;
      });
    }
    if (Array.isArray(relations.children)) {
      relations.children = relations.children.filter((item) => {
        if (item?.id && exists.has(item.id)) return true;
        removed++;
        return false;
      });
    }
  });
  return removed;
}

/** 同一配偶 / 同一子女被重复记录时去重（保留第一条） */
function dedupeRelationLists(persons: Record<string, Person>) {
  Object.values(persons).forEach((person) => {
    const relations = person?.relations;
    if (!relations) return;
    if (Array.isArray(relations.spouses)) {
      const seen = new Set<string>();
      relations.spouses = relations.spouses.filter((item) => {
        if (!item?.id || seen.has(item.id)) return false;
        seen.add(item.id);
        return true;
      });
    }
    if (Array.isArray(relations.children)) {
      const seen = new Set<string>();
      relations.children = relations.children.filter((item) => {
        if (!item?.id || seen.has(item.id)) return false;
        seen.add(item.id);
        return true;
      });
    }
    if (Array.isArray(relations.adoptiveFathers)) {
      relations.adoptiveFathers = Array.from(new Set(relations.adoptiveFathers.filter(Boolean)));
    }
    if (Array.isArray(relations.adoptiveMothers)) {
      relations.adoptiveMothers = Array.from(new Set(relations.adoptiveMothers.filter(Boolean)));
    }
    // 同一个人不能出现在两个养父母组里
    if (Array.isArray(relations.adoptiveParents)) {
      const seenParents = new Set<string>();
      relations.adoptiveParents = relations.adoptiveParents
        .map((group) => {
          const fatherId = group.fatherId && !seenParents.has(group.fatherId) ? group.fatherId : undefined;
          if (fatherId) seenParents.add(fatherId);
          const motherId = group.motherId && !seenParents.has(group.motherId) ? group.motherId : undefined;
          if (motherId) seenParents.add(motherId);
          return { ...group, fatherId, motherId };
        })
        .filter((group) => Boolean(group.fatherId || group.motherId));
    }
  });
}

// ==================== 关系修复 ====================

export interface RepairResult {
  broken: BrokenRelation[];
  isolated: { id: string; name: string }[];
  skippedUnknownAge: number;
}

function describeBroken(
  persons: Record<string, Person>,
  edge: ParentEdge,
  reason: string
): BrokenRelation {
  return {
    personId: edge.childId,
    personName: personDisplayName(persons[edge.childId]),
    role: RELATION_ROLE_LABELS[edge.role],
    targetId: edge.parentId,
    targetName: personDisplayName(persons[edge.parentId]),
    reason,
  };
}

/**
 * 扫描并修复关系图。
 * 只断违规的那条边：父母关系同时清理子女侧字段与父母侧 children，配偶关系双向移除。
 */
export function repairRelations(
  persons: Record<string, Person>,
  rules: RelationRuleOptions = DEFAULT_RELATION_RULES
): RepairResult {
  const broken: BrokenRelation[] = [];
  let skippedUnknownAge = 0;
  // 修一轮会重新扫描全部亲子边，同一对缺生日的不能被重复计数
  const skippedEdgeKeys = new Set<string>();
  const noteUnknownAge = (parentId: string, childId: string) => {
    const key = `${parentId}>${childId}`;
    if (skippedEdgeKeys.has(key)) return;
    skippedEdgeKeys.add(key);
    skippedUnknownAge++;
  };
  let guard = 0;

  while (guard++ < 50) {
    const edges = collectParentEdges(persons);
    let changed = false;

    // 1) 自指
    for (const edge of edges) {
      if (edge.parentId !== edge.childId) continue;
      detachParentEdge(persons, edge.parentId, edge.childId);
      broken.push(describeBroken(persons, edge, '不能把自己设为亲属'));
      changed = true;
    }
    if (changed) continue;

    // 2) 成环
    const cycleEdges = findCycleEdges(persons, edges);
    if (cycleEdges.length > 0) {
      cycleEdges.forEach((edge) => {
        detachParentEdge(persons, edge.parentId, edge.childId);
        broken.push(describeBroken(persons, edge, '父母关系成环'));
      });
      continue;
    }

    // 3) 同一对既是父母又是配偶
    for (const edge of edges) {
      if (!isSpouseOf(persons, edge.parentId, edge.childId)) continue;
      detachSpouse(persons, edge.parentId, edge.childId);
      broken.push(describeBroken(persons, edge, '同一人同时是父母与配偶'));
      changed = true;
    }
    if (changed) continue;

    // 4) A 是 B 的父母，但 A 与 B 还共享另一位父母（A 同时是 B 的手足）
    for (const edge of edges) {
      const parent = persons[edge.parentId];
      const child = persons[edge.childId];
      if (!parent || !child) continue;
      const parentParentIds = parentIdsOf(parent);
      const childOtherParentIds = parentIdsOf(child).filter((id) => id !== edge.parentId);
      if (!childOtherParentIds.some((id) => parentParentIds.includes(id))) continue;
      detachParentEdge(persons, edge.parentId, edge.childId);
      broken.push(describeBroken(persons, edge, '同一人同时是父母与手足'));
      changed = true;
    }
    if (changed) continue;

    // 5) 年龄：缺任一方生日 → 跳过（年龄未知不等于关系错误）
    for (const edge of edges) {
      const parent = persons[edge.parentId];
      const child = persons[edge.childId];
      if (!parent || !child) continue;
      if (!parent.birthDateSolar || !child.birthDateSolar) {
        noteUnknownAge(edge.parentId, edge.childId);
        continue;
      }
      const parentBirth = new Date(parent.birthDateSolar).getTime();
      const childBirth = new Date(child.birthDateSolar).getTime();
      if (Number.isNaN(parentBirth) || Number.isNaN(childBirth)) {
        noteUnknownAge(edge.parentId, edge.childId);
        continue;
      }
      if (parentBirth >= childBirth) {
        detachParentEdge(persons, edge.parentId, edge.childId);
        broken.push(describeBroken(persons, edge, '父母出生日期不早于子女'));
        changed = true;
        continue;
      }
      // 最小生育年龄只约束亲生关系；养父母 / 继父母年龄差可能很小，不做清理
      if (edge.group !== 'biological') continue;
      const gap = ageAt(parent.birthDateSolar, child.birthDateSolar);
      if (gap !== undefined && gap < rules.minParentChildAgeGap) {
        detachParentEdge(persons, edge.parentId, edge.childId);
        broken.push(
          describeBroken(persons, edge, `父母与子女相差仅 ${gap} 岁，不足 ${rules.minParentChildAgeGap} 岁`)
        );
        changed = true;
      }
    }
    if (changed) continue;

    break;
  }

  cleanupDanglingRelations(persons);
  dedupeRelationLists(persons);

  // 只统计"因为本次断链才变孤立"的人，原本就独身的人不打扰用户
  const affected = new Set<string>();
  broken.forEach((item) => {
    affected.add(item.personId);
    affected.add(item.targetId);
  });
  const linked = new Set<string>();
  collectParentEdges(persons).forEach((edge) => {
    linked.add(edge.parentId);
    linked.add(edge.childId);
  });
  Object.values(persons).forEach((person) => {
    (person?.relations?.spouses || []).forEach((spouse) => {
      if (!spouse?.id) return;
      linked.add(person.id);
      linked.add(spouse.id);
    });
  });
  const isolated = Array.from(affected)
    .filter((id) => persons[id] && !linked.has(id))
    .map((id) => ({ id, name: personDisplayName(persons[id]) }));

  return { broken, isolated, skippedUnknownAge };
}

// ==================== 迁移入口 ====================

function ensureMeta(project: FamilyProject): FamilyMeta {
  if (!project.meta) {
    project.meta = {
      version: '0.0.0',
      familyName: '未命名家谱',
      surname: '',
      hasPassword: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }
  return project.meta;
}

/**
 * 迁移入口：所有打开 / 导入 / 云同步的加载点都必须走这里。
 * 纯内存操作，不写盘；需要持久化时由调用方在密码校验通过后执行。
 */
export function migrateProjectData(project: FamilyProject): {
  project: FamilyProject;
  report: MigrationReport;
} {
  const meta = project ? ensureMeta(project) : undefined;
  const fromVersion = meta?.version || '0.0.0';
  const report: MigrationReport = {
    fromVersion,
    toVersion: CURRENT_DATA_VERSION,
    versionBumped: false,
    brokenRelations: [],
    isolatedPersons: [],
    skippedUnknownAge: 0,
    repaired: false,
  };

  if (!project) return { project, report };
  if (!project.persons) project.persons = {};

  normalizeRelations(project);

  if (compareVersions(fromVersion, CURRENT_DATA_VERSION) >= 0) {
    return { project, report };
  }

  const repair = repairRelations(project.persons);
  report.brokenRelations = repair.broken;
  report.isolatedPersons = repair.isolated;
  report.skippedUnknownAge = repair.skippedUnknownAge;
  report.repaired = repair.broken.length > 0;
  report.versionBumped = true;

  const currentMeta = ensureMeta(project);
  currentMeta.version = CURRENT_DATA_VERSION;
  currentMeta.updatedAt = new Date().toISOString();

  return { project, report };
}
