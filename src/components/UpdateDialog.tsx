import { useEffect, useState } from 'react';
import { openUrl } from '../utils/tauri';
import { RELEASES_URL, fetchReleaseNotes, type ReleaseNotes } from '../utils/updateChecker';
import { useUpdateStore } from '../store/updateStore';
import ReleaseNotesView from './ReleaseNotesView';
import './UpdateDialog.css';

// 以苒纪 — 发现新版本弹窗
//
// 挂载于 App 根层，由 updateStore 控制显隐；
// 打开后展示与该 Release tag 同源的更新内容（来自发布正文），
// 拉取失败时回退为通用说明，不阻塞更新提示。

export default function UpdateDialog() {
  const { open, latestVersion, closeUpdateDialog } = useUpdateStore();
  const [notes, setNotes] = useState<ReleaseNotes | null>(null);
  const [notesLoading, setNotesLoading] = useState(false);

  useEffect(() => {
    if (!open) return;

    let cancelled = false;
    setNotes(null);
    setNotesLoading(true);

    fetchReleaseNotes(latestVersion)
      .then((result) => {
        if (cancelled) return;
        setNotes(result);
        setNotesLoading(false);
      })
      .catch(() => {
        if (!cancelled) setNotesLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, latestVersion]);

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
        {notesLoading ? (
          <p className="update-desc">正在获取更新内容…</p>
        ) : notes ? (
          <ReleaseNotesView sections={notes.sections} />
        ) : (
          <p className="update-desc">
            新版本包含功能改进与问题修复，建议前往 GitHub Releases 页面查看更新说明，并按页面指引下载最新版。
          </p>
        )}
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
