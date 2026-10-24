import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useFamilyStore } from '../store/familyStore';
import {
  isTauri,
  selectFilePathForOpen,
  isYrjFileEncrypted,
  selectProjectParentDir,
  createProjectWorkspace,
  deleteProjectWorkspaceFromDisk,
  openUrl,
  installSampleWorkspace,
  webdavListProjects,
  type RemoteProject,
} from '../utils/tauri';
import { getSyncSettings, saveSyncSettings, isSyncConfigured, formatSyncTime } from '../utils/cloudSync';
import { getDefaultSaveDir, shouldShowSampleEntry, dismissSampleEntry } from '../utils/appPrefs';
import { subscribeSettings } from '../utils/appSettings';
import './WelcomePage.css';

export default function WelcomePage() {
  const navigate = useNavigate();
  const {
    createProject,
    openProject,
    openProjectFromFile,
    recentProjects,
    loadRecentProjects,
    removeRecentProject,
    importProjectFromJSON,
    restoreProjectFromCloud,
  } = useFamilyStore();

  // 云端拉取模态框
  const [showCloudModal, setShowCloudModal] = useState(false);
  const [cloudLoading, setCloudLoading] = useState(false);
  const [cloudError, setCloudError] = useState('');
  const [cloudProjects, setCloudProjects] = useState<RemoteProject[]>([]);
  const [restoringDir, setRestoringDir] = useState('');
  const [showCloudConfig, setShowCloudConfig] = useState(false);
  const [isCloudDisabled, setIsCloudDisabled] = useState(false);
  const [cloudSyncConfig, setCloudSyncConfig] = useState(() => getSyncSettings());

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [surname, setSurname] = useState('');
  const [familyName, setFamilyName] = useState('');
  const [password, setPassword] = useState('');
  // 新建档案的父目录：优先使用"设置 → 档案存储"里配置的默认位置
  const [selectedParentDir, setSelectedParentDir] = useState(() => getDefaultSaveDir());

  // 密码解锁相关
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [pendingOpenPath, setPendingOpenPath] = useState<string | null>(null);
  const [unlockPassword, setUnlockPassword] = useState('');
  const [unlockError, setUnlockError] = useState('');

  // 密码确认对话框（创建时）
  const [showPwdConfirmDialog, setShowPwdConfirmDialog] = useState(false);
  const [pendingCreatePwd, setPendingCreatePwd] = useState('');

  // 是否在首页显示「示例家谱」按钮（首次未点过，或升级新版本后显示）
  const [showSampleButton, setShowSampleButton] = useState(() => shouldShowSampleEntry(__APP_VERSION__));

  useEffect(() => {
    setShowSampleButton(shouldShowSampleEntry(__APP_VERSION__));
    return subscribeSettings(() => {
      setShowSampleButton(shouldShowSampleEntry(__APP_VERSION__));
    });
  }, []);

  // 自定义对话框相关
  const [dialog, setDialog] = useState<{
    show: boolean;
    type: 'alert' | 'confirm';
    title: string;
    message: string;
    onConfirm?: () => void;
    onCancel?: () => void;
  }>({
    show: false,
    type: 'alert',
    title: '',
    message: '',
  });

  const showCustomAlert = (message: string, title = '提示', onConfirm?: () => void) => {
    setDialog({
      show: true,
      type: 'alert',
      title,
      message,
      onConfirm: () => {
        setDialog(prev => ({ ...prev, show: false }));
        onConfirm?.();
      }
    });
  };

  const showCustomConfirm = (message: string, onConfirm: () => void, title = '确认') => {
    setDialog({
      show: true,
      type: 'confirm',
      title,
      message,
      onConfirm: () => {
        onConfirm();
        setDialog(prev => ({ ...prev, show: false }));
      },
      onCancel: () => setDialog(prev => ({ ...prev, show: false }))
    });
  };

  useEffect(() => {
    loadRecentProjects();
  }, [loadRecentProjects]);

  // 当姓氏变化时，智能自动回填默认的家谱名
  useEffect(() => {
    if (surname.trim()) {
      setFamilyName(`${surname.trim()}氏-以苒纪`);
    } else {
      setFamilyName('');
    }
  }, [surname]);

  const handleCreate = async () => {
    if (!surname.trim()) return;
    const finalFamilyName = familyName.trim() || `${surname.trim()}氏-以苒纪`;

    // 如果用户设置了密码，先校验格式再弹窗确认
    if (password.trim()) {
      const pwd = password.trim();
      if (pwd.length < 4) {
        showCustomAlert('设置的加密密码不能少于 4 位！');
        return;
      }
      setPendingCreatePwd(pwd);
      setShowPwdConfirmDialog(true);
      return;
    }

    await doCreate(surname.trim(), finalFamilyName);
  };

  const doCreate = async (surnameVal: string, finalFamilyName: string, pwd?: string) => {
    let workspacePath: string | undefined = undefined;
    if (isTauri()) {
      // 未显式选择时，回退到设置里的默认保存位置，避免"必须先选目录"的拦路提示
      const parentDir = selectedParentDir || getDefaultSaveDir();
      if (!parentDir) {
        showCustomAlert("请选择家谱保存位置目录！（也可以在「设置 → 档案存储」里设置一个默认位置，以后就不再询问）");
        return;
      }
      if (pwd && pwd.length < 4) {
        showCustomAlert("设置的加密密码不能少于 4 位！");
        return;
      }
      try {
        workspacePath = await createProjectWorkspace(parentDir, finalFamilyName);
      } catch (e) {
        showCustomAlert(`创建家谱文件夹失败: ${e}`);
        return;
      }
    } else {
      if (pwd && pwd.length < 4) {
        showCustomAlert("设置的加密密码不能少于 4 位！");
        return;
      }
    }

    const projectId = await createProject(
      surnameVal,
      pwd || undefined,
      workspacePath,
      finalFamilyName
    );
    if (projectId) {
      setShowCreateModal(false);
      navigate('/tree');
    }
  };

  // 统一打开文件方法
  const handleOpenFile = async () => {
    try {
      const path = await selectFilePathForOpen();
      if (!path) return; // 用户取消

      if (path.endsWith('.yrj')) {
        const isEncrypted = await isYrjFileEncrypted(path);
        if (isEncrypted) {
          setPendingOpenPath(path);
          setUnlockPassword('');
          setUnlockError('');
          setShowPasswordModal(true);
          return;
        }
      }

      // 如果直接是文件夹，或者未加密的.yrj
      try {
        const success = await openProjectFromFile(path);
        if (success) navigate('/tree');
      } catch (err: any) {
        if (err.message === 'PASSWORD_REQUIRED_OR_INCORRECT') {
          // 优先使用已解包的工作区路径，避免用 .yrj 路径重试时触发二次解包
          setPendingOpenPath(err.workspacePath || path);
          setUnlockPassword('');
          setUnlockError('');
          setShowPasswordModal(true);
        } else {
          throw err;
        }
      }
    } catch (e) {
      showCustomAlert(`打开工程文件失败: ${e}`);
    }
  };

  // 直接打开家谱文件夹目录
  const handleOpenFolder = async () => {
    try {
      const path = await selectProjectParentDir(selectedParentDir || getDefaultSaveDir() || null);
      if (!path) return; // 用户取消

      try {
        const success = await openProjectFromFile(path);
        if (success) navigate('/tree');
      } catch (err: any) {
        if (err.message === 'PASSWORD_REQUIRED_OR_INCORRECT') {
          setPendingOpenPath(err.workspacePath || path);
          setUnlockPassword('');
          setUnlockError('');
          setShowPasswordModal(true);
        } else {
          showCustomAlert(`该文件夹不是有效的以苒纪家谱工作区（${err.message || err}）`);
        }
      }
    } catch (e) {
      showCustomAlert(`打开家谱文件夹失败: ${e}`);
    }
  };

  const loadCloudList = async (sync = getSyncSettings()) => {
    setCloudLoading(true);
    setCloudError('');
    try {
      const list = await webdavListProjects(
        sync.server,
        sync.username,
        sync.password,
        sync.remoteRoot || 'yiranji'
      );
      setCloudProjects(list);
    } catch (err: any) {
      setCloudError(err?.message || String(err));
    } finally {
      setCloudLoading(false);
    }
  };

  // 从云端获取家谱（严格响应总开关与未配置状态）
  const handleOpenCloud = async () => {
    const sync = getSyncSettings();
    setCloudSyncConfig(sync);
    setShowCloudModal(true);
    setCloudError('');

    if (!isSyncConfigured(sync)) {
      setIsCloudDisabled(false);
      setShowCloudConfig(true);
      return;
    }

    if (!sync.enabled) {
      setIsCloudDisabled(true);
      setShowCloudConfig(false);
      return;
    }

    setIsCloudDisabled(false);
    setShowCloudConfig(false);
    await loadCloudList(sync);
  };

  const handleSaveCloudConfig = async () => {
    if (!cloudSyncConfig.server.trim() || !cloudSyncConfig.username.trim() || !cloudSyncConfig.password) {
      setCloudError('请完整填写服务地址、账号和应用密码');
      return;
    }
    const updated = saveSyncSettings({
      ...cloudSyncConfig,
      enabled: true,
    });
    setCloudSyncConfig(updated);
    setShowCloudConfig(false);
    await loadCloudList(updated);
  };

  // 恢复家谱：联动“默认保存位置”，若已设置则直接使用，无需每次手动选择
  const handleRestoreProject = async (rp: RemoteProject) => {
    try {
      const defaultDir = getDefaultSaveDir();
      let parentDir: string = defaultDir || '';
      if (!parentDir) {
        const selected = await selectProjectParentDir();
        if (!selected) return;
        parentDir = selected;
      }
      setRestoringDir(rp.dir);
      const res = await restoreProjectFromCloud(rp.dir, parentDir, rp.familyName || rp.dir);
      setShowCloudModal(false);
      showCustomAlert(`成功从云端恢复家谱“${rp.familyName || rp.dir}”（包含 ${res.media} 个媒体文件）`);
      navigate('/tree');
    } catch (err: any) {
      showCustomAlert(`从云端恢复家谱失败: ${err?.message || err}`);
    } finally {
      setRestoringDir('');
    }
  };

  // 打开随软件发布的示例家谱
  const handleOpenSample = async () => {
    try {
      dismissSampleEntry(__APP_VERSION__);
      setShowSampleButton(false);
      const path = await installSampleWorkspace();
      const success = await openProjectFromFile(path);
      if (success) navigate('/tree');
    } catch (e) {
      showCustomAlert(`打开示例家谱失败: ${e}`);
    }
  };

  // 解锁并打开
  const handleUnlockConfirm = async () => {
    if (!pendingOpenPath) return;
    setUnlockError('');
    const trimmedPassword = unlockPassword.trim();
    try {
      const success = await openProjectFromFile(
        pendingOpenPath,
        trimmedPassword,
        false
      );
      if (success) {
        setShowPasswordModal(false);
        setPendingOpenPath(null);
        navigate('/tree');
      }
    } catch (e: any) {
      console.error('解锁失败详情:', e);
      if (e.message === 'PASSWORD_REQUIRED_OR_INCORRECT') {
        setUnlockError('密码错误，请重新输入');
      } else {
        setUnlockError(`解锁失败: ${e.message || e}`);
      }
    }
  };

  // 从磁盘永久删除家谱文件夹
  const handleDeleteFromDisk = (item: typeof recentProjects[0]) => {
    const isDisk = isTauri() && Boolean(item.filePath);
    const targetPath = item.filePath || '浏览器本地缓存';

    const message = isDisk
      ? `确定要从磁盘永久删除家谱“${item.familyName}”的文件夹吗？\n\n文件路径：\n${targetPath}\n\n注意：此操作将永久删除该文件夹及其所有内容（包括全部谱系数据、照片和多媒体文件），不可撤销！`
      : `确定要永久删除家谱“${item.familyName}”吗？\n\n注意：当前处于网页版，此操作将清除浏览器中保存的该家谱全部本地数据，不可撤销！`;

    showCustomConfirm(
      message,
      async () => {
        try {
          if (isDisk && item.filePath) {
            await deleteProjectWorkspaceFromDisk(item.filePath);
          } else {
            try {
              localStorage.removeItem('yiranji_project_' + item.projectId);
            } catch {}
          }
          removeRecentProject(item.projectId, item.filePath);
          showCustomAlert(`已成功删除家谱“${item.familyName}”！`, '删除成功');
        } catch (err: any) {
          showCustomAlert(`删除家谱文件夹失败: ${err?.message || err}`, '删除失败');
        }
      },
      '从磁盘删除家谱文件夹'
    );
  };

  // 最近项目点击
  const handleOpenRecent = async (item: typeof recentProjects[0]) => {
    if (item.filePath && isTauri()) {
      // 本地文件模式
      try {
        // 只有以 .yrj 结尾的文件包才需要做加密检测及密码弹窗
        if (item.filePath.endsWith('.yrj')) {
          const isEncrypted = await isYrjFileEncrypted(item.filePath);
          if (isEncrypted) {
            setPendingOpenPath(item.filePath);
            setUnlockPassword('');
            setUnlockError('');
            setShowPasswordModal(true);
            return;
          }
        }

        try {
          // 从最近项目进入，直接跳过密码核验，免除重复输入！
          const success = await openProjectFromFile(item.filePath, undefined, true);
          if (success) navigate('/tree');
        } catch (err: any) {
          if (err.message === 'PASSWORD_REQUIRED_OR_INCORRECT') {
            setPendingOpenPath(err.workspacePath || item.filePath);
            setUnlockPassword('');
            setUnlockError('');
            setShowPasswordModal(true);
          } else {
            throw err;
          }
        }
      } catch (e) {
        showCustomAlert(`打开最近的工程文件失败，文件可能已被移动或删除: ${e}`);
      }
    } else {
      // 降级为 Web localStorage 模式
      const success = openProject(item.projectId);
      if (success) navigate('/tree');
    }
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();

    // 如果是未来时间，或者极其接近
    if (diffMs <= 0) return '刚刚';

    const diffMins = Math.floor(diffMs / (1000 * 60));
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffMins < 1) {
      return '刚刚';
    }
    if (diffMins < 60) {
      return `${diffMins}分钟前`;
    }
    if (diffHours < 24) {
      return `${diffHours}小时前`;
    }
    if (diffDays <= 3) {
      return `${diffDays}天前`;
    }

    // 超过3天且是同一年
    if (date.getFullYear() === now.getFullYear()) {
      return `${date.getMonth() + 1}月${date.getDate()}日`;
    }

    // 去年或更早
    return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
  };

  return (
    <div className="welcome-page">
      {/* 装饰文字 */}
      <div className="welcome-decoration">纪</div>

      <div className="welcome-content">
        <div className="welcome-logo">
          <div className="welcome-app-name">以苒纪</div>
          <div className="welcome-tagline">光阴在苒，世家成纪</div>
        </div>

        <div className="welcome-actions">
          <button
            className="welcome-btn-create"
            onClick={() => setShowCreateModal(true)}
            style={{ width: '220px', display: 'inline-flex', justifyContent: 'center' }}
          >
            <span>＋</span>
            <span>新建家谱</span>
          </button>

          {isTauri() ? (
            <>
              <button
                className="welcome-btn-open"
                onClick={handleOpenFolder}
                style={{ width: '220px', display: 'inline-flex', justifyContent: 'center', marginTop: '4px' }}
              >
                <span>📂</span>
                <span>打开文件夹</span>
              </button>
              <button
                className="welcome-btn-open"
                onClick={handleOpenFile}
                style={{ width: '220px', display: 'inline-flex', justifyContent: 'center' }}
              >
                <span>📜</span>
                <span>打开 YRJ 档案</span>
              </button>
              <button
                className="welcome-btn-open"
                onClick={handleOpenCloud}
                style={{ width: '220px', display: 'inline-flex', justifyContent: 'center' }}
              >
                <span>🌐</span>
                <span>从云端获取</span>
              </button>
              {showSampleButton && (
                <button
                  className="welcome-btn-open"
                  onClick={handleOpenSample}
                  style={{ width: '220px', display: 'inline-flex', justifyContent: 'center' }}
                >
                  <span>📖</span>
                  <span>示例家谱</span>
                </button>
              )}
            </>
          ) : (
            <>
              <button
                type="button"
                className="welcome-btn-open"
                disabled
                style={{ width: '220px', display: 'inline-flex', justifyContent: 'center', marginTop: '4px' }}
                title="网页版不支持打开本地文件夹，请使用桌面版客户端"
              >
                <span>📂</span>
                <span>打开文件夹</span>
              </button>
              <button
                type="button"
                className="welcome-btn-open"
                disabled
                style={{ width: '220px', display: 'inline-flex', justifyContent: 'center' }}
                title="网页版不支持打开本地文件，请使用桌面版客户端"
              >
                <span>📜</span>
                <span>打开文件</span>
              </button>

              {/* 导入导出JSON数据的功能为开发时调整前端时专用，请勿将此功能显示到桌面版中。 */}
              <button
                className="welcome-btn-open"
                onClick={() => {
                  const input = document.createElement('input');
                  input.type = 'file';
                  input.accept = '.json';
                  input.onchange = async (e) => {
                    const file = (e.target as HTMLInputElement).files?.[0];
                    if (!file) return;
                    
                    const reader = new FileReader();
                    reader.onload = async (event) => {
                      try {
                        const jsonStr = event.target?.result as string;
                        const project = JSON.parse(jsonStr);
                        if (!project.meta || !project.persons) {
                          showCustomAlert("无效的以苒纪家谱 JSON 工程文件！");
                          return;
                        }
                        const projectId = await importProjectFromJSON(project);
                        if (projectId) {
                          navigate('/tree');
                        }
                      } catch (err) {
                        showCustomAlert(`导入工程文件失败: ${err}`);
                      }
                    };
                    reader.readAsText(file);
                  };
                  input.click();
                }}
                style={{ width: '220px', display: 'inline-flex', justifyContent: 'center' }}
              >
                <span>📥</span>
                <span>导入工程 JSON</span>
              </button>
              <div
                style={{
                  marginTop: '12px',
                  fontSize: '13px',
                  color: 'var(--color-text-tertiary)',
                  textAlign: 'center',
                  lineHeight: '1.5',
                }}
              >
                网页版仅为开发调整前端时使用，某些功能可能不可用
              </div>
            </>
          )}
        </div>

        {/* 最近项目 */}
        {recentProjects.length > 0 && (
          <div className="welcome-recent">
            <div className="welcome-recent-title">最近打开</div>
            <div className="welcome-recent-list">
              {recentProjects.map((item) => (
                <div
                  key={item.projectId + (item.filePath || '')}
                  className="welcome-recent-item-container"
                  style={{ position: 'relative', display: 'flex', alignItems: 'center' }}
                >
                  <button
                    className="welcome-recent-item"
                    onClick={() => handleOpenRecent(item)}
                    style={{ flex: 1, paddingRight: '48px' }}
                  >
                    <div className="welcome-recent-item-icon">📜</div>
                    <div className="welcome-recent-item-info" style={{ display: 'flex', flexDirection: 'column', width: '100%', minWidth: 0 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', width: '100%' }}>
                        <span className="welcome-recent-item-name" style={{ margin: 0 }}>{item.familyName}</span>
                        <span style={{ fontSize: '11px', color: 'var(--color-text-tertiary)', fontWeight: 'normal', flexShrink: 0 }}>
                          {formatDate(item.lastOpenedAt)}
                        </span>
                      </div>
                      <div
                        className="welcome-recent-item-date"
                        style={{
                          marginTop: '4px',
                          color: 'var(--color-text-tertiary)',
                          fontSize: '11px',
                          wordBreak: 'break-all',
                          whiteSpace: 'normal',
                          lineHeight: '1.4'
                        }}
                        title={item.filePath || '缓存保存'}
                      >
                        {item.filePath || '缓存保存'}
                      </div>
                    </div>
                  </button>
                  <div className="welcome-recent-actions">
                    <button
                      type="button"
                      className="welcome-recent-action-btn welcome-recent-remove-btn"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        showCustomConfirm(
                          `确定要从打开记录中移除家谱“${item.familyName}”吗？\n（不会删除您的磁盘物理文件夹）`,
                          () => removeRecentProject(item.projectId, item.filePath),
                          '移除打开记录'
                        );
                      }}
                      title="仅从记录中移除（保留磁盘文件）"
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="18" y1="6" x2="6" y2="18"></line>
                        <line x1="6" y1="6" x2="18" y2="18"></line>
                      </svg>
                    </button>
                    <button
                      type="button"
                      className="welcome-recent-action-btn welcome-recent-disk-delete-btn"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        handleDeleteFromDisk(item);
                      }}
                      title="从磁盘永久删除家谱文件夹"
                    >
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="3 6 5 6 21 6"></polyline>
                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                        <line x1="10" y1="11" x2="10" y2="17"></line>
                        <line x1="14" y1="11" x2="14" y2="17"></line>
                      </svg>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="welcome-version">
        <span
          onClick={() => openUrl('https://github.com/hcllmsx/yiranji')}
          style={{ cursor: 'pointer' }}
          role="link"
          title="开源仓库：hcllmsx/yiranji 点击前往"
        >
          以苒纪
        </span> v{__APP_VERSION__}
      </div>

      {/* 新建家谱模态框 */}
      {showCreateModal && (
        <div className="modal-overlay">
          <div className="modal animate-scale-in" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>新建家谱</h3>
            </div>
            <div className="modal-body">
              {/* 姓氏与家谱名称并排同行 */}
              <div style={{ display: 'flex', gap: '16px', marginBottom: '16px' }}>
                <div className="form-group" style={{ flex: '0 0 100px', marginBottom: 0 }}>
                  <label className="form-label">姓氏</label>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="如：莫"
                    value={surname}
                    onChange={(e) => setSurname(e.target.value)}
                    autoFocus
                    maxLength={4}
                  />
                </div>

                <div className="form-group" style={{ flex: 1, marginBottom: 0 }}>
                  <label className="form-label">家谱名称</label>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="请输入家谱名称，如：莫氏-以苒纪"
                    value={familyName}
                    onChange={(e) => setFamilyName(e.target.value)}
                  />
                </div>
              </div>

              {isTauri() && (
                <div className="form-group">
                  <label className="form-label">保存位置</label>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <input
                      type="text"
                      className="form-input"
                      value={selectedParentDir}
                      placeholder="请点击右侧按钮选择保存目录"
                      readOnly
                      style={{ flex: 1, background: 'var(--color-bg-input)', cursor: 'default' }}
                    />
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={async () => {
                        const dir = await selectProjectParentDir(selectedParentDir || getDefaultSaveDir() || null);
                        if (dir) setSelectedParentDir(dir);
                      }}
                      style={{ padding: '0 16px', fontSize: '18px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                      title="选择保存位置目录"
                    >
                      📂
                    </button>
                  </div>
                  {selectedParentDir && surname.trim() && (
                    <div className="form-hint" style={{ color: 'var(--color-text-secondary)', marginTop: '8px' }}>
                      将自动创建子文件夹：
                      <strong style={{ color: 'var(--color-accent)' }}>
                        ~/{familyName.trim() || `${surname.trim()}氏-以苒纪`}
                      </strong>
                    </div>
                  )}
                </div>
              )}

              <div className="form-group">
                <label className="form-label">访问密码（可选）</label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="留空则不设密码，输入字符即启用保护"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setShowCreateModal(false)}>
                取消
              </button>
              <button
                className="btn btn-primary"
                onClick={handleCreate}
                disabled={!surname.trim() || (isTauri() && !selectedParentDir)}
              >
                创建
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 解锁密码模态框 */}
      {showPasswordModal && (
        <div className="modal-overlay">
          <div className="modal animate-scale-in" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>密码解锁</h3>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label className="form-label">该工程文件已受密码保护，请输入密码：</label>
                <input
                  type="password"
                  className="form-input"
                  placeholder="访问密码"
                  value={unlockPassword}
                  onChange={(e) => setUnlockPassword(e.target.value)}
                  autoFocus
                  onKeyDown={(e) => { if (e.key === 'Enter') handleUnlockConfirm(); }}
                />
                {unlockError && (
                  <div className="form-hint" style={{ color: 'red', marginTop: '8px' }}>
                    {unlockError}
                  </div>
                )}
              </div>

            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => { setShowPasswordModal(false); setPendingOpenPath(null); }}>
                取消
              </button>
              <button className="btn btn-primary" onClick={handleUnlockConfirm}>
                确定解锁
              </button>
            </div>
          </div>
        </div>
      )}
      {/* 密码确认对话框（创建家谱时） */}
      {showPwdConfirmDialog && (
        <div className="modal-overlay" onClick={() => setShowPwdConfirmDialog(false)}>
          <div className="modal animate-scale-in" style={{ maxWidth: '420px' }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>密码确认</h3>
            </div>
            <div className="modal-body" style={{ fontSize: '14px', lineHeight: '1.8', color: 'var(--color-text-secondary)' }}>
              <p style={{ marginBottom: '12px' }}>请牢记密码，否则无法恢复！</p>
              <div style={{
                background: 'var(--color-bg-secondary, #f5f5f5)',
                border: '1px solid var(--color-border, #ddd)',
                borderRadius: '6px',
                padding: '10px 14px',
                fontFamily: 'monospace',
                fontSize: '18px',
                fontWeight: 600,
                textAlign: 'center',
                wordBreak: 'break-all',
                color: 'var(--color-text-primary)',
              }}>
                {pendingCreatePwd}
              </div>
            </div>
            <div className="modal-footer" style={{ gap: '12px' }}>
              <button className="btn btn-secondary" onClick={() => setShowPwdConfirmDialog(false)}>
                返回修改
              </button>
              <button className="btn btn-primary" onClick={() => {
                setShowPwdConfirmDialog(false);
                doCreate(surname.trim(), familyName.trim() || `${surname.trim()}氏-以苒纪`, pendingCreatePwd);
              }}>
                确认创建
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 从云端获取 / 恢复家谱模态框 */}
      {showCloudModal && (
        <div className="modal-overlay" onClick={() => !restoringDir && setShowCloudModal(false)}>
          <div
            className="modal animate-scale-in"
            style={{ maxWidth: '520px', width: '90%' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: 0 }}>从云端获取家谱</h3>
              <button
                type="button"
                className="modal-close-icon-btn"
                disabled={!!restoringDir}
                onClick={() => setShowCloudModal(false)}
                title="关闭"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10"></circle>
                  <line x1="15" y1="9" x2="9" y2="15"></line>
                  <line x1="9" y1="9" x2="15" y2="15"></line>
                </svg>
              </button>
            </div>
            <div className="modal-body" style={{ maxHeight: '420px', overflowY: 'auto' }}>
              {isCloudDisabled ? (
                <div style={{ textAlign: 'center', padding: '28px 16px', color: 'var(--color-text-secondary)' }}>
                  <div style={{ fontSize: '32px', marginBottom: '10px' }}>🔒</div>
                  <div style={{ fontSize: '15px', fontWeight: 600, color: 'var(--color-text-primary)', marginBottom: '8px' }}>
                    云同步功能当前已停用
                  </div>
                  <div style={{ fontSize: '13px', color: 'var(--color-text-tertiary)', lineHeight: '1.6', marginBottom: '20px' }}>
                    本机已保存 WebDAV 配置（{cloudSyncConfig.username}），但设置中的多设备云同步总开关处于关闭状态。
                  </div>
                  <div style={{ display: 'flex', gap: '12px', justifyContent: 'center' }}>
                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      onClick={async () => {
                        const updated = saveSyncSettings({ enabled: true });
                        setCloudSyncConfig(updated);
                        setIsCloudDisabled(false);
                        await loadCloudList(updated);
                      }}
                    >
                      立即启用并连接
                    </button>
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => {
                        setIsCloudDisabled(false);
                        setShowCloudConfig(true);
                      }}
                    >
                      检查配置
                    </button>
                  </div>
                </div>
              ) : showCloudConfig ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  <p style={{ fontSize: '13px', color: 'var(--color-text-secondary)', margin: 0 }}>
                    填写 WebDAV 云盘服务地址与应用密码，换电脑也能轻松拉取：
                  </p>
                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label className="form-label">服务地址</label>
                    <input
                      type="text"
                      className="form-input"
                      placeholder="https://dav.jianguoyun.com/dav/"
                      value={cloudSyncConfig.server}
                      onChange={(e) => setCloudSyncConfig({ ...cloudSyncConfig, server: e.target.value })}
                    />
                  </div>
                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label className="form-label">云端根目录</label>
                    <input
                      type="text"
                      className="form-input"
                      placeholder="yiranji"
                      value={cloudSyncConfig.remoteRoot}
                      onChange={(e) => setCloudSyncConfig({ ...cloudSyncConfig, remoteRoot: e.target.value })}
                    />
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                    <div className="form-group" style={{ marginBottom: 0 }}>
                      <label className="form-label">账号</label>
                      <input
                        type="text"
                        className="form-input"
                        placeholder="登录邮箱/用户名"
                        value={cloudSyncConfig.username}
                        onChange={(e) => setCloudSyncConfig({ ...cloudSyncConfig, username: e.target.value })}
                      />
                    </div>
                    <div className="form-group" style={{ marginBottom: 0 }}>
                      <label className="form-label">应用密码</label>
                      <input
                        type="password"
                        className="form-input"
                        placeholder="应用专用密码"
                        value={cloudSyncConfig.password}
                        onChange={(e) => setCloudSyncConfig({ ...cloudSyncConfig, password: e.target.value })}
                      />
                    </div>
                  </div>
                  {cloudError && (
                    <div style={{ color: 'var(--color-danger)', fontSize: '12px', marginTop: '4px' }}>
                      {cloudError}
                    </div>
                  )}
                </div>
              ) : cloudLoading ? (
                <div style={{ textAlign: 'center', padding: '36px 0', color: 'var(--color-text-secondary)' }}>
                  <span className="btn-spinner" style={{ width: '18px', height: '18px', marginRight: '8px' }} />
                  正在连接云端读取家谱列表…
                </div>
              ) : cloudError ? (
                <div style={{ textAlign: 'center', padding: '24px 0', color: 'var(--color-danger)' }}>
                  <p style={{ marginBottom: '12px' }}>读取云端家谱失败：{cloudError}</p>
                  <button className="btn btn-secondary btn-sm" onClick={() => loadCloudList()}>
                    重试
                  </button>
                </div>
              ) : cloudProjects.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '36px 0', color: 'var(--color-text-tertiary)' }}>
                  云端尚未备份过任何家谱
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  {cloudProjects.map((rp) => (
                    <div
                      key={rp.dir}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '12px 14px',
                        border: '1px solid var(--color-border-light)',
                        borderRadius: 'var(--radius-md)',
                        backgroundColor: 'var(--color-bg-secondary)',
                      }}
                    >
                      <div style={{ minWidth: 0, flex: 1, marginRight: '12px' }}>
                        <div style={{ fontSize: '14.5px', fontWeight: 600, color: 'var(--color-text-primary)' }}>
                          {rp.familyName || rp.dir}
                        </div>
                        <div style={{ fontSize: '12px', color: 'var(--color-text-tertiary)', marginTop: '4px' }}>
                          云端版本：{formatSyncTime(rp.projectUpdatedAt || rp.updatedAt)} · 来自 {rp.device || '未知设备'}
                        </div>
                      </div>
                      <button
                        type="button"
                        className="btn btn-primary btn-sm"
                        disabled={!!restoringDir}
                        onClick={() => handleRestoreProject(rp)}
                      >
                        {restoringDir === rp.dir ? '正在拉取…' : '拉取到本机'}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="modal-footer" style={showCloudConfig ? { gap: '12px' } : { justifyContent: 'center' }}>
              {showCloudConfig ? (
                <>
                  {isSyncConfigured(getSyncSettings()) && (
                    <button
                      className="btn btn-secondary"
                      onClick={() => {
                        setShowCloudConfig(false);
                        const curSync = getSyncSettings();
                        if (!curSync.enabled) {
                          setIsCloudDisabled(true);
                        }
                      }}
                    >
                      返回
                    </button>
                  )}
                  <button className="btn btn-primary" onClick={handleSaveCloudConfig}>
                    保存并连接云端
                  </button>
                </>
              ) : !isCloudDisabled ? (
                <button
                  type="button"
                  className="welcome-cloud-text-btn"
                  onClick={() => { setShowCloudConfig(true); setCloudError(''); }}
                >
                  <span>⚙️</span>
                  <span>WebDAV 设置</span>
                </button>
              ) : null}
            </div>
          </div>
        </div>
      )}

      {/* 自定义对话框 (Alert / Confirm) */}
      {dialog.show && (
        <div className="modal-overlay">
          <div className="modal animate-scale-in" style={{ maxWidth: '400px' }}>
            <div className="modal-header">
              <h3>{dialog.title}</h3>
            </div>
            <div className="modal-body" style={{ fontSize: '14px', lineHeight: '1.6', color: 'var(--color-text-secondary)', wordBreak: 'break-all', whiteSpace: 'pre-wrap' }}>
              {dialog.message}
            </div>
            <div className="modal-footer" style={{ gap: '12px' }}>
              {dialog.type === 'confirm' && (
                <button className="btn btn-secondary" onClick={dialog.onCancel}>
                  取消
                </button>
              )}
              <button className="btn btn-primary" onClick={dialog.onConfirm}>
                确定
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
