import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useFamilyStore } from '../store/familyStore';
import {
  isTauri,
  selectFilePathForOpen,
  isYrjFileEncrypted,
  selectProjectParentDir,
  createProjectWorkspace,
  openUrl,
} from '../utils/tauri';
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
  } = useFamilyStore();

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [surname, setSurname] = useState('');
  const [familyName, setFamilyName] = useState('');
  const [password, setPassword] = useState('');
  const [selectedParentDir, setSelectedParentDir] = useState('');

  // 密码解锁相关
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [pendingOpenPath, setPendingOpenPath] = useState<string | null>(null);
  const [unlockPassword, setUnlockPassword] = useState('');
  const [unlockError, setUnlockError] = useState('');

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

  const showCustomAlert = (message: string, title = '提示') => {
    setDialog({
      show: true,
      type: 'alert',
      title,
      message,
      onConfirm: () => setDialog(prev => ({ ...prev, show: false }))
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

    let workspacePath: string | undefined = undefined;
    if (isTauri()) {
      if (!selectedParentDir) {
        showCustomAlert("请选择家谱保存位置目录！");
        return;
      }
      const trimmedPassword = password.trim();
      if (trimmedPassword && trimmedPassword.length < 4) {
        showCustomAlert("设置的加密密码不能少于 4 位！");
        return;
      }
      try {
        workspacePath = await createProjectWorkspace(selectedParentDir, finalFamilyName);
      } catch (e) {
        showCustomAlert(`创建家谱文件夹失败: ${e}`);
        return;
      }
    } else {
      // Web 环境下的密码检验
      const trimmedPassword = password.trim();
      if (trimmedPassword && trimmedPassword.length < 4) {
        showCustomAlert("设置的加密密码不能少于 4 位！");
        return;
      }
    }

    const projectId = await createProject(
      surname.trim(),
      password.trim() ? password.trim() : undefined,
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
      const path = await selectProjectParentDir();
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

          {isTauri() && (
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
                <span>打开文件</span>
              </button>
            </>
          )}
          {!isTauri() && (
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
                    style={{ flex: 1, paddingRight: '40px' }}
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
                  <button
                    className="welcome-recent-delete-btn"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      showCustomConfirm(
                        `确定要从历史记录中删除家谱“${item.familyName}”吗？（这不会删除您的磁盘物理文件夹）`,
                        () => removeRecentProject(item.projectId, item.filePath)
                      );
                    }}
                    style={{
                      position: 'absolute',
                      right: '12px',
                      background: 'none',
                      border: 'none',
                      color: 'var(--color-text-tertiary)',
                      cursor: 'pointer',
                      fontSize: '14px',
                      padding: '4px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      zIndex: 2,
                    }}
                    title="从历史记录中移除"
                  >
                    ❌
                  </button>
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
                        const dir = await selectProjectParentDir();
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
                  type="password"
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
      {/* 自定义对话框 (Alert / Confirm) */}
      {dialog.show && (
        <div className="modal-overlay">
          <div className="modal animate-scale-in" style={{ maxWidth: '400px' }}>
            <div className="modal-header">
              <h3>{dialog.title}</h3>
            </div>
            <div className="modal-body" style={{ fontSize: '14px', lineHeight: '1.6', color: 'var(--color-text-secondary)', wordBreak: 'break-all' }}>
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
