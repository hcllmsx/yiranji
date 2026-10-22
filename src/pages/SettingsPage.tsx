import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useFamilyStore } from '../store/familyStore';
import { openDevtools, isTauri, selectFilePathForSaveZip, writeBinaryFile, getAppLogs, openUrl, selectProjectParentDir, moveProjectWorkspace, openInExplorer, webdavTest, webdavRemoteMeta, webdavListProjects, type RemoteSyncMeta, type RemoteProject } from '../utils/tauri';
import { getDefaultSaveDir, setDefaultSaveDir, getTreeLayoutMode, setTreeLayoutMode, resetSampleEntry, type TreeLayoutMode } from '../utils/appPrefs';
import {
  getSyncSettings,
  saveSyncSettings,
  isSyncConfigured,
  remoteDirFor,
  formatSyncTime,
  formatBytes,
  WEBDAV_PRESETS,
  type SyncSettings,
} from '../utils/cloudSync';
import { checkForUpdate } from '../utils/updateChecker';
import { useUpdateStore } from '../store/updateStore';
import { createAnonymizedExport, sha256 } from '../utils';
import './SettingsPage.css';

export default function SettingsPage() {
  const navigate = useNavigate();
  const { project, updateMeta, changeProjectPassword, isAnonymized, toggleAnonymization, currentFilePath, relocateProject, syncPushToCloud, syncPullFromCloud, restoreProjectFromCloud } = useFamilyStore();

  type SettingsTab = 'basic' | 'tree' | 'storage' | 'sync' | 'security' | 'about';
  const [activeTab, setActiveTab] = useState<SettingsTab>('basic');
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
  const handleTreeLayoutModeChange = (mode: TreeLayoutMode) => {
    setTreeLayoutModeState(mode);
    setTreeLayoutMode(mode);
  };

  // 多设备同步（WebDAV）
  const [sync, setSync] = useState<SyncSettings>(() => getSyncSettings());
  const [syncBusy, setSyncBusy] = useState<'' | 'test' | 'push' | 'pull'>('');
  const [remoteMeta, setRemoteMeta] = useState<RemoteSyncMeta | null>(null);
  const [remoteProjects, setRemoteProjects] = useState<RemoteProject[] | null>(null);
  const [loadingRemoteList, setLoadingRemoteList] = useState(false);
  const [restoringDir, setRestoringDir] = useState('');

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

  // 从侧边栏「云同步」进来时，直接滚到同步板块
  useEffect(() => {
    if (window.location.hash !== '#sync-section') return;
    const timer = window.setTimeout(() => {
      document.getElementById('sync-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 150);
    return () => window.clearTimeout(timer);
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
    setSync(saveSyncSettings(patch));
  };

  const syncKeyOf = project?.meta.syncKey;

  const refreshRemoteMeta = async () => {
    if (!isTauri() || !isSyncConfigured(sync) || !syncKeyOf) {
      setRemoteMeta(null);
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
    } catch {
      setRemoteMeta(null);
    }
  };

  useEffect(() => {
    refreshRemoteMeta();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [syncKeyOf, sync.server, sync.username, sync.password, sync.remoteRoot]);

  // -------------------- 表单提交 --------------------
  if (!project) return null;

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage(null);

    const trimmedName = familyName.trim();
    if (!trimmedName) {
      setMessage({ text: '家谱名称不能为空', type: 'error' });
      return;
    }

    try {
      if (trimmedName !== project.meta.familyName) {
        updateMeta({ familyName: trimmedName });
      }
      showToast('保存设置成功！已自动更新当前工作区。', 'success');
    } catch (err) {
      console.error(err);
      setMessage({ text: '保存失败，请重试', type: 'error' });
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
      } catch (err) {
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
      const familyName = project.meta.familyName || '家谱';
      const exportFolderName = familyName + '_脱敏数据';

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
        const savePath = await selectFilePathForSaveZip(`${familyName}_脱敏数据.zip`);
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
        a.download = `${familyName}_脱敏数据.zip`;
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
        // 发现新版本：弹窗引导下载
        useUpdateStore.getState().openUpdateDialog(result.latestVersion);
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
    // Windows 环境或带盘符的绝对路径，统一转为反斜杠 \
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

      // 迁移成功后，把新位置同步为默认保存位置，避免下次新建又跑到老地方
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

  // ==================== 多设备同步（WebDAV） ====================
  const syncKey = project.meta.syncKey;
  const cloudDir = syncKey ? remoteDirFor(sync, syncKey) : '';

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
    try {
      const root = sync.remoteRoot.replace(/^\/+|\/+$/g, '') || 'yiranji';
      const path = await webdavTest(sync.server, sync.username, sync.password, root);
      showToast(`连接成功，云端目录：${path}`, 'success');
      await refreshRemoteMeta();
    } catch (err: any) {
      showToast(`连接失败：${err?.message || err}`, 'error');
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

    setSyncBusy('push');
    try {
      const remoteNewer =
        !!remoteMeta?.projectUpdatedAt &&
        remoteMeta.projectUpdatedAt > (project.meta.updatedAt || '');
      if (remoteNewer && !sync.forceOverwrite) {
        showToast(
          `云端有更新的版本（${formatSyncTime(remoteMeta!.updatedAt)}，来自 ${remoteMeta!.device}），请先拉取；确需覆盖请勾选「允许覆盖云端」`,
          'error'
        );
        return;
      }
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
      message: `将用云端档案覆盖本机当前档案，本机会先把 project.json 备份到 .sync-backup 目录。${
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

  const refreshRemoteProjects = async () => {
    if (!isTauri()) {
      showToast('云同步仅在桌面版可用', 'error');
      return;
    }
    if (!isSyncConfigured(sync)) {
      showToast('请先填写服务器地址、账号和应用密码', 'error');
      return;
    }
    setLoadingRemoteList(true);
    try {
      const list = await webdavListProjects(
        sync.server,
        sync.username,
        sync.password,
        sync.remoteRoot
      );
      setRemoteProjects(list);
      if (list.length === 0) showToast('云端还没有家谱备份', 'error');
    } catch (err: any) {
      showToast(`读取云端家谱失败：${err?.message || err}`, 'error');
      setRemoteProjects(null);
    } finally {
      setLoadingRemoteList(false);
    }
  };

  const handleRestore = (item: RemoteProject) => {
    if (restoringDir) return;
    const label = item.familyName || '未命名家谱';
    setDialog({
      show: true,
      title: '从云端恢复家谱',
      message: `将把「${label}」下载到本机一个新文件夹并打开，照片等媒体会一并补齐。接下来请选择保存位置。`,
      confirmText: '选择保存位置',
      tone: 'primary',
      onConfirm: async () => {
        const parent = await selectProjectParentDir(defaultSaveDir || undefined);
        if (!parent) return false;
        setRestoringDir(item.dir);
        try {
          const root = (sync.remoteRoot || 'yiranji').replace(/^\/+|\/+$/g, '');
          const result = await restoreProjectFromCloud(
            `${root}/${item.dir}`,
            parent,
            label
          );
          showToast(`已恢复「${label}」，补齐媒体 ${result.media} 个`, 'success');
          navigate('/tree');
        } catch (err: any) {
          const msg = String(err?.message || err);
          showToast(
            msg.includes('PASSWORD')
              ? '档案已下载，但有密码保护，请在首页重新打开并输入密码'
              : `恢复失败：${msg}`,
            'error'
          );
        } finally {
          setRestoringDir('');
        }
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

      {/* ---- 页面主体 ---- */}
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
            <span className="settings-nav-label">基本设置</span>
          </button>
          <button
            type="button"
            className={`settings-nav-item ${activeTab === 'tree' ? 'active' : ''}`}
            onClick={() => setActiveTab('tree')}
          >
            <span className="settings-nav-icon">🌳</span>
            <span className="settings-nav-label">家谱树显示</span>
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
            className={`settings-nav-item ${activeTab === 'sync' ? 'active' : ''}`}
            onClick={() => setActiveTab('sync')}
          >
            <span className="settings-nav-icon">☁️</span>
            <span className="settings-nav-label">云同步</span>
          </button>
          <button
            type="button"
            className={`settings-nav-item ${activeTab === 'security' ? 'active' : ''}`}
            onClick={() => setActiveTab('security')}
          >
            <span className="settings-nav-icon">🔒</span>
            <span className="settings-nav-label">安全与密码</span>
          </button>
          <button
            type="button"
            className={`settings-nav-item ${activeTab === 'about' ? 'active' : ''}`}
            onClick={() => setActiveTab('about')}
          >
            <span className="settings-nav-icon">ℹ️</span>
            <span className="settings-nav-label">关于与支持</span>
          </button>
        </aside>

        {/* 右侧配置面板 */}
        <div className="settings-content">
          <form onSubmit={handleSave} className="settings-form">
        {/* 基本信息 */}
        {activeTab === 'basic' && (
          <div className="settings-section">
            <div className="settings-section-title settings-section-title--with-badge">
              <span>基本信息</span>
              <span className="settings-data-version" title="家谱数据结构版本，打开旧档案时会自动升级">
                当前家谱数据版本：{project?.meta.version || '—'}
              </span>
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="familyName">家谱名称</label>
              <input
                id="familyName"
                type="text"
                className="form-input"
                value={familyName}
                onChange={(e) => setFamilyName(e.target.value)}
                placeholder="请输入家谱名称"
                maxLength={50}
              />
            </div>

            <div className="form-group" style={{ marginTop: '24px', paddingTop: '20px', borderTop: '1px dashed var(--color-border-light)' }}>
              <label className="form-label">示例家谱入口</label>
              <p className="dev-tool-desc" style={{ marginBottom: '12px' }}>
                默认情况下，在首页点击体验过示例家谱后，入口将自动隐藏。若需要再次在首页查看，可点击下方按钮重置。
              </p>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => {
                  resetSampleEntry();
                  showToast('已重置！返回首页将再次显示「示例家谱」按钮', 'success');
                }}
              >
                📖 在首页重新显示示例家谱入口
              </button>
            </div>
          </div>
        )}

        {/* 家谱树显示模式 */}
        {activeTab === 'tree' && (
          <div className="settings-section">
          <div className="settings-section-title">家谱树显示</div>
          <p className="dev-tool-desc" style={{ marginBottom: '16px' }}>
            选择家谱树成员卡片的排版方式。切换后回到家谱树页面即可生效，仅影响显示，不改动任何人物数据。
          </p>

          <div style={{ fontSize: '13px', fontWeight: 600, color: '#374151', marginBottom: '8px' }}>
            节点布局方式
          </div>
          <div className="tree-mode-options" style={{ marginBottom: '20px' }}>
            <label className={`tree-mode-option${treeLayoutMode === 'classic' ? ' is-active' : ''}`}>
              <input
                type="radio"
                name="treeLayoutMode"
                value="classic"
                checked={treeLayoutMode === 'classic'}
                onChange={() => handleTreeLayoutModeChange('classic')}
              />
              <span className="tree-mode-text">
                <span className="tree-mode-name">经典模式</span>
                <span className="tree-mode-desc">
                  以主视角一脉为中心或偏左，其他脉左右交替排开；同辈成员按长幼顺序上下阶梯错落排布，尊卑有序、层级分明。
                </span>
              </span>
            </label>

            <label className={`tree-mode-option${treeLayoutMode === 'aligned' ? ' is-active' : ''}`}>
              <input
                type="radio"
                name="treeLayoutMode"
                value="aligned"
                checked={treeLayoutMode === 'aligned'}
                onChange={() => handleTreeLayoutModeChange('aligned')}
              />
              <span className="tree-mode-text">
                <span className="tree-mode-name">同辈齐平</span>
                <span className="tree-mode-desc">
                  同辈所有成员在同一水平线严格拉齐，从左到右平铺排列（支持手动调整排行），紧凑规整。
                </span>
              </span>
            </label>
          </div>
        </div>
        )}

        {/* 档案存储 */}
        {activeTab === 'storage' && (
          <div className="settings-section">
          <div className="settings-section-title">档案存储</div>
          <p className="dev-tool-desc" style={{ marginBottom: '16px' }}>
            家谱以文件夹形式实时保存（内含 project.json 与 media 照片），修改后自动写入，无需手动保存。
          </p>

          <div className="form-group">
            <label className="form-label">当前档案位置</label>
            <div className="path-display" title={currentFilePath || ''}>
              {currentFilePath ? formatWinPath(currentFilePath) : (isTauri() ? '尚未保存到本地' : '浏览器模式：数据保存在浏览器本地存储中')}
            </div>
            <div className="path-actions">
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
          </div>

          <div className="form-group">
            <label className="form-label">新建档案的默认保存位置</label>
            <div className="path-display" title={defaultSaveDir || ''}>
              {defaultSaveDir ? formatWinPath(defaultSaveDir) : '未设置（每次新建档案时弹出选择框）'}
            </div>
            <div className="path-actions">
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={handleChooseDefaultDir}
                disabled={!isTauri()}
                title={isTauri() ? '选择默认保存目录' : '仅桌面版可用'}
              >
                📁 选择文件夹
              </button>
              {defaultSaveDir && (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={handleClearDefaultDir}
                >
                  恢复为每次询问
                </button>
              )}
            </div>
            {defaultSaveDir && (
              <p className="form-hint" style={{ marginTop: '8px' }}>
                新建家谱将自动保存在：
                <strong style={{ color: 'var(--color-accent)' }}>{defaultSaveDir}</strong>
              </p>
            )}
          </div>

          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label">迁移当前档案</label>
            <p className="dev-tool-desc">
              把整个档案文件夹（含全部照片、音频）复制到你选定的新位置，并自动切换到新位置。
              原目录会保留作为备份，确认无误后可自行删除。
            </p>
            <div className="path-actions">
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
        </div>
        )}

        {/* 多设备同步 */}
        {activeTab === 'sync' && (
          <div className="settings-section" id="sync-section">
          <div className="settings-section-title">多设备同步</div>
          <p className="dev-tool-desc" style={{ marginBottom: '14px' }}>
            把档案同步到支持 WebDAV 的网盘（坚果云 / InfiniCLOUD / 自建 Nextcloud），两台电脑共用同一份云端备份。
            上传只补传云端还没有的照片，已传过的不会重复上传，免费额度也够长期用。
            {!isTauri() && (
              <>
                <br />
                <strong>网页版不支持云同步，请安装桌面版使用。</strong>
              </>
            )}
          </p>

          <div className="sync-preset-row">
            <span className="sync-preset-label">快速填入：</span>
            {WEBDAV_PRESETS.map((preset) => (
              <button
                key={preset.name}
                type="button"
                className="sync-preset-btn"
                title={preset.hint}
                onClick={() => patchSync({ server: preset.server })}
              >
                {preset.name}
              </button>
            ))}
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="syncServer">服务地址</label>
            <input
              id="syncServer"
              type="text"
              className="form-input"
              value={sync.server}
              placeholder="https://dav.jianguoyun.com/dav/"
              onChange={(e) => patchSync({ server: e.target.value })}
            />
          </div>

          <div className="sync-two-col">
            <div className="form-group">
              <label className="form-label" htmlFor="syncUser">账号</label>
              <input
                id="syncUser"
                type="text"
                className="form-input"
                value={sync.username}
                placeholder="登录邮箱 / 用户名"
                onChange={(e) => patchSync({ username: e.target.value })}
              />
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="syncPass">应用密码</label>
              <input
                id="syncPass"
                type="password"
                className="form-input"
                value={sync.password}
                placeholder="WebDAV 应用密码"
                onChange={(e) => patchSync({ password: e.target.value })}
              />
            </div>
          </div>

          <div className="sync-two-col">
            <div className="form-group">
              <label className="form-label" htmlFor="syncRoot">云端根目录</label>
              <input
                id="syncRoot"
                type="text"
                className="form-input"
                value={sync.remoteRoot}
                placeholder="yiranji"
                onChange={(e) => patchSync({ remoteRoot: e.target.value })}
              />
            </div>
            <div className="form-group">
              <label className="form-label">本家谱的云端位置</label>
              <div className="path-display" title={cloudDir}>
                {cloudDir || '首次上传时自动生成'}
              </div>
            </div>
          </div>

          <div className="sync-status-card">
            <div className="sync-status-line">
              <span className="sync-status-key">云端版本</span>
              <span className="sync-status-value">
                {remoteMeta
                  ? `${formatSyncTime(remoteMeta.updatedAt)} · 来自 ${remoteMeta.device} · 第 ${remoteMeta.revision} 版`
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
              <div className="sync-status-warn">⚠️ 云端比本机新，建议先「从云端拉取」再继续编辑</div>
            )}
          </div>

          <div className="sync-actions">
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={handleSyncTest}
              disabled={!!syncBusy || !isTauri()}
            >
              {syncBusy === 'test' ? '⏳ 连接中…' : '🔌 测试连接'}
            </button>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={handleSyncPush}
              disabled={!!syncBusy || !isTauri()}
            >
              {syncBusy === 'push' ? '⏳ 上传中…' : '⬆️ 上传到云端'}
            </button>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={handleSyncPull}
              disabled={!!syncBusy || !isTauri()}
            >
              {syncBusy === 'pull' ? '⏳ 拉取中…' : '⬇️ 从云端拉取'}
            </button>
          </div>

          <div className="sync-options">
            <label className="sync-check">
              <input
                type="checkbox"
                checked={sync.enabled}
                onChange={(e) => patchSync({ enabled: e.target.checked })}
              />
              <span>启用云同步</span>
            </label>
            <label className="sync-check">
              <input
                type="checkbox"
                checked={sync.autoCheck}
                onChange={(e) => patchSync({ autoCheck: e.target.checked })}
              />
              <span>进入家谱时检查云端更新</span>
            </label>
            <label className="sync-check">
              <input
                type="checkbox"
                checked={sync.autoPush}
                onChange={(e) => patchSync({ autoPush: e.target.checked })}
              />
              <span>保存后自动上传（约 5 秒后）</span>
            </label>
            <label className="sync-check">
              <input
                type="checkbox"
                checked={sync.forceOverwrite}
                onChange={(e) => patchSync({ forceOverwrite: e.target.checked })}
              />
              <span>允许本机覆盖云端的较新版本</span>
            </label>
          </div>

          <p className="form-hint" style={{ marginTop: '10px' }}>
            账号密码只保存在本机。坚果云要用「账户信息 → 安全选项 → 应用密码」生成的那串密码，不是登录密码。
            两台电脑都开启同步后，可在本页手动上传或拉取档案，也可按设置自动检查云端更新。
          </p>

          <div className="sync-restore">
            <div className="sync-restore-head">
              <div>
                <strong>换电脑 / 找回云端档案</strong>
                <span>新电脑上直接读取云端已有家谱，无需手工拷贝文件</span>
              </div>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={refreshRemoteProjects}
                disabled={loadingRemoteList || !isTauri()}
              >
                {loadingRemoteList ? '⏳ 读取中…' : '🔍 读取云端家谱'}
              </button>
            </div>

            {remoteProjects && remoteProjects.length === 0 && (
              <p className="form-hint" style={{ margin: '10px 0 0' }}>
                云端根目录下还没有家谱备份。
              </p>
            )}

            {remoteProjects && remoteProjects.length > 0 && (
              <ul className="sync-restore-list">
                {remoteProjects.map((item) => (
                  <li key={item.dir} className="sync-restore-item">
                    <div className="sync-restore-info">
                      <strong>{item.familyName || '未命名家谱'}</strong>
                      <span>
                        {formatSyncTime(item.updatedAt)} · 来自 {item.device || '未知设备'} ·
                        第 {item.revision} 版 · {item.mediaCount} 个媒体
                      </span>
                    </div>
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => handleRestore(item)}
                      disabled={!!restoringDir}
                    >
                      {restoringDir === item.dir ? '⏳ 恢复中…' : '恢复到本机'}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
        )}

        {/* 安全与密码 */}
        {activeTab === 'security' && (
          <div className="settings-section">
          <div className="settings-section-title">安全与密码</div>

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
        )}

        {/* 内联错误提示 —— 仅保留给校验错误；成功类提示已由 Toast 接管 */}
        {message && (
          <div className={`settings-alert-message ${message.type}`}>
            {message.text}
          </div>
        )}

        {/* 关于与支持 (含开发者与版本) */}
        {activeTab === 'about' && (
          <>
            <div className="settings-section">
          <div className="settings-section-title">开发者</div>
          <div className="dev-tools-grid">
            <div className="dev-tool-item">
              <p className="dev-tool-label">调试工具</p>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => openDevtools()}
              >
                🛠️ DevTools
              </button>
            </div>
            <div className="dev-tool-item">
              <p className="dev-tool-label">数据脱敏</p>
              <p className="dev-tool-desc">
                匿名化：将所有人员姓名临时替换为数字编号，仅供截图反馈使用，不修改底层数据。
                <br />
                导出脱敏数据：导出脱敏后的ZIP压缩包，不含任何隐私文件或信息，并附带运行日志（如有）。
              </p>
              <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
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
          </div>
        </div>

        {/* 关于 */}
        <div className="settings-section">
          <div className="settings-section-title">关于</div>
          <div className="dev-tools-grid">
            <div className="dev-tool-item">
              <p className="dev-tool-label">当前版本</p>
              <p className="dev-tool-desc">以苒纪 Yiranji v{__APP_VERSION__}</p>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={handleCheckUpdate}
                disabled={isCheckingUpdate}
              >
                {isCheckingUpdate ? '⏳ 检查中…' : '🔄 检查更新'}
              </button>
            </div>
          </div>
        </div>

          </>
        )}

        {/* 底部提交 */}
        <div className="settings-footer">
          <button
            type="button"
            className="btn btn-secondary"
            style={{ padding: '10px 24px' }}
            onClick={() => openUrl('https://docs.qq.com/form/page/DRHJ3bmd6Q3RqaENT')}
            title="通过在线表单提交问题与建议"
          >
            📝 问题反馈
          </button>
          <button type="submit" className="btn btn-primary" style={{ padding: '10px 24px' }}>
            💾 保存设置
          </button>
        </div>
          </form>
        </div>
      </div>
    </div>
  );
}
