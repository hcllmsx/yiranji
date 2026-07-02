import { useMediaProgressStore } from '../store/mediaProgressStore';
import './MediaImportProgress.css';

const fileTypeLabel: Record<string, string> = {
  photo: '照片',
  audio: '音频',
  video: '视频',
  avatar: '头像',
};

const fileTypeIcon: Record<string, string> = {
  photo: '🖼️',
  audio: '🎵',
  video: '🎬',
  avatar: '📷',
};

export default function MediaImportProgress() {
  const { tasks, isPanelVisible, clearFinished, hidePanel } = useMediaProgressStore();

  if (!isPanelVisible || tasks.length === 0) return null;

  const activeCount = tasks.filter((t) => t.status === 'processing').length;
  const doneCount = tasks.filter((t) => t.status === 'done').length;
  const errorCount = tasks.filter((t) => t.status === 'error').length;

  return (
    <div className="media-progress-panel">
      <div className="media-progress-header">
        <div className="media-progress-title">
          <span className="media-progress-spinner" />
          <span>
            {activeCount > 0
              ? `正在导入 ${activeCount} 个文件`
              : errorCount > 0
              ? `${errorCount} 个文件导入失败`
              : `${doneCount} 个文件已导入`}
          </span>
        </div>
        <div className="media-progress-actions">
          <button
            type="button"
            className="media-progress-clear-btn"
            onClick={clearFinished}
            title="清除已完成"
          >
            清除
          </button>
          <button
            type="button"
            className="media-progress-close-btn"
            onClick={hidePanel}
            title="隐藏"
          >
            ×
          </button>
        </div>
      </div>

      <div className="media-progress-list">
        {tasks.map((task) => (
          <div key={task.id} className={`media-progress-item ${task.status}`}>
            <div className="media-progress-item-icon">
              {task.status === 'done' ? '✓' : task.status === 'error' ? '⚠' : fileTypeIcon[task.fileType]}
            </div>
            <div className="media-progress-item-body">
              <div className="media-progress-item-name" title={task.fileName}>
                {task.fileName}
              </div>
              <div className="media-progress-item-meta">
                {task.status === 'processing' && `${task.progress}% · ${fileTypeLabel[task.fileType]}`}
                {task.status === 'done' && `已保存 · ${fileTypeLabel[task.fileType]}`}
                {task.status === 'error' && (task.errorMessage || '导入失败')}
              </div>
              <div className="media-progress-bar-track">
                <div
                  className={`media-progress-bar-fill ${task.status}`}
                  style={{ width: `${task.status === 'done' ? 100 : task.progress}%` }}
                />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
