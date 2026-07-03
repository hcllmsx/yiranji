import { useState } from 'react';
import { useFamilyStore } from '../store/familyStore';
import { openDevtools } from '../utils/tauri';
import './SettingsPage.css';

export default function SettingsPage() {
  const { project, updateMeta, changeProjectPassword } = useFamilyStore();

  const [familyName, setFamilyName] = useState(project?.meta.familyName || '');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPasswordSection, setShowPasswordSection] = useState(false);
  const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  if (!project) return null;

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage(null);

    const trimmedName = familyName.trim();
    if (!trimmedName) {
      setMessage({ text: '家谱名称不能为空', type: 'error' });
      return;
    }

    // 1. 如果展开了密码设置区域，进行密码相关校验
    if (showPasswordSection) {
      if (newPassword !== confirmPassword) {
        setMessage({ text: '两次输入的密码不一致', type: 'error' });
        return;
      }
      if (newPassword && newPassword.length < 4) {
        setMessage({ text: '密码长度不能少于 4 位', type: 'error' });
        return;
      }
    }

    try {
      // 2. 修改家谱名称
      if (trimmedName !== project.meta.familyName) {
        updateMeta({ familyName: trimmedName });
      }

      // 3. 修改密码逻辑
      if (showPasswordSection) {
        // 如果填了新密码，则修改；如果为空，则表示清除密码
        if (newPassword) {
          await changeProjectPassword(newPassword);
        } else {
          // 清除密码
          await changeProjectPassword(null);
        }
      }

      setMessage({ text: '保存设置成功！已自动更新当前工作区，将在您下次点击侧边栏“保存”或关闭项目时打包落盘。', type: 'success' });
      setNewPassword('');
      setConfirmPassword('');
      setShowPasswordSection(false);
    } catch (err) {
      console.error(err);
      setMessage({ text: '保存失败，请重试', type: 'error' });
    }
  };

  const handleRemovePassword = async () => {
    if (window.confirm ? window.confirm('确认要取消此家谱的密码保护吗？取消后，任何人都可以直接打开此家谱。') : true) {
      try {
        await changeProjectPassword(null);
        setMessage({ text: '成功取消密码保护！', type: 'success' });
        setShowPasswordSection(false);
      } catch (err) {
        setMessage({ text: '取消密码失败', type: 'error' });
      }
    }
  };

  return (
    <div className="settings-page">
      <div className="settings-header">
        <h2>⚙️ 家谱设置</h2>
      </div>

      <form onSubmit={handleSave} className="settings-form">
        {/* 基本设置分区 */}
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

        {/* 安全设置分区 */}
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
                <button
                  type="button"
                  className="btn btn-sm btn-ghost danger-text-hover"
                  onClick={handleRemovePassword}
                  style={{ marginLeft: 'auto' }}
                >
                  取消密码保护
                </button>
              </div>
            ) : (
              <div className="status-container clear">
                <span className="status-icon">🔓</span>
                <div className="status-text">
                  <strong>未启用密码保护</strong>
                  <p>当前家谱文件未设置密码，打开时无需进行身份验证。</p>
                </div>
              </div>
            )}
          </div>

          {!showPasswordSection ? (
            <button
              type="button"
              className="btn btn-sm btn-ghost"
              style={{ marginTop: '12px' }}
              onClick={() => setShowPasswordSection(true)}
            >
              🔑 {project.meta.hasPassword ? '修改加密密码' : '设置加密密码'}
            </button>
          ) : (
            <div className="password-inputs-area" style={{ marginTop: '16px', padding: '16px', background: 'var(--color-bg-input)', borderRadius: 'var(--radius-md)' }}>
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
              <div className="form-group" style={{ marginTop: '12px' }}>
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
              <div style={{ display: 'flex', gap: '8px', marginTop: '16px' }}>
                <button
                  type="button"
                  className="btn btn-sm btn-ghost"
                  onClick={() => {
                    setShowPasswordSection(false);
                    setNewPassword('');
                    setConfirmPassword('');
                  }}
                >
                  取消修改
                </button>
              </div>
            </div>
          )}
        </div>

        {/* 提示信息 */}
        {message && (
          <div className={`settings-alert-message ${message.type}`}>
            {message.text}
          </div>
        )}

        {/* 开发者分区 */}
        <div className="settings-section">
          <div className="settings-section-title">开发者</div>
          <div className="form-group">
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => openDevtools()}
            >
              🛠️ DevTools
            </button>
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
