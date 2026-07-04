import { useState, useEffect, useRef } from 'react';
import { useFamilyStore } from '../store/familyStore';
import { openDevtools, isTauri, selectFilePathForSaveZip, writeBinaryFile, getAppLogs } from '../utils/tauri';
import { createAnonymizedExport, sha256 } from '../utils';
import './SettingsPage.css';

export default function SettingsPage() {
  const { project, updateMeta, changeProjectPassword, isAnonymized, toggleAnonymization } = useFamilyStore();

  const [familyName, setFamilyName] = useState(project?.meta.familyName || '');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPasswordSection, setShowPasswordSection] = useState(false);
  const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);
  const [isExporting, setIsExporting] = useState(false);

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

  // -------------------- 自定义对话框 --------------------
  interface DialogState {
    show: boolean;
    title: string;
    message: string;
    requirePassword?: boolean;
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
              <button className="btn btn-danger btn-sm" onClick={handleDialogConfirm}>
                确认取消
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ---- 页面主体 ---- */}
      <div className="settings-header">
        <h2>⚙️ 家谱设置</h2>
      </div>

      <form onSubmit={handleSave} className="settings-form">
        {/* 基本信息 */}
        <div className="settings-section">
          <div className="settings-section-title">基本信息</div>
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
        </div>

        {/* 安全与密码 */}
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

        {/* 内联错误提示 —— 仅保留给校验错误；成功类提示已由 Toast 接管 */}
        {message && (
          <div className={`settings-alert-message ${message.type}`}>
            {message.text}
          </div>
        )}

        {/* 开发者 */}
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
              <p className="dev-tool-label">数据脱敏 · 临时匿名化</p>
              <p className="dev-tool-desc">将所有人员姓名临时替换为数字编号，仅供截图反馈使用，不修改底层数据。</p>
              <button
                type="button"
                className={`btn btn-sm ${isAnonymized ? 'btn-warning' : 'btn-secondary'}`}
                onClick={() => toggleAnonymization()}
                title={isAnonymized ? '点击恢复原始姓名' : '点击临时匿名化所有姓名'}
              >
                {isAnonymized ? '🔓 取消匿名化' : '🔒 临时匿名化姓名'}
              </button>
            </div>
            <div className="dev-tool-item">
              <p className="dev-tool-label">数据脱敏 · 导出ZIP</p>
              <p className="dev-tool-desc">导出脱敏ZIP压缩包，不含媒体文件，仅包含匿名姓名、性别及生卒年月信息，并附带运行日志（如有）。</p>
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

        {/* 底部提交 */}
        <div className="settings-footer">
          <button type="submit" className="btn btn-primary" style={{ padding: '10px 24px' }}>
            💾 保存设置
          </button>
        </div>
      </form>
    </div>
  );
}
