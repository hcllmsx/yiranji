import { useEffect, useState } from 'react';
import {
  useProjectLoadingStore,
  PROJECT_LOAD_STAGE_LABEL,
} from '../store/projectLoadingStore';
import './ProjectLoadingOverlay.css';

function baseName(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, '');
  const parts = trimmed.split(/[\\/]/);
  return parts[parts.length - 1] || trimmed;
}

/** 打开档案时的全屏载入画面：解包 .yrj、读取数据期间避免界面看起来像卡死 */
export default function ProjectLoadingOverlay() {
  const visible = useProjectLoadingStore((state) => state.visible);
  const stage = useProjectLoadingStore((state) => state.stage);
  const detail = useProjectLoadingStore((state) => state.detail);
  const startedAt = useProjectLoadingStore((state) => state.startedAt);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!visible) {
      setElapsed(0);
      return;
    }
    const tick = () => setElapsed(Math.max(0, Math.floor((Date.now() - startedAt) / 1000)));
    tick();
    const timer = window.setInterval(tick, 500);
    return () => window.clearInterval(timer);
  }, [visible, startedAt]);

  if (!visible) return null;

  return (
    <div
      className="project-loading"
      role="status"
      aria-live="polite"
      aria-label={PROJECT_LOAD_STAGE_LABEL[stage]}
    >
      <div className="project-loading-inner">
        <div className="project-loading-emblem" aria-hidden="true">
          <img src="/yiranji-logo-512px.png" alt="" className="project-loading-logo" draggable={false} />
        </div>

        <div className="project-loading-app">以苒纪</div>
        <h2 className="project-loading-title">正在载入家谱档案</h2>

        {detail && (
          <p className="project-loading-file" title={detail}>
            {baseName(detail)}
          </p>
        )}

        <div className="project-loading-stage-line">
          <span className="route-loading-spinner" aria-hidden="true" />
          <span className="project-loading-stage">{PROJECT_LOAD_STAGE_LABEL[stage]}</span>
        </div>

        <div className="project-loading-track" aria-hidden="true">
          <span className="project-loading-bar" />
        </div>

        <p className="project-loading-hint">
          已用 {elapsed} 秒 · 档案包含较多照片、音频时，载入会需要一些时间，请稍候
        </p>
      </div>
    </div>
  );
}
