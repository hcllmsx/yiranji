import { useState } from 'react';
import { useFamilyStore } from '../store/familyStore';
import { openDevtools, isTauri, selectFilePathForSaveZip, writeBinaryFile, getAppLogs } from '../utils/tauri';
import { createAnonymizedExport } from '../utils';
import './SettingsPage.css';

export default function SettingsPage() {
  const { project, updateMeta, changeProjectPassword, isAnonymized, toggleAnonymization } = useFamilyStore();

  const [familyName, setFamilyName] = useState(project?.meta.familyName || '');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPasswordSection, setShowPasswordSection] = useState(false);
  const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);
  const [isExporting, setIsExporting] = useState(false);

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

  const handleExportAnonymized = async () => {
    if (!project || isExporting) return;
    setIsExporting(true);
    setMessage(null);

    try {
      // 生成脱敏数据
      const anonProject = createAnonymizedExport(project);
      const familyName = project.meta.familyName || '家谱';
      const exportFolderName = familyName + '_脱敏数据';

      // 动态加载 JSZip
      const JSZip = (await import('jszip')).default;
      const zip = new JSZip();
      const folder = zip.folder(exportFolderName);

      if (folder) {
        // 放入脱敏后的 project.json
        folder.file('project.json', JSON.stringify(anonProject, null, 2));

        // 尝试收集运行日志
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

      // 生成 ZIP 数据
      const zipBlob = await zip.generateAsync({ type: 'blob' });

      if (isTauri()) {
        // Tauri 桌面端：弹出保存对话框
        const savePath = await selectFilePathForSaveZip(`${familyName}_脱敏数据.zip`);
        if (!savePath) {
          setIsExporting(false);
          return;
        }
        // 将 Blob 转为 Base64 后写入文件
        const arrayBuffer = await zipBlob.arrayBuffer();
        const bytes = new Uint8Array(arrayBuffer);
        let binary = '';
        for (let i = 0; i < bytes.length; i++) {
          binary += String.fromCharCode(bytes[i]);
        }
        const base64 = btoa(binary);
        await writeBinaryFile(savePath, base64);
        setMessage({ text: `脱敏数据已成功导出至：${savePath}`, type: 'success' });
      } else {
        // Web 端：触发下载
        const url = URL.createObjectURL(zipBlob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${familyName}_脱敏数据.zip`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        setMessage({ text: '脱敏数据已成功导出下载', type: 'success' });
      }
    } catch (err: any) {
      console.error('导出脱敏数据失败:', err);
      setMessage({ text: `导出失败：${err?.message || '未知错误'}`, type: 'error' });
    } finally {
      setIsExporting(false);
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
              <p className="dev-tool-desc">将所有人物姓名临时替换为数字编号，仅供截图反馈使用，不修改底层数据。</p>
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
