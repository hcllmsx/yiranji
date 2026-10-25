import { useState, useEffect, useRef } from 'react';
import { useFamilyStore } from '../store/familyStore';
import {
  openDevtools,
  isTauri,
  selectFilePathForSaveZip,
  writeBinaryFile,
  getAppLogs,
  openUrl,
  selectProjectParentDir,
  moveProjectWorkspace,
  openInExplorer,
  webdavTest,
  webdavRemoteMeta,
  getWorkspaceStats,
  type RemoteSyncMeta,
  type FolderStats,
} from '../utils/tauri';
import {
  getDefaultSaveDir,
  setDefaultSaveDir,
  getTreeLayoutMode,
  setTreeLayoutMode,
  shouldShowSampleEntry,
  setSampleEntryEnabled,
  type TreeLayoutMode,
} from '../utils/appPrefs';
import {
  getSyncSettings,
  saveSyncSettings,
  isSyncConfigured,
  remoteDirFor,
  ensureSyncKey,
  formatSyncTime,
  formatBytes,
  type SyncSettings,
} from '../utils/cloudSync';
import { subscribeSettings } from '../utils/appSettings';
import { checkForUpdate } from '../utils/updateChecker';
import { useUpdateStore } from '../store/updateStore';
import { createAnonymizedExport, sha256 } from '../utils';
import './SettingsPage.css';

type SettingsTab = 'basic' | 'storage' | 'advanced';
/** 本次运行会话内记忆选中的设置选项卡（仅在软件彻底关闭重启后才重置回 'basic'） */
let sessionActiveTab: SettingsTab = 'basic';

export default function SettingsPage() {
  const {
    project,
    updateMeta,
    changeProjectPassword,
    isAnonymized,
    toggleAnonymization,
    currentFilePath,
    relocateProject,
    syncPushToCloud,
    syncPullFromCloud,
  } = useFamilyStore();

  const [activeTab, setActiveTabState] = useState<SettingsTab>(() => sessionActiveTab);
  const setActiveTab = (tab: SettingsTab) => {
    sessionActiveTab = tab;
    setActiveTabState(tab);
  };
  const [familyName, setFamilyName] = useState(project?.meta.familyName || '');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPasswordSection, setShowPasswordSection] = useState(false);
  const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [isCheckingUpdate, setIsCheckingUpdate] = useState(false);

  // 档案存储：新建档案的默认保存位置（全局偏好）
  const [defaultSaveDir, setDefaultSaveDirState] = useState<string>(() => getDefaultSaveDir());
  const [isMoving, setIsMoving] = useState(false);

  // 家谱树节点布局（全局偏好）：classic=经典模式，aligned=同辈齐平
  const [treeLayoutMode, setTreeLayoutModeState] = useState<TreeLayoutMode>(() => getTreeLayoutMode());
  const [workspaceStats, setWorkspaceStats] = useState<FolderStats | null>(null);

  useEffect(() => {
    if (activeTab === 'storage' && currentFilePath && isTauri()) {
      getWorkspaceStats(currentFilePath).then(setWorkspaceStats);
    }
  }, [activeTab, currentFilePath]);
  const handleTreeLayoutModeChange = (mode: TreeLayoutMode) => {
    setTreeLayoutModeState(mode);
    setTreeLayoutMode(mode);
  };

  // 首页示例家谱入口开关
  const [sampleEntryEnabled, setSampleEntryEnabledState] = useState<boolean>(() => shouldShowSampleEntry(__APP_VERSION__));
  const handleToggleSampleEntry = (enabled: boolean) => {
    setSampleEntryEnabled(enabled, __APP_VERSION__);
    setSampleEntryEnabledState(enabled);
    showToast(enabled ? '已开启！返回首页将显示「示例家谱」' : '已关闭首页「示例家谱」入口', 'success');
  };

  // 多设备同步
  const [sync, setSync] = useState<SyncSettings>(() => getSyncSettings());
  const [syncProviderTab, setSyncProviderTab] = useState<'webdav' | 'others'>('webdav');
  const [testStatus, setTestStatus] = useState<{ ok: boolean; message: string } | null>(null);
  const [showSyncPass, setShowSyncPass] = useState(false);
  const [syncBusy, setSyncBusy] = useState<'' | 'test' | 'push' | 'pull'>('');
  const [remoteMeta, setRemoteMeta] = useState<RemoteSyncMeta | null>(null);

  useEffect(() => {
    return subscribeSettings(() => {
      setSampleEntryEnabledState(shouldShowSampleEntry(__APP_VERSION__));
      setSync(getSyncSettings());
      setTreeLayoutModeState(getTreeLayoutMode());
    });
  }, []);

  // -------------------- Toast --------------------
  const [toast, setToast] = useState<{ text: string; type: 'success' | 'error' } | null>(null);
  const toastTimerRef = useRef<number | null>(null);
  const [toastKey, setToastKey] = useState(0);

  useEffect(() => {
    if (toast) {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
      toastTimerRef.current = window.setTimeout(() => setToast(null), 6000);
    }
    return () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    };
  }, [toast, toastKey]);

  const showToast = (text: string, type: 'success' | 'error') => {
    setToast({ text, type });
    setToastKey(k => k + 1);
  };

  // 从侧边栏「云同步」等外部链接进来时，自动切换到存储标签并滚动
  useEffect(() => {
    if (window.location.hash === '#sync-section') {
      setActiveTab('storage');
      const timer = window.setTimeout(() => {
        document.getElementById('sync-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 150);
      return () => window.clearTimeout(timer);
    }
  }, []);

  // -------------------- 自定义对话框 --------------------
  interface DialogState {
    show: boolean;
    title: string;
    message: string;
    requirePassword?: boolean;
    confirmText?: string;
    tone?: 'danger' | 'primary';
    onConfirm: (password?: string) => Promise<boolean>;
  }
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [dialogPassword, setDialogPassword] = useState('');
  const [dialogPasswordError, setDialogPasswordError] = useState('');

  const closeDialog = () => {
    setDialog(null);
    setDialogPassword('');
    setDialogPasswordError('');
  };

  const handleDialogConfirm = async () => {
    if (!dialog) return;
    if (dialog.requirePassword && !dialogPassword.trim()) {
      setDialogPasswordError('请输入当前密码');
      return;
    }
    setDialogPasswordError('');
    const closed = await dialog.onConfirm(dialog.requirePassword ? dialogPassword : undefined);
    if (closed) {
      closeDialog();
    }
  };

  // -------------------- 多设备同步：设置与云端状态 --------------------
  const patchSync = (patch: Partial<SyncSettings>) => {
    setTestStatus(null);
    setSync(saveSyncSettings(patch));
  };

  const syncKeyOf = project ? ensureSyncKey(project).key : '';

  const refreshRemoteMeta = async () => {
    if (!isTauri() || !isSyncConfigured(sync) || !syncKeyOf) {
      setRemoteMeta(null);
      setTestStatus(null);
      return;
    }
    try {
      const meta = await webdavRemoteMeta(
        sync.server,
        sync.username,
        sync.password,
        remoteDirFor(sync, syncKeyOf)
      );
      setRemoteMeta(meta);
      setTestStatus({ ok: true, message: '已连接云端' });
    } catch (err: any) {
      setRemoteMeta(null);
      setTestStatus({ ok: false, message: err?.message || '连接失败' });
    }
  };

  useEffect(() => {
    refreshRemoteMeta();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [syncKeyOf, sync.server, sync.username, sync.password, sync.remoteRoot]);

  // -------------------- 表单提交 --------------------
  if (!project) return null;

  const handleFamilyNameSave = () => {
    setMessage(null);
    const trimmedName = familyName.trim();
    if (!trimmedName) {
      setFamilyName(project.meta.familyName || '');
      showToast('家谱名称不能为空，已恢复原名称', 'error');
      return;
    }

    try {
      if (trimmedName !== project.meta.familyName) {
        updateMeta({ familyName: trimmedName });
        showToast('家谱名称已更新！已自动同步工作区。', 'success');
      }
    } catch (err) {
      console.error(err);
      showToast('家谱名称更新失败，请重试', 'error');
    }
  };

  // -------------------- 点击"修改加密密码"：先验证原密码 --------------------
  const handleStartChangePassword = () => {
    setDialogPassword('');
    setDialogPasswordError('');
    setDialog({
      show: true,
      title: '验证原密码',
      message: '修改密码前，请先输入原密码以确认身份。',
      requirePassword: true,
      onConfirm: async (pswd?: string) => {
        const inputHash = await sha256(pswd || '');
        if (inputHash !== project.meta.passwordHash) {
          setDialogPasswordError('原密码错误，请重试');
          return false;
        }
        // 验证通过，展开密码输入区域
        setShowPasswordSection(true);
        return true;
      },
    });
  };

  // -------------------- 密码修改/设置确认 --------------------
  const handleConfirmPasswordChange = async () => {
    setMessage(null);

    if (newPassword !== confirmPassword) {
      setMessage({ text: '两次输入的密码不一致', type: 'error' });
      return;
    }
    if (!newPassword) {
      setMessage({ text: '密码不能为空', type: 'error' });
      return;
    }
    if (newPassword.length < 4) {
      setMessage({ text: '密码长度不能少于 4 位', type: 'error' });
      return;
    }

    // 首次设置密码（无需验证原密码）
    if (!project.meta.hasPassword) {
      try {
        await changeProjectPassword(newPassword);
        showToast('密码设置成功！', 'success');
        setNewPassword('');
        setConfirmPassword('');
        setShowPasswordSection(false);
      } catch {
        setMessage({ text: '设置密码失败，请重试', type: 'error' });
      }
      return;
    }

    // 修改密码（原密码已在上一步验证通过，此处直接修改）
    try {
      await changeProjectPassword(newPassword);
      showToast('密码修改成功！', 'success');
      setNewPassword('');
      setConfirmPassword('');
      setShowPasswordSection(false);
    } catch {
      setMessage({ text: '修改密码失败，请重试', type: 'error' });
    }
  };

  // -------------------- 取消密码保护 (含验证对话框) --------------------
  const handleRemovePassword = () => {
    setDialogPassword('');
    setDialogPasswordError('');
    setDialog({
      show: true,
      title: '取消密码保护',
      message: '确认要取消此家谱的密码保护吗？取消后，任何人都可以直接打开此家谱。',
      requirePassword: true,
      onConfirm: async (pswd?: string) => {
        const inputHash = await sha256(pswd || '');
        if (inputHash !== project.meta.passwordHash) {
          setDialogPasswordError('密码错误，请重试');
          return false;
        }
        try {
          await changeProjectPassword(null);
          showToast('成功取消密码保护！', 'success');
          setShowPasswordSection(false);
          return true;
        } catch {
          setDialogPasswordError('操作失败，请重试');
          return false;
        }
      },
    });
  };

  // -------------------- 导出脱敏数据 --------------------
  const handleExportAnonymized = async () => {
    if (!project || isExporting) return;
    setIsExporting(true);
    setMessage(null);

    try {
      const anonProject = createAnonymizedExport(project);
      const curFamilyName = project.meta.familyName || '家谱';
      const exportFolderName = curFamilyName + '_脱敏数据';

      const JSZip = (await import('jszip')).default;
      const zip = new JSZip();
      const folder = zip.folder(exportFolderName);

      if (folder) {
        folder.file('project.json', JSON.stringify(anonProject, null, 2));

        const logs = await getAppLogs();
        if (logs.length > 0) {
          const logsFolder = folder.folder('logs');
          if (logsFolder) {
            logs.forEach((log) => {
              logsFolder.file(log.filename, log.content);
            });
          }
        }
      }

      const zipBlob = await zip.generateAsync({ type: 'blob' });

      if (isTauri()) {
        const savePath = await selectFilePathForSaveZip(`${curFamilyName}_脱敏数据.zip`);
        if (!savePath) {
          setIsExporting(false);
          return;
        }
        const arrayBuffer = await zipBlob.arrayBuffer();
        const bytes = new Uint8Array(arrayBuffer);
        let binary = '';
        for (let i = 0; i < bytes.length; i++) {
          binary += String.fromCharCode(bytes[i]);
        }
        const base64 = btoa(binary);
        await writeBinaryFile(savePath, base64);
        showToast('脱敏数据已成功导出！', 'success');
      } else {
        const url = URL.createObjectURL(zipBlob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${curFamilyName}_脱敏数据.zip`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        showToast('脱敏数据已成功导出下载', 'success');
      }
    } catch (err: any) {
      console.error('导出脱敏数据失败:', err);
      setMessage({ text: `导出失败：${err?.message || '未知错误'}`, type: 'error' });
    } finally {
      setIsExporting(false);
    }
  };

  // -------------------- 检查更新 --------------------
  const handleCheckUpdate = async () => {
    if (isCheckingUpdate) return;
    setIsCheckingUpdate(true);
    try {
      const result = await checkForUpdate();
      if (result.status === 'update-available' && result.latestVersion) {
        useUpdateStore.getState().openUpdateDialog(result.latestVersion, result.sourceIndex);
      } else if (result.status === 'up-to-date') {
        showToast(`当前已是最新版本（v${__APP_VERSION__}）`, 'success');
      } else {
        showToast('检查更新失败，请检查网络连接后重试', 'error');
      }
    } catch (err) {
      console.error('检查更新失败:', err);
      showToast('检查更新失败，请检查网络连接后重试', 'error');
    } finally {
      setIsCheckingUpdate(false);
    }
  };

  // ==================== 档案存储相关 ====================
  const formatWinPath = (p: string) => {
    if (!p) return '';
    if (/^[a-zA-Z]:[/\\]/.test(p) || (typeof navigator !== 'undefined' && navigator.userAgent.includes('Windows'))) {
      return p.replace(/[/\\]+/g, '\\');
    }
    return p;
  };

  const handleCopyPath = async (path: string) => {
    if (!path) return;
    try {
      const normalized = formatWinPath(path);
      await navigator.clipboard.writeText(normalized);
      showToast('路径已复制到剪贴板', 'success');
    } catch {
      showToast('复制失败，请手动选中路径复制', 'error');
    }
  };

  const handleOpenFolder = async (path: string) => {
    if (!path) return;
    try {
      await openInExplorer(path);
    } catch (err: any) {
      showToast(`打开文件夹失败：${err?.message || err}`, 'error');
    }
  };

  const handleChooseDefaultDir = async () => {
    try {
      const dir = await selectProjectParentDir(defaultSaveDir || currentFilePath || null);
      if (!dir) return;
      setDefaultSaveDir(dir);
      setDefaultSaveDirState(dir);
      showToast('默认保存位置已更新', 'success');
    } catch (err: any) {
      showToast(`选择目录失败：${err?.message || err}`, 'error');
    }
  };

  const handleClearDefaultDir = () => {
    setDefaultSaveDir('');
    setDefaultSaveDirState('');
    showToast('已恢复为每次新建时询问位置', 'success');
  };

  const handleRelocate = async () => {
    if (!currentFilePath || isMoving) return;
    try {
      const parent = await selectProjectParentDir(currentFilePath);
      if (!parent) return;

      setIsMoving(true);
      const newPath = await moveProjectWorkspace(currentFilePath, parent);
      await relocateProject(newPath);

      if (defaultSaveDir) {
        setDefaultSaveDir(parent);
        setDefaultSaveDirState(parent);
      }

      showToast(`档案已迁移到：${newPath}（原目录仍保留，可手动删除）`, 'success');
    } catch (err: any) {
      showToast(`迁移失败：${err?.message || err}`, 'error');
    } finally {
      setIsMoving(false);
    }
  };

  // ==================== 多设备同步 ====================
  const cloudDir = project ? remoteDirFor(sync, ensureSyncKey(project).key) : '';

  const handleSyncTest = async () => {
    if (!isTauri()) {
      showToast('云同步仅在桌面版可用', 'error');
      return;
    }
    if (!isSyncConfigured(sync)) {
      showToast('请先填写服务器地址、账号和应用密码', 'error');
      return;
    }
    setSyncBusy('test');
    setTestStatus(null);
    try {
      const root = sync.remoteRoot.replace(/^\/+|\/+$/g, '') || 'yiranji';
      await webdavTest(sync.server, sync.username, sync.password, root);
      setTestStatus({ ok: true, message: '已连接' });
      showToast('连接成功', 'success');
      await refreshRemoteMeta();
    } catch (err: any) {
      const msg = err?.message || String(err);
      setTestStatus({ ok: false, message: `连接失败：${msg}` });
      showToast(`连接失败：${msg}`, 'error');
    } finally {
      setSyncBusy('');
    }
  };

  const handleSyncPush = async () => {
    if (!isTauri()) {
      showToast('云同步仅在桌面版可用', 'error');
      return;
    }
    if (!currentFilePath) {
      showToast('请先把档案保存到本地文件夹', 'error');
      return;
    }
    if (!isSyncConfigured(sync)) {
      showToast('请先填写服务器地址、账号和应用密码', 'error');
      return;
    }

    const remoteNewer =
      !!remoteMeta?.projectUpdatedAt &&
      remoteMeta.projectUpdatedAt > (project.meta.updatedAt || '');

    const executePush = async () => {
      setSyncBusy('push');
      try {
        const report = await syncPushToCloud();
        showToast(
          `已上传：新增媒体 ${report.uploadedMedia} 个、跳过已存在 ${report.skippedMedia} 个，工程数据 ${formatBytes(report.projectBytes)}`,
          'success'
        );
        await refreshRemoteMeta();
      } catch (err: any) {
        showToast(`上传失败：${err?.message || err}`, 'error');
      } finally {
        setSyncBusy('');
      }
    };

    if (remoteNewer) {
      setDialog({
        show: true,
        title: '云端档案版本较新',
        message: `云端版本（来自 ${remoteMeta!.device}，修改于 ${formatSyncTime(remoteMeta!.projectUpdatedAt)}）比当前本机档案新。直接上传将覆盖云端数据，是否确定强制覆盖？`,
        confirmText: '强制覆盖云端',
        tone: 'danger',
        onConfirm: async () => {
          await executePush();
          return true;
        },
      });
      return;
    }

    await executePush();
  };

  const doPull = async () => {
    setSyncBusy('pull');
    try {
      const report = await syncPullFromCloud();
      showToast(
        `已拉取云端档案：新增媒体 ${report.downloadedMedia} 个${report.backupPath ? '，原档案已备份' : ''}`,
        'success'
      );
      await refreshRemoteMeta();
    } catch (err: any) {
      showToast(`拉取失败：${err?.message || err}`, 'error');
    } finally {
      setSyncBusy('');
    }
  };

  const handleSyncPull = () => {
    if (!isTauri()) {
      showToast('云同步仅在桌面版可用', 'error');
      return;
    }
    if (!currentFilePath) {
      showToast('请先把档案保存到本地文件夹', 'error');
      return;
    }
    if (!isSyncConfigured(sync)) {
      showToast('请先填写服务器地址、账号和应用密码', 'error');
      return;
    }

    setDialog({
      show: true,
      title: '从云端拉取',
      message: `将用云端档案覆盖本机当前档案，本机会先把 project.yrp 备份到 .sync-backup 目录。${
        remoteMeta
          ? `云端版本更新于 ${formatSyncTime(remoteMeta.updatedAt)}（来自 ${remoteMeta.device}）。`
          : ''
      }`,
      confirmText: '确认拉取',
      tone: 'primary',
      onConfirm: async () => {
        await doPull();
        return true;
      },
    });
  };

  // ==================== 渲染 ====================
  return (
    <div className="settings-page">
      {/* ---- Toast 通知 ---- */}
      {toast && (
        <div
          className={`settings-toast ${toast.type}`}
          onClick={() => setToast(null)}
        >
          <span className="settings-toast-icon">{toast.type === 'success' ? '✓' : '✕'}</span>
          <span className="settings-toast-text">{toast.text}</span>
          <button className="settings-toast-close" aria-label="关闭">✕</button>
        </div>
      )}

      {/* ---- 密码验证对话框 ---- */}
      {dialog && (
        <div className="custom-dialog-overlay" onClick={closeDialog}>
          <div className="custom-dialog-box" onClick={(e) => e.stopPropagation()}>
            <div className="custom-dialog-header">
              <span className="custom-dialog-icon">🔒</span>
              <span className="custom-dialog-title">{dialog.title}</span>
            </div>
            <div className="custom-dialog-message">{dialog.message}</div>
            {dialog.requirePassword && (
              <div className="custom-dialog-password">
                <input
                  type="password"
                  className="form-input"
                  value={dialogPassword}
                  onChange={(e) => { setDialogPassword(e.target.value); setDialogPasswordError(''); }}
                  placeholder="请输入当前密码以确认身份"
                  autoFocus
                  onKeyDown={(e) => { if (e.key === 'Enter') handleDialogConfirm(); }}
                />
                {dialogPasswordError && (
                  <p className="custom-dialog-error">{dialogPasswordError}</p>
                )}
              </div>
            )}
            <div className="custom-dialog-buttons">
              <button className="btn btn-secondary btn-sm" onClick={closeDialog}>
                取消
              </button>
              <button
                className={`btn ${dialog.tone === 'primary' ? 'btn-primary' : 'btn-danger'} btn-sm`}
                onClick={handleDialogConfirm}
              >
                {dialog.confirmText || '确认取消'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ---- 页面主体顶部 ---- */}
      <div className="settings-header">
        <h2>⚙️ 软件设置</h2>
      </div>

      <div className="settings-layout">
        {/* 左侧分类导航菜单 */}
        <aside className="settings-sidebar">
          <button
            type="button"
            className={`settings-nav-item ${activeTab === 'basic' ? 'active' : ''}`}
            onClick={() => setActiveTab('basic')}
          >
            <span className="settings-nav-icon">🏷️</span>
            <span className="settings-nav-label">家谱设置</span>
          </button>
          <button
            type="button"
            className={`settings-nav-item ${activeTab === 'storage' ? 'active' : ''}`}
            onClick={() => setActiveTab('storage')}
          >
            <span className="settings-nav-icon">📁</span>
            <span className="settings-nav-label">档案存储</span>
          </button>
          <button
            type="button"
            className={`settings-nav-item ${activeTab === 'advanced' ? 'active' : ''}`}
            onClick={() => setActiveTab('advanced')}
          >
            <span className="settings-nav-icon">⚙️</span>
            <span className="settings-nav-label">高级设置</span>
          </button>
        </aside>

        {/* 右侧配置面板 */}
        <div className="settings-content">
          <div className="settings-form">
            {/* 1. 家谱设置与信息显示 */}
            {activeTab === 'basic' && (
              <div className="settings-section">
                <div className="settings-section-title settings-section-title--with-badge">
                  <span>家谱设置与信息显示</span>
                  <span className="settings-data-version" title="家谱数据结构版本，打开旧档案时会自动升级">
                    当前家谱数据版本：{project?.meta.version || '—'}
                  </span>
                </div>

                <div className="form-group">
                  <label className="form-label" htmlFor="familyName">家谱名称</label>
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                    <input
                      id="familyName"
                      type="text"
                      className="form-input"
                      style={{ flex: 1 }}
                      value={familyName}
                      autoComplete="off"
                      spellCheck={false}
                      onChange={(e) => setFamilyName(e.target.value)}
                      onBlur={handleFamilyNameSave}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          e.currentTarget.blur();
                        }
                      }}
                      placeholder="请输入家谱名称"
                      maxLength={50}
                    />
                    {familyName.trim() !== (project.meta.familyName || '') && (
                      <button
                        type="button"
                        className="btn btn-sm btn-primary"
                        onClick={handleFamilyNameSave}
                      >
                        保存名称
                      </button>
                    )}
                  </div>
                </div>

                {/* 家谱树排版方式 */}
                <div className="settings-subgroup" style={{ marginTop: '24px', paddingTop: '20px', borderTop: '1px dashed var(--color-border-light)' }}>
                  <label className="form-label" style={{ marginBottom: '14px' }}>家谱树卡片排版方式</label>
                  
                  <div className="toggle-setting-row">
                    <div className="toggle-setting-info">
                      <span className="toggle-setting-title">经典模式</span>
                      <span className="toggle-setting-desc">
                        以主视角一脉为中心，其他脉左右交替排开；同辈成员按长幼顺序上下阶梯错落排布，尊卑有序、层级分明。
                      </span>
                    </div>
                    <label className="ios-switch" title="切换为经典模式">
                      <input
                        type="checkbox"
                        checked={treeLayoutMode === 'classic'}
                        onChange={() => handleTreeLayoutModeChange('classic')}
                      />
                      <span className="ios-slider" />
                    </label>
                  </div>

                  <div className="toggle-setting-row" style={{ marginTop: '14px' }}>
                    <div className="toggle-setting-info">
                      <span className="toggle-setting-title">同辈齐平</span>
                      <span className="toggle-setting-desc">
                        同辈所有成员在同一水平线严格拉齐，从左到右平铺排列（支持手动调整排行），紧凑规整。
                      </span>
                    </div>
                    <label className="ios-switch" title="切换为同辈齐平">
                      <input
                        type="checkbox"
                        checked={treeLayoutMode === 'aligned'}
                        onChange={() => handleTreeLayoutModeChange('aligned')}
                      />
                      <span className="ios-slider" />
                    </label>
                  </div>
                </div>

                {/* 首页示例家谱入口开关 */}
                <div className="settings-subgroup" style={{ marginTop: '24px', paddingTop: '20px', borderTop: '1px dashed var(--color-border-light)' }}>
                  <div className="toggle-setting-row">
                    <div className="toggle-setting-info">
                      <span className="toggle-setting-title">首页显示「示例家谱」入口</span>
                      <span className="toggle-setting-desc">
                        开启后将在首页常驻显示示例家谱按钮，但按过一次后依然会隐藏，需要在此重新激活。
                      </span>
                    </div>
                    <label className="ios-switch" title="控制首页是否显示示例家谱入口">
                      <input
                        type="checkbox"
                        checked={sampleEntryEnabled}
                        onChange={(e) => handleToggleSampleEntry(e.target.checked)}
                      />
                      <span className="ios-slider" />
                    </label>
                  </div>
                </div>
              </div>
            )}

            {/* 2. 档案存储与云同步 */}
            {activeTab === 'storage' && (
              <>
                <div className="settings-section">
                  <div className="settings-section-title settings-section-title--with-badge">
                    <span>档案存储</span>
                    {workspaceStats && (
                      <span className="settings-data-version" title="当前家谱工作区占用的总磁盘空间及文件明细">
                        当前档案大小：{formatBytes(workspaceStats.totalBytes)}（包含 {workspaceStats.fileCount} 个文件，{workspaceStats.dirCount} 个文件夹）
                      </span>
                    )}
                  </div>
                  <p className="dev-tool-desc" style={{ marginBottom: '16px' }}>
                    家谱以文件夹形式实时保存（内含 project.yrp 与 media 照片），修改后自动写入，无需手动保存。
                  </p>

                  <div className="form-group">
                    <label className="form-label">当前档案位置</label>
                    <div className="path-display" title={currentFilePath || ''}>
                      {currentFilePath ? formatWinPath(currentFilePath) : (isTauri() ? '尚未保存到本地' : '浏览器模式：数据保存在浏览器本地存储中')}
                    </div>
                    <div className="path-actions path-actions--between">
                      <div className="path-actions-left">
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          onClick={() => handleCopyPath(currentFilePath || '')}
                          disabled={!currentFilePath}
                        >
                          📋 复制路径
                        </button>
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          onClick={() => handleOpenFolder(currentFilePath || '')}
                          disabled={!currentFilePath || !isTauri()}
                          title={isTauri() ? '在资源管理器中打开档案所在文件夹' : '仅桌面版可用'}
                        >
                          📂 打开文件夹
                        </button>
                      </div>
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        onClick={handleRelocate}
                        disabled={!currentFilePath || !isTauri() || isMoving}
                        title={isTauri() ? '选择新的保存位置并迁移' : '仅桌面版可用'}
                      >
                        {isMoving ? '⏳ 正在迁移…' : '📦 迁移到新位置…'}
                      </button>
                    </div>
                  </div>

                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label className="form-label">新建档案的默认保存位置</label>
                    <div className="path-input-inline">
                      <div className="path-display" title={defaultSaveDir || ''}>
                        {defaultSaveDir ? formatWinPath(defaultSaveDir) : '未设置（每次新建档案时弹出选择框）'}
                      </div>
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm path-inline-btn"
                        onClick={handleChooseDefaultDir}
                        disabled={!isTauri()}
                        title={isTauri() ? '选择默认保存目录' : '仅桌面版可用'}
                      >
                        📁
                      </button>
                      {defaultSaveDir && (
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm path-inline-clear-btn"
                          onClick={handleClearDefaultDir}
                          title="清除默认保存位置，恢复为每次询问"
                        >
                          ✕
                        </button>
                      )}
                    </div>
                    {defaultSaveDir && (
                      <p className="form-hint" style={{ marginTop: '8px' }}>
                        新建家谱将自动保存在：<strong style={{ color: 'var(--color-accent)' }}>{formatWinPath(defaultSaveDir)}</strong>
                      </p>
                    )}
                  </div>
                </div>

                {/* 多设备云同步 */}
                <div className="settings-section" id="sync-section">
                  <div
                    className="settings-section-title toggle-setting-row"
                    style={{
                      borderBottom: sync.enabled ? '1px solid var(--color-border-light)' : 'none',
                      marginBottom: sync.enabled ? 'var(--space-5)' : 0,
                      paddingBottom: sync.enabled ? 'var(--space-3)' : 0,
                    }}
                  >
                    <div>
                      <span>多设备云同步</span>
                      {!isTauri() && (
                        <p className="dev-tool-desc" style={{ marginTop: '4px', marginBottom: 0, fontWeight: 400 }}>
                          <strong>网页版不支持云同步，请安装桌面版使用。</strong>
                        </p>
                      )}
                    </div>
                    <label className="ios-switch" title="开启或关闭多设备云同步">
                      <input
                        type="checkbox"
                        checked={sync.enabled}
                        onChange={(e) => patchSync({ enabled: e.target.checked })}
                      />
                      <span className="ios-slider" />
                    </label>
                  </div>

                  {sync.enabled && (
                    <div className="sync-section-body">
                      {/* 书签切换栏 */}
                      <div className="sync-provider-tabs">
                        <button
                          type="button"
                          className={`sync-provider-tab ${syncProviderTab === 'webdav' ? 'active' : ''}`}
                          onClick={() => setSyncProviderTab('webdav')}
                        >
                          WebDAV
                        </button>
                        <button
                          type="button"
                          className={`sync-provider-tab ${syncProviderTab === 'others' ? 'active' : ''}`}
                          onClick={() => setSyncProviderTab('others')}
                        >
                          其他方式
                        </button>
                      </div>

                      {syncProviderTab === 'others' ? (
                        <div className="sync-others-placeholder">
                          <span>正在规划中...</span>
                        </div>
                      ) : (
                        <>
                          {/* 1. 服务地址 (75%) + 云端根目录 (25%) */}
                          <div className="sync-server-root-row">
                            <div className="form-group" style={{ marginBottom: 0 }}>
                              <label className="form-label" htmlFor="syncServer">服务地址</label>
                              <input
                                id="syncServer"
                                type="text"
                                className="form-input"
                                value={sync.server}
                                autoComplete="off"
                                spellCheck={false}
                                placeholder="https://your-webdav.com/webdav/"
                                onChange={(e) => patchSync({ server: e.target.value })}
                              />
                            </div>
                            <div className="form-group" style={{ marginBottom: 0 }}>
                              <label className="form-label" htmlFor="syncRoot">云端根目录</label>
                              <input
                                id="syncRoot"
                                type="text"
                                className="form-input"
                                value={sync.remoteRoot}
                                autoComplete="off"
                                spellCheck={false}
                                placeholder="yiranji"
                                onChange={(e) => patchSync({ remoteRoot: e.target.value })}
                              />
                            </div>
                          </div>

                          {/* 2. 本家谱的云端位置（单行居中框） */}
                          <div className="sync-cloud-location-box">
                            本家谱的云端位置：<strong>{cloudDir || '填写服务地址后自动关联'}</strong>
                          </div>

                          {/* 3. 账号 (50%) + 应用密码 (50%) */}
                          <div className="sync-account-row">
                            <div className="form-group" style={{ marginBottom: 0 }}>
                              <label className="form-label" htmlFor="syncUser">账号</label>
                              <input
                                id="syncUser"
                                type="text"
                                className="form-input"
                                value={sync.username}
                                autoComplete="off"
                                spellCheck={false}
                                placeholder="登录邮箱 / 用户名"
                                onChange={(e) => patchSync({ username: e.target.value })}
                              />
                            </div>
                            <div className="form-group" style={{ marginBottom: 0 }}>
                              <label className="form-label" htmlFor="syncPass">应用密码</label>
                              <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                                <input
                                  id="syncPass"
                                  type={showSyncPass ? 'text' : 'password'}
                                  className="form-input"
                                  value={sync.password}
                                  autoComplete="new-password"
                                  spellCheck={false}
                                  placeholder="WebDAV 应用密码"
                                  style={{ paddingRight: '38px' }}
                                  onChange={(e) => patchSync({ password: e.target.value })}
                                />
                                <button
                                  type="button"
                                  onClick={() => setShowSyncPass(!showSyncPass)}
                                  style={{
                                    position: 'absolute',
                                    right: '6px',
                                    background: 'none',
                                    border: 'none',
                                    cursor: 'pointer',
                                    color: 'var(--color-text-secondary, #666)',
                                    padding: '4px',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                  }}
                                  title={showSyncPass ? '隐藏密码' : '显示密码'}
                                >
                                  {showSyncPass ? (
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path>
                                      <line x1="1" y1="1" x2="23" y2="23"></line>
                                    </svg>
                                  ) : (
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                                      <circle cx="12" cy="12" r="3"></circle>
                                    </svg>
                                  )}
                                </button>
                              </div>
                            </div>
                          </div>

                          {/* 4. 版本状态卡片（右侧贴合渐变色块） */}
                          <div className="sync-status-card">
                            <div className="sync-status-info">
                              <div className="sync-status-line">
                                <span className="sync-status-key">云端版本</span>
                                <span className="sync-status-value">
                                  {remoteMeta
                                    ? `${formatSyncTime(remoteMeta.projectUpdatedAt)} · 来自 ${remoteMeta.device} · 第 ${remoteMeta.revision} 版`
                                    : isSyncConfigured(sync)
                                      ? '尚未上传过'
                                      : '未配置'}
                                </span>
                              </div>
                              <div className="sync-status-line">
                                <span className="sync-status-key">本机档案</span>
                                <span className="sync-status-value">{formatSyncTime(project.meta.updatedAt)}</span>
                              </div>
                              {remoteMeta && remoteMeta.projectUpdatedAt > (project.meta.updatedAt || '') && (
                                <div className="sync-status-warn">云端比本机新，建议先「从云端拉取」再继续编辑</div>
                              )}
                            </div>

                            <div
                              className={`sync-status-gradient-badge ${testStatus ? (testStatus.ok ? 'connected' : 'error') : 'untested'}`}
                              title={testStatus?.message}
                            >
                              <span>
                                {testStatus
                                  ? (testStatus.ok ? '已连接云端' : '连接失败')
                                  : (isSyncConfigured(sync) ? '未连接' : '未配置')}
                              </span>
                            </div>
                          </div>

                          {/* 5. 操作按钮组 */}
                          <div className="sync-actions-row">
                            <button
                              type="button"
                              className="btn btn-secondary btn-sm"
                              onClick={handleSyncTest}
                              disabled={!!syncBusy || !isTauri()}
                            >
                              {syncBusy === 'test' && <span className="btn-spinner" />}
                              {syncBusy === 'test' ? '连接中…' : '⚡ 测试连接'}
                            </button>
                            <button
                              type="button"
                              className="btn btn-secondary btn-sm"
                              onClick={handleSyncPush}
                              disabled={!!syncBusy || !isTauri()}
                            >
                              {syncBusy === 'push' && <span className="btn-spinner" />}
                              {syncBusy === 'push' ? '上传中…' : '⤴️ 上传到云端'}
                            </button>
                            <button
                              type="button"
                              className="btn btn-secondary btn-sm"
                              onClick={handleSyncPull}
                              disabled={!!syncBusy || !isTauri()}
                            >
                              {syncBusy === 'pull' && <span className="btn-spinner" />}
                              {syncBusy === 'pull' ? '拉取中…' : '⤵️ 从云端拉取'}
                            </button>
                          </div>

                          {/* 6. 高级同步偏好 */}
                          <div className="sync-switch-options">
                            <div className="sync-switch-row">
                              <div>
                                <div className="sync-switch-title">进入家谱时检查云端更新</div>
                                <div className="sync-switch-desc">打开档案时若发现云端版本较新，将提示拉取</div>
                              </div>
                              <label className="ios-switch">
                                <input
                                  type="checkbox"
                                  checked={sync.autoCheck}
                                  onChange={(e) => patchSync({ autoCheck: e.target.checked })}
                                />
                                <span className="ios-slider" />
                              </label>
                            </div>
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </div>
              </>
            )}

            {/* 3. 高级设置 */}
            {activeTab === 'advanced' && (
              <>
                {/* 密码设置卡片 */}
                <div className="settings-section">
                  <div className="settings-section-title">密码设置</div>

                  <div className="password-status-bar">
                    {project.meta.hasPassword ? (
                      <div className="status-container encrypted">
                        <span className="status-icon">🔒</span>
                        <div className="status-text">
                          <strong>已启用密码保护</strong>
                          <p>当前家谱文件已被加密，下次打开时需要密码验证。</p>
                        </div>
                        <div className="password-actions-row" style={{ marginLeft: 'auto', display: 'flex', gap: '8px', flexShrink: 0 }}>
                          <button
                            type="button"
                            className="btn btn-sm btn-ghost"
                            onClick={handleStartChangePassword}
                          >
                            修改加密密码
                          </button>
                          <button
                            type="button"
                            className="btn btn-sm btn-ghost danger-text-hover"
                            onClick={handleRemovePassword}
                          >
                            取消密码保护
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="status-container clear">
                        <span className="status-icon">🔓</span>
                        <div className="status-text">
                          <strong>未启用密码保护</strong>
                          <p>当前家谱文件未设置密码，打开时无需进行身份验证。</p>
                        </div>
                        <button
                          type="button"
                          className="btn btn-sm btn-ghost"
                          style={{ marginLeft: 'auto', flexShrink: 0 }}
                          onClick={() => setShowPasswordSection(true)}
                        >
                          设置加密密码
                        </button>
                      </div>
                    )}
                  </div>

                  {showPasswordSection && (
                    <div className="password-inputs-area" style={{ marginTop: '16px', padding: '16px', background: 'var(--color-bg-input)', borderRadius: 'var(--radius-md)' }}>
                      <div className="password-inputs-row">
                        <div className="form-group">
                          <label className="form-label" htmlFor="newPassword">
                            {project.meta.hasPassword ? '新密码' : '设置密码'}
                          </label>
                          <input
                            id="newPassword"
                            type="password"
                            className="form-input"
                            value={newPassword}
                            autoComplete="new-password"
                            spellCheck={false}
                            onChange={(e) => setNewPassword(e.target.value)}
                            placeholder={project.meta.hasPassword ? '请输入新密码' : '请输入密码'}
                          />
                        </div>
                        <div className="form-group">
                          <label className="form-label" htmlFor="confirmPassword">确认新密码</label>
                          <input
                            id="confirmPassword"
                            type="password"
                            className="form-input"
                            value={confirmPassword}
                            autoComplete="new-password"
                            spellCheck={false}
                            onChange={(e) => setConfirmPassword(e.target.value)}
                            placeholder="请再次输入新密码"
                          />
                        </div>
                      </div>
                      <div className="password-buttons-row">
                        <button
                          type="button"
                          className="btn btn-bordered btn-sm"
                          onClick={() => {
                            setShowPasswordSection(false);
                            setNewPassword('');
                            setConfirmPassword('');
                            setMessage(null);
                          }}
                        >
                          取消修改
                        </button>
                        <button
                          type="button"
                          className="btn btn-bordered btn-sm btn-primary-outline"
                          onClick={handleConfirmPasswordChange}
                        >
                          确认修改
                        </button>
                        <span style={{ marginLeft: 'auto', fontSize: '13px', color: 'var(--color-warning, #c2752e)', lineHeight: 1.5 }}>
                          ⚠️ 请牢记密码，否则无法恢复！
                        </span>
                      </div>
                    </div>
                  )}
                </div>

                {/* 数据脱敏卡片 */}
                <div className="settings-section">
                  <div className="settings-section-title">数据脱敏</div>
                  <p className="dev-tool-desc">
                    匿名化：将所有人员姓名临时替换为数字编号，仅供截图反馈使用，不修改底层数据。
                    <br />
                    导出脱敏数据：导出脱敏后的ZIP压缩包，不含任何隐私文件或信息，并附带运行日志（如有）。
                  </p>
                  <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginTop: '16px' }}>
                    <button
                      type="button"
                      className={`btn btn-sm ${isAnonymized ? 'btn-warning' : 'btn-secondary'}`}
                      onClick={() => toggleAnonymization()}
                      title={isAnonymized ? '点击恢复原始姓名' : '点击临时匿名化所有姓名'}
                    >
                      {isAnonymized ? '🔓 取消匿名化' : '🔒 临时匿名化姓名'}
                    </button>
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={handleExportAnonymized}
                      disabled={isExporting}
                    >
                      {isExporting ? '⏳ 正在导出...' : '📦 导出脱敏数据'}
                    </button>
                  </div>
                </div>

                {/* 调试工具卡片 */}
                <div className="settings-section">
                  <div className="settings-section-title">调试工具</div>
                  <p className="dev-tool-desc" style={{ marginBottom: '14px' }}>
                    打开内置开发人员工具（DevTools），方便排查界面异常或查看控制台报错日志。
                  </p>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => openDevtools()}
                  >
                    🛠️ DevTools
                  </button>
                </div>
              </>
            )}

            {/* 内联错误提示 */}
            {message && (
              <div className={`settings-alert-message ${message.type}`}>
                {message.text}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 纯净页脚（居中、非卡片、无外框） */}
      <footer className="settings-about-footer">
        <div className="settings-footer-update-line">
          <span>以苒纪 v{__APP_VERSION__}</span>
          <span className="footer-dot">·</span>
          <button
            type="button"
            className="footer-link-btn"
            onClick={handleCheckUpdate}
            disabled={isCheckingUpdate}
          >
            {isCheckingUpdate ? '⏳ 检查中…' : '检查更新'}
          </button>
        </div>
        <div className="settings-footer-links-line">
          <button
            type="button"
            className="footer-link-btn"
            onClick={() => openUrl('https://space.bilibili.com/255947051')}
          >
            作者B站
          </button>
          <span className="footer-dot">·</span>
          <button
            type="button"
            className="footer-link-btn"
            onClick={() => openUrl('https://github.com/hcllmsx/yiranji')}
          >
            GitHub 仓库
          </button>
          <span className="footer-dot">·</span>
          <button
            type="button"
            className="footer-link-btn"
            onClick={() => openUrl('https://docs.qq.com/form/page/DRHJ3bmd6Q3RqaENT')}
          >
            我要反馈
          </button>
        </div>
        <div className="settings-footer-copyright">
          © 2026 莫莫先生 · 基于 GPL-3.0 协议开源
        </div>
      </footer>
    </div>
  );
}
