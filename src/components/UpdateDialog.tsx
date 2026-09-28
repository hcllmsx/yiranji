import { openUrl } from '../utils/tauri';
import { RELEASES_URL } from '../utils/updateChecker';
import { useUpdateStore } from '../store/updateStore';
import './UpdateDialog.css';

// 以苒纪 — 发现新版本弹窗
//
// 挂载于 App 根层，由 updateStore 控制显隐；
// 引导用户前往 GitHub Releases 页面下载最新版。

export default function UpdateDialog() {
  const { open, latestVersion, closeUpdateDialog } = useUpdateStore();

  if (!open) return null;

  const handleDownload = () => {
    openUrl(RELEASES_URL);
    closeUpdateDialog();
  };

  return (
    <div className="update-overlay" onClick={closeUpdateDialog}>
      <div className="update-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="update-icon">🎉</div>
        <div className="update-title">发现新版本</div>
        <div className="update-version-row">
          <span className="update-version-new">v{latestVersion}</span>
          <span className="update-version-arrow">→</span>
          <span className="update-version-old">当前 v{__APP_VERSION__}</span>
        </div>
        <p className="update-desc">
          新版本包含功能改进与问题修复，建议前往 GitHub Releases 页面下载最新版安装包。
        </p>
        <div className="update-buttons">
          <button type="button" className="btn btn-secondary btn-sm" onClick={closeUpdateDialog}>
            下次再说
          </button>
          <button type="button" className="btn btn-primary btn-sm" onClick={handleDownload}>
            🚀 前往下载
          </button>
        </div>
      </div>
    </div>
  );
}
