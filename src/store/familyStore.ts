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
  createAdoptiveGroupId,
  removePersonFromAdoptiveGroups,
} from '../types';
import { sha256, generateAnonymizedNames } from '../utils';
import type { TreeLayoutMode } from '../utils/appPrefs';
import {
  isTauri,
  selectFilePathForSave,
  saveProjectJson,
  backupProjectJson,
  unpackYrj,
  loadProjectJson,
  packToYrj,
  createUniqueProjectWorkspace,
  resolveWorkspaceDir,
  writeBinaryFile,
  webdavPush,
  webdavPull,
  webdavRemoteMeta,
  type RemoteSyncMeta,
  type SyncPushReport,
  type SyncPullReport,
} from '../utils/tauri';
import {
  rebaseMediaPathsToWorkspace,
  registerLegacyAvatarOriginals,
} from '../utils/projectPortable';
import { getSyncSettings, isSyncConfigured, remoteDirFor, ensureSyncKey } from '../utils/cloudSync';
import { saveRecentProjectsList } from '../utils/appSettings';
import { migrateProjectData, type MigrationReport } from '../utils/dataMigration';

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

/** 自动升级旧版养父母数据结构为新版数组格式（已并入 dataMigration，保留入口注释） */

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
  saveRecentProjectsList(projects);
}

// ==================== 保存后自动上传 ====================

// 连续保存（如批量导入照片）合并成一次上传，避免把带宽和云端版本号刷爆
let autoPushTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleAutoPush() {
  if (!isTauri()) return;
  const settings = getSyncSettings();
  if (!settings.enabled || !settings.autoPush || !isSyncConfigured(settings)) return;

  if (autoPushTimer) clearTimeout(autoPushTimer);
  autoPushTimer = setTimeout(() => {
    autoPushTimer = null;
    void runAutoPush();
  }, 5000);
}

async function runAutoPush() {
  const state = useFamilyStore.getState();
  const { project, currentFilePath } = state;
  if (!project?.meta.syncKey || !currentFilePath) return;

  const settings = getSyncSettings();
  if (!settings.enabled || !settings.autoPush || !isSyncConfigured(settings)) return;

  try {
    // 云端更新时不要静默覆盖，交给界面上的提示条让用户决定
    const remote = await webdavRemoteMeta(
      settings.server,
      settings.username,
      settings.password,
      remoteDirFor(settings, project.meta.syncKey)
    );
    if (remote?.projectUpdatedAt && remote.projectUpdatedAt > (project.meta.updatedAt || '')) {
      return;
    }
    await state.syncPushToCloud();
  } catch {
    // 网络异常不应影响本地保存，静默失败
  }
}

// ==================== Store 定义 ====================

/** 一键同步的结果，供界面提示用 */
export interface QuickSyncResult {
  action: 'push' | 'pull' | 'none';
  uploadedMedia?: number;
  skippedMedia?: number;
  downloadedMedia?: number;
  remoteAt?: string;
  device?: string;
}

interface FamilyStore {
  // 当前项目状态
  currentProjectId: string | null;
  project: FamilyProject | null;
  isDirty: boolean;
  recentProjects: RecentProject[];
  currentFilePath: string | null;
  projectPassword: string | null;
  /** 最近一次打开旧档案时的数据迁移报告（有断链才非空） */
  dataMigrationReport: MigrationReport | null;
  clearDataMigrationReport: () => void;

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
  saveCustomLayout: (layout: Record<string, { x: number; y: number }>, mode?: TreeLayoutMode) => void;
  clearCustomLayout: (mode?: TreeLayoutMode) => void;
  closeProject: () => void;
  saveCurrentProject: () => Promise<void>;
  saveProjectAs: () => Promise<boolean>;
  /** 档案已整体迁移到新的工作区目录后，切换当前指向并刷新最近列表 */
  relocateProject: (newWorkspacePath: string) => Promise<void>;
  /** 云同步：上传当前档案（只补传云端缺失的媒体） */
  syncPushToCloud: () => Promise<SyncPushReport>;
  /** 云同步：拉取云端档案（先自动备份本地 project.json） */
  syncPullFromCloud: () => Promise<SyncPullReport>;
  /**
   * 一键同步：自动判断该上传还是该下载。
   * - 云端比本机新 → 拉取
   * - 本机比云端新 → 上传
   * - 时间一致 → 什么都不做
   */
  quickSync: () => Promise<QuickSyncResult>;
  /** 从云端某个家谱目录恢复到本机（新建工作区并打开），返回补下的媒体数量 */
  restoreProjectFromCloud: (
    remoteDir: string,
    parentDir: string,
    folderName: string
  ) => Promise<{ media: number; workspacePath: string }>;
  /** 检查云端是否有比本地更新的版本；无更新或未配置时返回 null */
  checkRemoteUpdate: () => Promise<RemoteSyncMeta | null>;
  /** 从磁盘重新载入当前工作区（同步后刷新界面用，保持 projectId 不变） */
  reloadFromWorkspace: () => Promise<boolean>;
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
  /** 更新同辈手动排序（personId → 组内位次），同时影响树布局与称谓推导 */
  setSiblingOrder: (order: Record<string, number>) => void;

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
  dataMigrationReport: null,
  isAnonymized: false,
  anonymizedNames: {},

  clearDataMigrationReport: () => set({ dataMigrationReport: null }),

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
    // 迁移前的快照：断链时才写入 localStorage 备份
    const snapshot = JSON.stringify(rawProject);
    const migration = migrateProjectData(rawProject);
    const project = migration.project;
    const report = migration.report;
    if (report.brokenRelations.length > 0) {
      try {
        localStorage.setItem(`${STORAGE_PREFIX}${projectId}_bak_v${report.fromVersion}`, snapshot);
      } catch {
        // 存储空间不足时不影响打开
      }
    }
    if (report.versionBumped) {
      saveProject(projectId, project);
    }

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
      dataMigrationReport: report.brokenRelations.length > 0 ? report : null,
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
      if (path.toLowerCase().endsWith('.yrj')) {
        const normalized = path.replace(/\\/g, '/');
        const lastSlash = normalized.lastIndexOf('/');
        const parentDir = lastSlash !== -1 ? normalized.substring(0, lastSlash) : '.';
        const fileName = lastSlash !== -1 ? normalized.substring(lastSlash + 1) : normalized;
        const folderName = fileName.endsWith('.yrj')
          ? fileName.substring(0, fileName.length - 4)
          : fileName;

        workspacePath = await unpackYrj(path, parentDir, folderName, password);
      } else {
        // 普通文件夹 / 任意 .json：先规范化成真正包含工程数据的目录
        // （容忍用户选了上一级目录，或把导出的「某某族谱.json」直接丢进文件夹）
        workspacePath = await resolveWorkspaceDir(path);
      }

      // 2. 直接以高速明文读取加载工作区下的 project.json 属性
      const json = await loadProjectJson(workspacePath);
      const rawProject = JSON.parse(json) as FamilyProject;
      const migration = migrateProjectData(rawProject);
      let project = migration.project;
      const migrationReport = migration.report;
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

      // 4. 换电脑打开时，project.json 里仍是原电脑的绝对路径（如 C:\Users\A\...\media\photo.jpg），
      //     必须重新指向本机工作区的 media/，否则照片、音频、视频全部显示不出来。
      let rebasedCount = 0;
      project = rebaseMediaPathsToWorkspace(project, workspacePath, () => {
        rebasedCount += 1;
      });

      // 兼容旧数据 / 脱敏数据中媒体数组可能缺失的情况
      Object.values(project.persons).forEach((person) => {
        person.photos = person.photos || [];
        person.audioFiles = person.audioFiles || [];
        person.videoFiles = person.videoFiles || [];
      });

      // 4.5 数据迁移备份：先在 project.json 旁复制一份旧版本快照，再落盘新数据
      if (migrationReport.brokenRelations.length > 0) {
        try {
          migrationReport.backupPath = await backupProjectJson(workspacePath, migrationReport.fromVersion);
        } catch (e) {
          console.error('迁移前备份 project.json 失败:', e);
        }
      }
      // 4.4 旧版头像原图（original.xxx）登记为照片栏里带标签的「头像原图」
      let avatarOriginalsRegistered = false;
      try {
        avatarOriginalsRegistered = await registerLegacyAvatarOriginals(project);
      } catch (e) {
        console.error('登记旧头像原图失败:', e);
      }
      if (rebasedCount > 0 || migrationReport.versionBumped || avatarOriginalsRegistered) {
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
        dataMigrationReport: migrationReport.brokenRelations.length > 0 ? migrationReport : null,
      });
      return true;
    } catch (err) {
      console.error('从工作区加载项目失败:', err);
      throw err;
    }
  },

  importProjectFromJSON: async (rawProject: FamilyProject) => {
    const migration = migrateProjectData(rawProject);
    const project = migration.project;
    const report = migration.report;
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
      dataMigrationReport: report.brokenRelations.length > 0 ? report : null,
    });

    return projectId;
  },

  saveCustomLayout: (layout: Record<string, { x: number; y: number }>, mode?: TreeLayoutMode) => {
    const { project } = get();
    if (!project) return;
    const isAligned = mode === 'aligned';
    const updated: FamilyProject = {
      ...project,
      customLayout: layout,
      ...(isAligned ? { customLayoutAligned: layout } : { customLayoutClassic: layout }),
      // 快照由用户当前的完整布局生成（含侧栏卡坐标），恢复时原样应用
      sideCardsPinned: true,
    };
    set({ project: updated, isDirty: true });
    autoSave(get);
  },

  clearCustomLayout: (mode?: TreeLayoutMode) => {
    const { project } = get();
    if (!project) return;
    const updated = { ...project };
    if (mode === 'aligned') {
      delete updated.customLayoutAligned;
    } else if (mode === 'classic') {
      delete updated.customLayoutClassic;
    } else {
      delete updated.customLayoutClassic;
      delete updated.customLayoutAligned;
    }

    if (!updated.customLayoutClassic && !updated.customLayoutAligned) {
      delete updated.customLayout;
      delete updated.sideCardsPinned;
    } else {
      updated.customLayout = mode === 'aligned' ? updated.customLayoutClassic : updated.customLayoutAligned;
    }
    set({ project: updated as FamilyProject, isDirty: true });
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
      dataMigrationReport: null,
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
        scheduleAutoPush();
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

    const updated = {
      ...project,
      meta: { ...project.meta, updatedAt: new Date().toISOString() },
    };

    // 另存为文件名，默认用家谱名
    const defaultName = `${project.meta.familyName}.yrj`;

    // 网页版：没有文件系统，直接下载与原版同格式的 .yrj 单文件
    if (!isTauri()) {
      try {
        const { exportYrjInBrowser } = await import('../utils/yrjBrowser');
        await exportYrjInBrowser(updated, defaultName, projectPassword || undefined);
        set({ project: updated, isDirty: false });
        return true;
      } catch (err) {
        console.error('浏览器端打包导出 YRJ 失败:', err);
        throw err;
      }
    }

    // 桌面版：弹出对话框让用户指定打包好的 YRJ 文件名及保存位置
    const path = await selectFilePathForSave(defaultName);
    if (!path) return false;

    try {
      if (currentFilePath) {
        // 先确保工作区 project.json 处于最新状态
        await saveProjectJson(currentFilePath, JSON.stringify(updated, null, 2));
        // 将整个工作区目录（包括 project.json 与 media/ 照片）一并进行 ZIP 压缩加密打包导出为单文件
        await packToYrj(currentFilePath, path, projectPassword || undefined);
      } else {
        // 档案还没落地到工作区（极少见）：直接用同一套容器格式写单文件
        const { buildYrjBytes, bytesToBase64 } = await import('../utils/yrjBrowser');
        const bytes = await buildYrjBytes(updated, projectPassword || undefined);
        await writeBinaryFile(path, bytesToBase64(bytes));
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

  relocateProject: async (newWorkspacePath: string) => {
    const { project, currentProjectId, currentFilePath } = get();
    if (!project || !currentProjectId) return;

    const oldPath = currentFilePath || '';

    // 头像/音视频在 project.json 里是绝对路径，内存中的对象也要同步改写前缀
    let updatedProject = project;
    if (oldPath && oldPath !== newWorkspacePath) {
      const fromEscaped = JSON.stringify(oldPath).slice(1, -1);
      const toEscaped = JSON.stringify(newWorkspacePath).slice(1, -1);
      try {
        updatedProject = JSON.parse(
          JSON.stringify(project).split(fromEscaped).join(toEscaped)
        ) as FamilyProject;
      } catch (e) {
        console.error('迁移后改写内存路径失败:', e);
        updatedProject = project;
      }
    }

    set({
      project: updatedProject,
      currentFilePath: newWorkspacePath,
      isDirty: false,
    });

    // 最近打开列表里的路径也要指向新位置，否则下次会打开旧目录
    const recent = getRecentProjects();
    const target = recent.find((r) => r.projectId === currentProjectId);
    if (target) {
      target.filePath = newWorkspacePath;
      saveRecentProjects(recent);
      set({ recentProjects: recent });
    }

    if (isTauri()) {
      // 立即在新位置落盘一次，确保 project.json 与当前内存状态一致
      await saveProjectJson(newWorkspacePath, JSON.stringify(updatedProject, null, 2));
    } else {
      saveProject(currentProjectId, updatedProject);
    }
  },

  // ==================== 云同步（WebDAV） ====================

  reloadFromWorkspace: async () => {
    const { currentFilePath } = get();
    if (!currentFilePath || !isTauri()) return false;

    const json = await loadProjectJson(currentFilePath);
    const migration = migrateProjectData(JSON.parse(json) as FamilyProject);
    let project = migration.project;
    const migrationReport = migration.report;
    // 云端下来的档案，媒体路径是另一台电脑的绝对路径 → 重新指向本机 media/
    project = rebaseMediaPathsToWorkspace(project, currentFilePath);
    Object.values(project.persons || {}).forEach((person) => {
      person.photos = person.photos || [];
      person.audioFiles = person.audioFiles || [];
      person.videoFiles = person.videoFiles || [];
    });

    if (migrationReport.brokenRelations.length > 0) {
      try {
        migrationReport.backupPath = await backupProjectJson(currentFilePath, migrationReport.fromVersion);
      } catch (e) {
        console.error('迁移前备份 project.json 失败:', e);
      }
    }

    await saveProjectJson(currentFilePath, JSON.stringify(project, null, 2));
    set({
      project,
      isDirty: false,
      dataMigrationReport: migrationReport.brokenRelations.length > 0 ? migrationReport : null,
    });
    return true;
  },

  syncPushToCloud: async () => {
    const { project, currentFilePath } = get();
    if (!project) throw new Error('请先打开一个家谱');
    if (!currentFilePath) throw new Error('当前档案还没有保存到本地文件夹，请先保存');

    const settings = getSyncSettings();
    if (!isSyncConfigured(settings)) {
      throw new Error('请先在「多设备同步」中填写 WebDAV 地址与账号');
    }

    const { key, created } = ensureSyncKey(project);
    if (created) {
      set({ project: { ...project, meta: { ...project.meta, syncKey: key } } });
    }

    // 后端直接读磁盘上的 project.json 上传，先确保它是最新状态
    const latest = get().project!;
    await saveProjectJson(currentFilePath, JSON.stringify(latest, null, 2));

    return webdavPush(
      settings.server,
      settings.username,
      settings.password,
      remoteDirFor(settings, key),
      currentFilePath
    );
  },

  syncPullFromCloud: async () => {
    const { project, currentFilePath } = get();
    if (!project || !currentFilePath) {
      throw new Error('当前档案还没有保存到本地文件夹，请先保存');
    }

    const settings = getSyncSettings();
    if (!isSyncConfigured(settings)) {
      throw new Error('请先在「多设备同步」中填写 WebDAV 地址与账号');
    }

    const { key } = ensureSyncKey(project);
    const report = await webdavPull(
      settings.server,
      settings.username,
      settings.password,
      remoteDirFor(settings, key),
      currentFilePath
    );

    await get().reloadFromWorkspace();

    // 首次从别的设备同步时，云端档案可能还没有 syncKey —— 补上并写回，保证目录映射稳定
    const after = get().project;
    if (after && after.meta.syncKey !== key) {
      const updated = { ...after, meta: { ...after.meta, syncKey: key } };
      set({ project: updated });
      await saveProjectJson(currentFilePath, JSON.stringify(updated, null, 2));
    }

    return report;
  },

  quickSync: async () => {
    const { project, currentFilePath } = get();
    if (!project) throw new Error('请先打开一个家谱');
    if (!currentFilePath) throw new Error('当前档案还没有保存到本地文件夹，请先保存');

    const settings = getSyncSettings();
    if (!settings.enabled) {
      throw new Error('请先在「软件设置 → 云同步」中勾选「启用云同步」');
    }
    if (!isSyncConfigured(settings)) {
      throw new Error('请先在「多设备同步」中填写 WebDAV 地址与账号');
    }

    // 第一次同步时先把同步 ID 落盘，保证两台电脑落到同一个云端目录
    const { key, created } = ensureSyncKey(project);
    if (created) {
      const withKey = { ...project, meta: { ...project.meta, syncKey: key } };
      set({ project: withKey });
      await saveProjectJson(currentFilePath, JSON.stringify(withKey, null, 2));
    }

    const meta = await webdavRemoteMeta(
      settings.server,
      settings.username,
      settings.password,
      remoteDirFor(settings, key)
    );
    const localAt = get().project?.meta.updatedAt || '';
    const remoteAt = meta?.projectUpdatedAt || '';

    if (remoteAt && remoteAt > localAt) {
      // 直接拉取会覆盖尚未保存的编辑，先把选择权交回用户
      if (get().isDirty) {
        throw new Error('本机还有未保存的修改，请先「保存档案」再同步');
      }
      const report = await get().syncPullFromCloud();
      return {
        action: 'pull' as const,
        downloadedMedia: report.downloadedMedia,
        remoteAt: report.remote.updatedAt,
        device: report.remote.device,
      };
    }

    if (remoteAt && remoteAt === localAt) {
      return {
        action: 'none' as const,
        remoteAt: meta?.updatedAt,
        device: meta?.device,
      };
    }

    const report = await get().syncPushToCloud();
    return {
      action: 'push' as const,
      uploadedMedia: report.uploadedMedia,
      skippedMedia: report.skippedMedia,
    };
  },

  restoreProjectFromCloud: async (remoteDir, parentDir, folderName) => {
    const settings = getSyncSettings();
    if (!isSyncConfigured(settings)) {
      throw new Error('请先在「多设备同步」中填写 WebDAV 地址与账号');
    }

    const workspacePath = await createUniqueProjectWorkspace(
      parentDir,
      folderName || '家谱'
    );
    const report = await webdavPull(
      settings.server,
      settings.username,
      settings.password,
      remoteDir,
      workspacePath
    );

    // 绑定同步 ID：云端目录名就是这台家谱的 syncKey，之后两边才能对上
    const key = remoteDir.split('/').filter(Boolean).pop() || '';
    const json = await loadProjectJson(workspacePath);
    const parsed = JSON.parse(json) as FamilyProject;
    if (key && parsed.meta.syncKey !== key) {
      parsed.meta.syncKey = key;
      await saveProjectJson(workspacePath, JSON.stringify(parsed, null, 2));
    }

    const opened = await get().openProjectFromFile(workspacePath);
    if (!opened) {
      throw new Error(`云端档案已下载到 ${workspacePath}，但打开失败`);
    }
    return { media: report.downloadedMedia, workspacePath };
  },

  checkRemoteUpdate: async () => {
    const { project } = get();
    const settings = getSyncSettings();
    if (!project?.meta.syncKey || !settings.enabled || !isSyncConfigured(settings)) return null;

    try {
      const meta = await webdavRemoteMeta(
        settings.server,
        settings.username,
        settings.password,
        remoteDirFor(settings, project.meta.syncKey)
      );
      if (!meta || !meta.projectUpdatedAt) return null;
      const localAt = project.meta.updatedAt || '';
      return meta.projectUpdatedAt > localAt ? meta : null;
    } catch {
      // 离线 / 服务不可用时静默失败，不打扰正常使用
      return null;
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
      r.adoptiveParents = removePersonFromAdoptiveGroups(r.adoptiveParents, id);
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

  setSiblingOrder: (order: Record<string, number>) => {
    const { project } = get();
    if (!project) return;

    set({
      project: {
        ...project,
        meta: {
          ...project.meta,
          siblingOrder: { ...order },
          updatedAt: new Date().toISOString(),
        },
      },
      isDirty: true,
    });
    autoSave(get);
  },

  // ==================== 关系操作 ====================

  setRelation: (personId: string, relationType: string, targetId: string | null) => {
    const { project } = get();
    if (!project || !project.persons[personId]) return;

    const person = { ...project.persons[personId] };
    const relations = { ...person.relations };

    const validKeys = ['father', 'mother', 'stepFather', 'stepMother'];
    if (validKeys.includes(relationType)) {
      (relations as any)[relationType] = targetId ?? undefined;
    }

    // 养父母走分组结构：已在任何一组里则忽略，否则补进第一组空缺槽位（没有组就新建一组）
    if ((relationType === 'adoptiveFather' || relationType === 'adoptiveMother') && targetId) {
      const groups = [...(relations.adoptiveParents || [])];
      const occupied = groups.some((group) => group.fatherId === targetId || group.motherId === targetId);
      if (!occupied) {
        const slotKey = relationType === 'adoptiveFather' ? 'fatherId' : 'motherId';
        const emptyIndex = groups.findIndex((group) => !group[slotKey]);
        if (emptyIndex >= 0) {
          groups[emptyIndex] = { ...groups[emptyIndex], [slotKey]: targetId };
        } else {
          groups.push({ id: createAdoptiveGroupId(), [slotKey]: targetId });
        }
        relations.adoptiveParents = groups;
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
