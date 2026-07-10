// 以苒纪 — Zustand 状态管理

import { create } from 'zustand';
import { v4 as uuidv4 } from 'uuid';
import type {
  FamilyProject,
  FamilyMeta,
  Person,
  RecentProject,
} from '../types';
import {
  createDefaultPerson,
  createDefaultMeta as makeDefaultMeta,
} from '../types';
import { sha256, generateAnonymizedNames } from '../utils';
import {
  isTauri,
  saveYrjFile,
  selectFilePathForSave,
  saveProjectJson,
  unpackYrj,
  loadProjectJson,
  packToYrj,
} from '../utils/tauri';

// ==================== 持久化工具 ====================

const STORAGE_PREFIX = 'yiranji_project_';
const RECENT_KEY = 'yiranji_recent_projects';

function saveProject(projectId: string, project: FamilyProject) {
  localStorage.setItem(STORAGE_PREFIX + projectId, JSON.stringify(project));
}

/** 自动持久化：在每次 set() 修改 project 后立即写入（支持 Web 端和 Tauri 端） */
function autoSave(get: () => FamilyStore) {
  const { currentProjectId, project, currentFilePath } = get();
  if (!currentProjectId || !project) return;
  if (isTauri() && currentFilePath) {
    saveProjectJson(currentFilePath, JSON.stringify(project, null, 2))
      .catch((e) => console.error('自动保存文件失败:', e));
  } else {
    saveProject(currentProjectId, project);
  }
}

function loadProject(projectId: string): FamilyProject | null {
  const raw = localStorage.getItem(STORAGE_PREFIX + projectId);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as FamilyProject;
  } catch {
    return null;
  }
}

/** 自动升级旧版养父母数据结构为新版数组格式 */
function migrateProjectData(project: FamilyProject): FamilyProject {
  if (!project || !project.persons) return project;
  Object.values(project.persons).forEach((p) => {
    if (!p.relations) {
      p.relations = { spouses: [], children: [] };
    }
    if (p.relations.adoptiveFather && (!p.relations.adoptiveFathers || p.relations.adoptiveFathers.length === 0)) {
      p.relations.adoptiveFathers = [p.relations.adoptiveFather];
    }
    if (p.relations.adoptiveMother && (!p.relations.adoptiveMothers || p.relations.adoptiveMothers.length === 0)) {
      p.relations.adoptiveMothers = [p.relations.adoptiveMother];
    }
  });
  return project;
}

function getRecentProjects(): RecentProject[] {
  const raw = localStorage.getItem(RECENT_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as RecentProject[];
  } catch {
    return [];
  }
}

function saveRecentProjects(projects: RecentProject[]) {
  localStorage.setItem(RECENT_KEY, JSON.stringify(projects));
}

// ==================== Store 定义 ====================

interface FamilyStore {
  // 当前项目状态
  currentProjectId: string | null;
  project: FamilyProject | null;
  isDirty: boolean;
  recentProjects: RecentProject[];
  currentFilePath: string | null;
  projectPassword: string | null;

  // 开发者工具状态
  isAnonymized: boolean;
  anonymizedNames: Record<string, string>;

  // 项目操作
  createProject: (
    surname: string,
    password?: string,
    filePath?: string,
    customFamilyName?: string
  ) => Promise<string>;
  openProject: (projectId: string) => boolean;
  openProjectFromFile: (
    path: string,
    password?: string,
    skipPasswordCheck?: boolean
  ) => Promise<boolean>;
  importProjectFromJSON: (project: FamilyProject) => Promise<string>;
  saveCustomLayout: (layout: Record<string, { x: number; y: number }>) => void;
  clearCustomLayout: () => void;
  closeProject: () => void;
  saveCurrentProject: () => Promise<void>;
  saveProjectAs: () => Promise<boolean>;
  loadRecentProjects: () => void;
  removeRecentProject: (projectId: string, filePath?: string) => void;

  // 元数据操作
  updateMeta: (updates: Partial<FamilyMeta>) => void;
  changeProjectPassword: (newPassword: string | null) => Promise<void>;

  // 人员操作
  addPerson: (personData?: Partial<Person>) => string;
  updatePerson: (id: string, updates: Partial<Person>) => void;
  deletePerson: (id: string) => void;
  getPerson: (id: string) => Person | undefined;
  getPersonsList: () => Person[];
  setDefaultPerspective: (id: string) => void;

  // 关系操作
  setRelation: (personId: string, relationType: string, targetId: string | null) => void;
  addSpouse: (personId: string, spouseId: string, type?: string) => void;
  removeSpouse: (personId: string, spouseId: string) => void;
  addChild: (personId: string, childId: string, type?: string) => void;
  removeChild: (personId: string, childId: string) => void;

  // 开发者工具操作
  toggleAnonymization: () => void;
}

export const useFamilyStore = create<FamilyStore>((set, get) => ({
  currentProjectId: null,
  project: null,
  isDirty: false,
  recentProjects: [],
  currentFilePath: null,
  projectPassword: null,
  isAnonymized: false,
  anonymizedNames: {},

  // ==================== 项目操作 ====================

  createProject: async (
    surname: string,
    password?: string,
    filePath?: string,
    customFamilyName?: string
  ) => {
    const projectId = uuidv4();
    const now = new Date().toISOString();
    const passwordHash = password ? await sha256(password) : undefined;

    const meta: FamilyMeta = {
      ...makeDefaultMeta(surname),
      familyName: customFamilyName || `${surname}氏-以苒纪`,
      hasPassword: !!password,
      passwordHash,
      createdAt: now,
      updatedAt: now,
    };
    const project: FamilyProject = {
      meta,
      persons: {},
    };

    if (isTauri() && filePath) {
      // 必须调用 saveProjectJson 写入到工作文件夹根下的 project.json 中！
      saveProjectJson(filePath, JSON.stringify(project, null, 2))
        .catch((e) => console.error('新建时保存 project.json 失败:', e));
    } else {
      saveProject(projectId, project);
    }

    // 更新最近项目
    const recent = getRecentProjects();
    const recentItem: RecentProject = {
      familyName: meta.familyName,
      surname: meta.surname,
      lastOpenedAt: now,
      projectId,
    };
    if (filePath) {
      recentItem.filePath = filePath;
    }

    const filteredRecent = recent.filter((r) => !filePath || r.filePath !== filePath);
    filteredRecent.unshift(recentItem);
    saveRecentProjects(filteredRecent.slice(0, 10));

    set({
      currentProjectId: projectId,
      currentFilePath: filePath || null,
      projectPassword: password || null,
      project,
      isDirty: false,
      recentProjects: filteredRecent.slice(0, 10),
    });

    return projectId;
  },

  removeRecentProject: (projectId: string, filePath?: string) => {
    const recent = getRecentProjects();
    // 有 filePath 时以路径精确匹配；无 filePath（纯 Web localStorage 模式）时才以 projectId 匹配
    const filtered = recent.filter(
      (r) => (filePath ? r.filePath !== filePath : r.projectId !== projectId)
    );
    saveRecentProjects(filtered);
    set({ recentProjects: filtered });
  },

  openProject: (projectId: string) => {
    // 该方法一般用于 Web 版 localStorage 的历史文件
    const rawProject = loadProject(projectId);
    if (!rawProject) return false;
    const project = migrateProjectData(rawProject);

    // 更新最近项目
    const recent = getRecentProjects();
    const filtered = recent.filter((r) => r.projectId !== projectId);
    filtered.unshift({
      familyName: project.meta.familyName,
      surname: project.meta.surname,
      lastOpenedAt: new Date().toISOString(),
      projectId,
    });
    saveRecentProjects(filtered.slice(0, 10));

    set({
      currentProjectId: projectId,
      currentFilePath: null,
      projectPassword: null,
      project,
      isDirty: false,
      recentProjects: filtered.slice(0, 10),
    });
    return true;
  },

  openProjectFromFile: async (
    path: string,
    password?: string,
    skipPasswordCheck?: boolean
  ) => {
    try {
      let workspacePath = path;

      // 1. 如果用户打开的是 .yrj 文件包，则自动解压至同级同名的工作区文件夹下
      if (path.endsWith('.yrj')) {
        const normalized = path.replace(/\\/g, '/');
        const lastSlash = normalized.lastIndexOf('/');
        const parentDir = lastSlash !== -1 ? normalized.substring(0, lastSlash) : '.';
        const fileName = lastSlash !== -1 ? normalized.substring(lastSlash + 1) : normalized;
        const folderName = fileName.endsWith('.yrj')
          ? fileName.substring(0, fileName.length - 4)
          : fileName;

        workspacePath = await unpackYrj(path, parentDir, folderName, password);
      }

      // 2. 直接以高速明文读取加载工作区下的 project.json 属性
      const json = await loadProjectJson(workspacePath);
      const rawProject = JSON.parse(json) as FamilyProject;
      const project = migrateProjectData(rawProject);
      // 从外部文件/文件夹打开时，总生成新的 projectId，避免与源项目或其他历史记录冲突
      const projectId = uuidv4();

      // 3. 校验密码保护（当 skipPasswordCheck 为 true 时跳过核验，极速进树）
      if (project.meta.hasPassword && !skipPasswordCheck) {
        const inputHash = password ? await sha256(password) : '';
        if (project.meta.passwordHash && inputHash !== project.meta.passwordHash) {
          const error = new Error('PASSWORD_REQUIRED_OR_INCORRECT');
          // 将已解包的工作区路径附带在错误上，避免调用方用 .yrj 路径重试导致二次解包
          (error as any).workspacePath = workspacePath;
          throw error;
        }
      }

      let discardedEmbeddedMedia = false;
      for (const person of Object.values(project.persons)) {
        if (person.avatar?.startsWith('data:')) {
          person.avatar = undefined;
          discardedEmbeddedMedia = true;
        }

        // 兼容旧数据 / 脱敏数据中媒体数组可能缺失的情况
        const photos = person.photos?.filter((photo) => !photo.path.startsWith('data:')) ?? [];
        const audioFiles = person.audioFiles?.filter((audio) => !audio.path.startsWith('data:')) ?? [];
        const videoFiles = person.videoFiles?.filter((video) => !video.path.startsWith('data:')) ?? [];

        const originalPhotosLen = person.photos?.length ?? 0;
        const originalAudioLen = person.audioFiles?.length ?? 0;
        const originalVideoLen = person.videoFiles?.length ?? 0;

        if (
          photos.length !== originalPhotosLen ||
          audioFiles.length !== originalAudioLen ||
          videoFiles.length !== originalVideoLen
        ) {
          person.photos = photos;
          person.audioFiles = audioFiles;
          person.videoFiles = videoFiles;
          discardedEmbeddedMedia = true;
        }
      }

      if (discardedEmbeddedMedia) {
        await saveProjectJson(workspacePath, JSON.stringify(project, null, 2));
      }

      // 更新最近项目，绑定解压后的工作文件夹路径
      const recent = getRecentProjects();
      const filtered = recent.filter((r) => r.filePath !== workspacePath);
      filtered.unshift({
        familyName: project.meta.familyName,
        surname: project.meta.surname,
        lastOpenedAt: new Date().toISOString(),
        projectId,
        filePath: workspacePath,
      });
      saveRecentProjects(filtered.slice(0, 10));

      set({
        currentProjectId: projectId,
        currentFilePath: workspacePath,
        projectPassword: password || null,
        project,
        isDirty: false,
        recentProjects: filtered.slice(0, 10),
      });
      return true;
    } catch (err) {
      console.error('从工作区加载项目失败:', err);
      throw err;
    }
  },

  importProjectFromJSON: async (rawProject: FamilyProject) => {
    const project = migrateProjectData(rawProject);
    // 导入 JSON 时总生成新的 projectId，避免与已有项目冲突
    const projectId = uuidv4();
    const now = new Date().toISOString();

    const recent = getRecentProjects();
    const filtered = recent.filter((r) => r.projectId !== projectId);
    filtered.unshift({
      familyName: project.meta.familyName,
      surname: project.meta.surname,
      lastOpenedAt: now,
      projectId,
    });
    saveRecentProjects(filtered.slice(0, 10));

    saveProject(projectId, project);

    set({
      currentProjectId: projectId,
      currentFilePath: null,
      projectPassword: null,
      project,
      isDirty: false,
      recentProjects: filtered.slice(0, 10),
    });

    return projectId;
  },

  saveCustomLayout: (layout: Record<string, { x: number; y: number }>) => {
    const { project } = get();
    if (!project) return;
    const updated = {
      ...project,
      customLayout: layout,
    };
    set({ project: updated, isDirty: true });
    autoSave(get);
  },

  clearCustomLayout: () => {
    const { project } = get();
    if (!project) return;
    const { customLayout, ...rest } = project;
    set({ project: rest as FamilyProject, isDirty: true });
    autoSave(get);
  },

  closeProject: () => {
    const state = get();
    if (state.isDirty && state.currentProjectId && state.project) {
      if (isTauri() && state.currentFilePath) {
        saveProjectJson(state.currentFilePath, JSON.stringify(state.project, null, 2))
          .catch((e) => console.error('关闭时保存工作区失败:', e));
      } else {
        saveProject(state.currentProjectId, state.project);
      }
    }
    set({
      currentProjectId: null,
      project: null,
      isDirty: false,
      currentFilePath: null,
      projectPassword: null,
    });
  },

  saveCurrentProject: async () => {
    const { currentProjectId, project, currentFilePath } = get();
    if (!currentProjectId || !project) return;
    const updated = {
      ...project,
      meta: { ...project.meta, updatedAt: new Date().toISOString() },
    };

    if (isTauri() && currentFilePath) {
      try {
        await saveProjectJson(currentFilePath, JSON.stringify(updated, null, 2));
        set({ project: updated, isDirty: false });
      } catch (err) {
        console.error('保存工作区 project.json 失败:', err);
        throw err;
      }
    } else {
      saveProject(currentProjectId, updated);
      set({ project: updated, isDirty: false });
    }
  },

  saveProjectAs: async () => {
    const { project, currentFilePath, projectPassword } = get();
    if (!project) return false;

    // 另存为：弹出对话框让用户指定打包好的 YRJ 文件名及保存位置
    const defaultName = `${project.meta.familyName}.yrj`;
    const path = await selectFilePathForSave(defaultName);
    if (!path) return false;

    const updated = {
      ...project,
      meta: { ...project.meta, updatedAt: new Date().toISOString() },
    };

    try {
      if (isTauri() && currentFilePath) {
        // 先确保工作区 project.json 处于最新状态
        await saveProjectJson(currentFilePath, JSON.stringify(updated, null, 2));
        // 将整个工作区目录（包括 project.json 与 media/ 照片）一并进行 ZIP 压缩加密打包导出为单文件
        await packToYrj(currentFilePath, path, projectPassword || undefined);
      } else {
        // Web 环境下另存为退步为 YRJ 单文件下载（保持兼容）
        await saveYrjFile(path, JSON.stringify(updated, null, 2), projectPassword || undefined);
      }

      set({
        project: updated,
        isDirty: false,
      });
      return true;
    } catch (err) {
      console.error('打包导出另存为 YRJ 失败:', err);
      return false;
    }
  },

  loadRecentProjects: () => {
    set({ recentProjects: getRecentProjects() });
  },

  // ==================== 元数据操作 ====================

  updateMeta: (updates: Partial<FamilyMeta>) => {
    const { project, currentProjectId, currentFilePath } = get();
    if (!project || !currentProjectId) return;
    
    const updatedMeta = { ...project.meta, ...updates, updatedAt: new Date().toISOString() };
    const updatedProject = {
      ...project,
      meta: updatedMeta,
    };

    // 同步更新最近打开项目列表中的本条数据
    const recent = getRecentProjects();
    const targetIdx = recent.findIndex(r => r.projectId === currentProjectId || (currentFilePath && r.filePath === currentFilePath));
    if (targetIdx !== -1) {
      if (updates.familyName) recent[targetIdx].familyName = updates.familyName;
      if (updates.surname) recent[targetIdx].surname = updates.surname;
      saveRecentProjects(recent);
    }

    set({
      project: updatedProject,
      isDirty: true,
      recentProjects: recent,
    });
    
    autoSave(get);
  },

  changeProjectPassword: async (newPassword: string | null) => {
    const { project, currentProjectId } = get();
    if (!project || !currentProjectId) return;

    const passwordHash = newPassword ? await sha256(newPassword) : undefined;
    
    const updatedMeta = {
      ...project.meta,
      hasPassword: !!newPassword,
      passwordHash,
      updatedAt: new Date().toISOString(),
    };
    
    const updatedProject = {
      ...project,
      meta: updatedMeta,
    };

    // 同步更新最近项目里面的 hasPassword 标识状态（如果最近项目有存储的话）
    // 我们的 RecentProject 结构中暂不需要 hasPassword 标识，如果有未来拓展需要也可同步

    set({
      project: updatedProject,
      projectPassword: newPassword || null,
      isDirty: true,
    });
    
    autoSave(get);
  },

  // ==================== 人员操作 ====================

  addPerson: (personData?: Partial<Person>) => {
    const { project } = get();
    if (!project) return '';

    const id = personData?.id || uuidv4();
    const now = new Date().toISOString();
    const defaults = createDefaultPerson(project.meta.surname);
    const isFirst = Object.keys(project.persons).length === 0;

    const person: Person = {
      ...defaults,
      ...personData,
      id,
      surname: personData?.surname ?? defaults.surname,
      givenName: personData?.givenName ?? defaults.givenName,
      gender: personData?.gender ?? defaults.gender,
      birthTimePrecision: personData?.birthTimePrecision ?? defaults.birthTimePrecision,
      deathTimePrecision: personData?.deathTimePrecision ?? defaults.deathTimePrecision,
      isAlive: personData?.isAlive ?? defaults.isAlive,
      photos: personData?.photos ?? [],
      audioFiles: personData?.audioFiles ?? [],
      videoFiles: personData?.videoFiles ?? [],
      relations: personData?.relations ?? { spouses: [], children: [] },
      isDefaultPerspective: isFirst,
      createdAt: now,
      updatedAt: now,
    };

    const newPersons = { ...project.persons, [id]: person };
    const newMeta = {
      ...project.meta,
      updatedAt: now,
      ...(isFirst ? { defaultPerspectiveId: id } : {}),
    };

    set({
      project: { meta: newMeta, persons: newPersons },
      isDirty: false,
    });
    autoSave(get);

    return id;
  },

  updatePerson: (id: string, updates: Partial<Person>) => {
    const { project } = get();
    if (!project || !project.persons[id]) return;

    const updated: Person = {
      ...project.persons[id],
      ...updates,
      id, // 确保 id 不被覆盖
      updatedAt: new Date().toISOString(),
    };

    set({
      project: {
        ...project,
        persons: { ...project.persons, [id]: updated },
        meta: { ...project.meta, updatedAt: new Date().toISOString() },
      },
      isDirty: false,
    });
    autoSave(get);
  },

  deletePerson: (id: string) => {
    const { project } = get();
    if (!project) return;

    const newPersons = { ...project.persons };
    delete newPersons[id];

    // 清理所有人员中对该人员的关系引用
    Object.values(newPersons).forEach((p) => {
      const r = p.relations;
      if (r.father === id) r.father = undefined;
      if (r.mother === id) r.mother = undefined;
      if (r.adoptiveFather === id) r.adoptiveFather = undefined;
      if (r.adoptiveMother === id) r.adoptiveMother = undefined;
      if (r.adoptiveFathers) r.adoptiveFathers = r.adoptiveFathers.filter(fid => fid !== id);
      if (r.adoptiveMothers) r.adoptiveMothers = r.adoptiveMothers.filter(mid => mid !== id);
      if (r.stepFather === id) r.stepFather = undefined;
      if (r.stepMother === id) r.stepMother = undefined;
      r.spouses = r.spouses.filter((s) => s.id !== id);
      r.children = r.children.filter((c) => c.id !== id);
    });

    const newMeta = { ...project.meta, updatedAt: new Date().toISOString() };
    if (newMeta.defaultPerspectiveId === id) {
      const remaining = Object.keys(newPersons);
      newMeta.defaultPerspectiveId = remaining.length > 0 ? remaining[0] : undefined;
    }

    set({
      project: { meta: newMeta, persons: newPersons },
      isDirty: false,
    });
    autoSave(get);
  },

  getPerson: (id: string) => {
    return get().project?.persons[id];
  },

  getPersonsList: () => {
    const { project } = get();
    if (!project) return [];
    return Object.values(project.persons);
  },

  setDefaultPerspective: (id: string) => {
    const { project } = get();
    if (!project || !project.persons[id]) return;

    // 取消旧的默认视角
    const newPersons = { ...project.persons };
    Object.values(newPersons).forEach((p) => {
      if (p.isDefaultPerspective) {
        newPersons[p.id] = { ...p, isDefaultPerspective: false };
      }
    });

    // 设置新的默认视角
    newPersons[id] = { ...newPersons[id], isDefaultPerspective: true };

    set({
      project: {
        ...project,
        persons: newPersons,
        meta: {
          ...project.meta,
          defaultPerspectiveId: id,
          updatedAt: new Date().toISOString(),
        },
      },
      isDirty: true,
    });
  },

  // ==================== 关系操作 ====================

  setRelation: (personId: string, relationType: string, targetId: string | null) => {
    const { project } = get();
    if (!project || !project.persons[personId]) return;

    const person = { ...project.persons[personId] };
    const relations = { ...person.relations };

    const validKeys = ['father', 'mother', 'adoptiveFather', 'adoptiveMother', 'stepFather', 'stepMother'];
    if (validKeys.includes(relationType)) {
      (relations as any)[relationType] = targetId ?? undefined;
    }

    // 支持数组形式的养父母
    if (relationType === 'adoptiveFathers' && targetId) {
      relations.adoptiveFathers = relations.adoptiveFathers || [];
      if (!relations.adoptiveFathers.includes(targetId)) {
        relations.adoptiveFathers = [...relations.adoptiveFathers, targetId];
      }
      // 同步设置旧版单值字段（兼容）
      if (!relations.adoptiveFather) {
        relations.adoptiveFather = targetId;
      }
    }
    if (relationType === 'adoptiveMothers' && targetId) {
      relations.adoptiveMothers = relations.adoptiveMothers || [];
      if (!relations.adoptiveMothers.includes(targetId)) {
        relations.adoptiveMothers = [...relations.adoptiveMothers, targetId];
      }
      if (!relations.adoptiveMother) {
        relations.adoptiveMother = targetId;
      }
    }

    person.relations = relations;
    person.updatedAt = new Date().toISOString();

    const newPersons = { ...project.persons, [personId]: person };

    // 双向写入：自动将当前子女加到对应的父母 children 列表中
    if (targetId && newPersons[targetId]) {
      const parent = { ...newPersons[targetId] };
      const pRels = { ...parent.relations };
      pRels.children = pRels.children || [];
      if (!pRels.children.some((c: any) => c.id === personId)) {
        let childType: 'biological' | 'adopted' | 'step' = 'biological';
        if (relationType.startsWith('adoptive')) childType = 'adopted';
        if (relationType.startsWith('step')) childType = 'step';

        pRels.children = [...pRels.children, { id: personId, type: childType }];
        parent.relations = pRels;
        parent.updatedAt = new Date().toISOString();
        newPersons[targetId] = parent;
      }
    }

    set({
      project: {
        ...project,
        persons: newPersons,
        meta: { ...project.meta, updatedAt: new Date().toISOString() },
      },
      isDirty: false,
    });
    autoSave(get);
  },

  addSpouse: (personId: string, spouseId: string, type = 'married') => {
    const { project } = get();
    if (!project || !project.persons[personId]) return;

    const person = { ...project.persons[personId] };
    const relations = { ...person.relations };
    if (!relations.spouses.find((s) => s.id === spouseId)) {
      relations.spouses = [...relations.spouses, { id: spouseId, type: type as any }];
    }
    person.relations = relations;
    person.updatedAt = new Date().toISOString();

    // 同时在配偶那边也添加关系
    const spouse = { ...project.persons[spouseId] };
    if (spouse && !spouse.relations.spouses.find((s) => s.id === personId)) {
      spouse.relations = {
        ...spouse.relations,
        spouses: [...spouse.relations.spouses, { id: personId, type: type as any }],
      };
      spouse.updatedAt = new Date().toISOString();
    }

    set({
      project: {
        ...project,
        persons: {
          ...project.persons,
          [personId]: person,
          [spouseId]: spouse,
        },
        meta: { ...project.meta, updatedAt: new Date().toISOString() },
      },
      isDirty: false,
    });
    autoSave(get);
  },

  removeSpouse: (personId: string, spouseId: string) => {
    const { project } = get();
    if (!project || !project.persons[personId]) return;

    const person = { ...project.persons[personId] };
    person.relations = {
      ...person.relations,
      spouses: person.relations.spouses.filter((s) => s.id !== spouseId),
    };

    const spouse = { ...project.persons[spouseId] };
    if (spouse) {
      spouse.relations = {
        ...spouse.relations,
        spouses: spouse.relations.spouses.filter((s) => s.id !== personId),
      };
    }

    set({
      project: {
        ...project,
        persons: {
          ...project.persons,
          [personId]: person,
          [spouseId]: spouse,
        },
        meta: { ...project.meta, updatedAt: new Date().toISOString() },
      },
      isDirty: false,
    });
    autoSave(get);
  },

  addChild: (personId: string, childId: string, type = 'biological') => {
    const { project } = get();
    if (!project || !project.persons[personId]) return;

    const person = { ...project.persons[personId] };
    const relations = { ...person.relations };
    if (!relations.children.find((c) => c.id === childId)) {
      relations.children = [...relations.children, { id: childId, type: type as any }];
    }
    person.relations = relations;
    person.updatedAt = new Date().toISOString();

    set({
      project: {
        ...project,
        persons: { ...project.persons, [personId]: person },
        meta: { ...project.meta, updatedAt: new Date().toISOString() },
      },
      isDirty: false,
    });
    autoSave(get);
  },

  removeChild: (personId: string, childId: string) => {
    const { project } = get();
    if (!project || !project.persons[personId]) return;

    const person = { ...project.persons[personId] };
    person.relations = {
      ...person.relations,
      children: person.relations.children.filter((c) => c.id !== childId),
    };

    set({
      project: {
        ...project,
        persons: { ...project.persons, [personId]: person },
        meta: { ...project.meta, updatedAt: new Date().toISOString() },
      },
      isDirty: false,
    });
    autoSave(get);
  },

  // ==================== 开发者工具操作 ====================

  toggleAnonymization: () => {
    const { isAnonymized, project } = get();
    if (!project) return;

    if (isAnonymized) {
      // 取消匿名化
      set({ isAnonymized: false });
    } else {
      // 开启匿名化：按创建顺序生成匿名名称
      const names = generateAnonymizedNames(project.persons);
      set({ isAnonymized: true, anonymizedNames: names });
    }
  },
}));
