import { useUpdateStore } from '../store/updateStore';
import ReleaseNotesView from './ReleaseNotesView';
import './UpdateDialog.css';

// 以苒纪 — 本次更新内容弹窗
//
// 升级后首次启动展示当前版本的更新说明，内容随安装包内置，离线可用；
// 与「发现新版本」弹窗互斥，由 updateStore 统一调度。

export default function WhatsNewDialog() {
  const { whatsNewNotes, closeWhatsNew } = useUpdateStore();

  if (!whatsNewNotes) return null;

  return (
    <div className="update-overlay" onClick={closeWhatsNew}>
      <div className="update-dialog whats-new-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="update-title">本次更新内容</div>
        <div className="update-version-row">
          <span className="update-version-new">v{whatsNewNotes.version}</span>
        </div>
        <ReleaseNotesView sections={whatsNewNotes.sections} />
        <div className="update-buttons">
          <button type="button" className="btn btn-primary btn-sm" onClick={closeWhatsNew}>
            知道了
          </button>
        </div>
      </div>
    </div>
  );
}
