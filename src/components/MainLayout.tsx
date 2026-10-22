import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { useState, useEffect, useRef, useCallback } from 'react';
import { useFamilyStore } from '../store/familyStore';
import { isTauri, openUrl } from '../utils/tauri';
import { formatSyncTime, getSyncSettings } from '../utils/cloudSync';
import type { RemoteSyncMeta } from '../utils/tauri';
import { exportTreeImage, type RenderScale } from '../utils/imageExport';
import { exportTreeGraphHtml } from '../utils/htmlGraphExport';
import { waitTreeCanvasReady } from '../utils/exportUtils';
import MediaImportProgress from './MediaImportProgress';
import SaveAsDialog, { type NotifyFn } from './SaveAsDialog';
import DataMigrationDialog from './DataMigrationDialog';
import './MainLayout.css';

/** 问题反馈表单地址 */
const FEEDBACK_URL = 'https://docs.qq.com/form/page/DRHJ3bmd6Q3RqaENT';

export default function MainLayout() {
  const {
    project,
    currentFilePath,
    saveCurrentProject,
    saveProjectAs,
    closeProject,
    checkRemoteUpdate,
    syncPullFromCloud,
  } = useFamilyStore();
  const navigate = useNavigate();

  // 云端有更新时的顶部提示条
  const [remoteBanner, setRemoteBanner] = useState<RemoteSyncMeta | null>(null);
  const [pulling, setPulling] = useState(false);

  // 另存为弹窗与结果通知（toast）
  const [saveAsOpen, setSaveAsOpen] = useState(false);
  const [toast, setToast] = useState<{ text: string; type: 'success' | 'error' | 'info' } | null>(null);
  const toastTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (toast) {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
      toastTimerRef.current = window.setTimeout(() => setToast(null), 6000);
    }
    return () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    };
  }, [toast]);

  const notify: NotifyFn = (text, type) => {
    setToast({ text, type });
  };

  const familyName = project?.meta.familyName || '家谱';

  // 进入档案时检查云端是否有更新（仅开启云同步时执行，失败静默）
  useEffect(() => {
    let cancelled = false;
    setRemoteBanner(null);
    if (!project?.meta.syncKey || !currentFilePath) return;
    const settings = getSyncSettings();
    if (!settings.enabled || !settings.autoCheck) return;
    (async () => {
      try {
        const meta = await checkRemoteUpdate();
        if (!cancelled && meta) setRemoteBanner(meta);
      } catch {
        // 忽略：离线或服务不可用时不打扰
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.meta.syncKey, currentFilePath]);

  const handlePullFromBanner = async () => {
    setPulling(true);
    try {
      const report = await syncPullFromCloud();
      setRemoteBanner(null);
      setToast({
        text: `已同步云端更新：新增媒体 ${report.downloadedMedia} 个${report.backupPath ? '，原档案已备份' : ''}`,
        type: 'success',
      });
    } catch (err: any) {
      setToast({ text: `拉取失败：${err?.message || err}`, type: 'error' });
    } finally {
      setPulling(false);
    }
  };

  // 若当前不在家谱树页面，先切换过去并等待画布挂载完成
  const ensureTreeCanvas = useCallback(async () => {
    if (!document.querySelector('.react-flow__viewport')) {
      navigate('/tree');
    }
    await waitTreeCanvasReady();
  }, [navigate]);

  const handleExportImage = useCallback(
    async (format: 'jpg' | 'png', renderScale: RenderScale) => {
      await ensureTreeCanvas();
      return exportTreeImage(format, renderScale, `${familyName}-家谱图.${format}`);
    },
    [ensureTreeCanvas, familyName]
  );

  // HTML 图谱导出不依赖页面 DOM（自己算布局），因此无需先切到家谱树
  const handleExportHtml = useCallback(async () => {
    return exportTreeGraphHtml(`${familyName}-家谱图.html`, `${familyName} · 家谱图`);
  }, [familyName]);

  if (!project) {
    navigate('/');
    return null;
  }

  const handleSave = async () => {
    try {
      if (isTauri() && !currentFilePath) {
        const ok = await saveProjectAs();
        if (ok) {
          notify('档案已成功保存！', 'success');
        }
      } else {
        await saveCurrentProject();
        notify('档案已成功保存！', 'success');
      }
    } catch (err) {
      console.error('保存档案失败:', err);
      notify(`保存档案失败：${(err as Error)?.message || '未知错误'}`, 'error');
    }
  };

  const handleSaveAs = () => {
    setSaveAsOpen(true);
  };

  const handleClose = () => {
    closeProject();
    navigate('/');
  };

  return (
    <div className="main-layout">
      {/* 侧边栏 */}
      <aside className="sidebar">
        <div className="sidebar-header">
          <div className="sidebar-app-name">以苒纪</div>
          <div className="sidebar-family-name">{project.meta.familyName}</div>
        </div>

        <nav className="sidebar-nav">
          <NavLink
            to="/tree"
            className={({ isActive }) =>
              `sidebar-nav-item ${isActive ? 'active' : ''}`
            }
          >
            <span className="nav-icon">🌳</span>
            <span>家谱树</span>
          </NavLink>

          <NavLink
            to="/persons"
            className={({ isActive }) =>
              `sidebar-nav-item ${isActive ? 'active' : ''}`
            }
          >
            <span className="nav-icon">👤</span>
            <span>人员列表</span>
          </NavLink>

          <NavLink
            to="/settings"
            className={({ isActive }) =>
              `sidebar-nav-item ${isActive ? 'active' : ''}`
            }
          >
            <span className="nav-icon">⚙️</span>
            <span>家谱设置</span>
          </NavLink>

          <hr className="divider" style={{ margin: '8px 12px' }} />

          <button className="sidebar-nav-item" onClick={handleSave}>
            <span className="nav-icon">💾</span>
            <span>保存档案</span>
          </button>

          {/* 另存为：桌面版弹原生保存对话框，网页版直接下载文件 */}
          <button className="sidebar-nav-item" onClick={handleSaveAs}>
            <span className="nav-icon">📤</span>
            <span>另存为...</span>
          </button>

          <button className="sidebar-nav-item" onClick={handleClose}>
            <span className="nav-icon">🏠</span>
            <span>返回首页</span>
          </button>
        </nav>

        {/* 侧边栏底部 */}
        <div className="sidebar-footer">
          <span
            className="sidebar-feedback-link"
            onClick={() => openUrl(FEEDBACK_URL)}
            style={{ cursor: 'pointer' }}
            role="link"
            title="问题反馈"
          >
            <img src="/feedback.svg" alt="问题反馈" className="sidebar-feedback-icon" />
          </span>
          <span
            className="sidebar-github-link"
            onClick={() => openUrl('https://github.com/hcllmsx/yiranji')}
            style={{ cursor: 'pointer' }}
            role="link"
          >
            <img src="/github.svg" alt="GitHub" className="sidebar-github-icon" />
          </span>
        </div>
      </aside>

      {/* 主内容区 */}
      <main className="main-content">
        {remoteBanner && (
          <div className="sync-banner">
            <span className="sync-banner-icon">☁️</span>
            <div className="sync-banner-text">
              云端有更新的版本（{formatSyncTime(remoteBanner.updatedAt)} 来自 {remoteBanner.device}）
            </div>
            <button
              className="btn btn-primary btn-sm"
              onClick={handlePullFromBanner}
              disabled={pulling}
            >
              {pulling ? '⏳ 拉取中…' : '立即拉取'}
            </button>
            <button
              className="sync-banner-close"
              onClick={() => setRemoteBanner(null)}
              aria-label="关闭"
            >
              ✕
            </button>
          </div>
        )}
        <Outlet />
      </main>

      {/* 媒体文件导入进度浮层 */}
      <MediaImportProgress />

      {/* 旧版档案升级提示（断过关系才会弹） */}
      <DataMigrationDialog />

      {/* 另存为格式选择弹窗 */}
      <SaveAsDialog
        open={saveAsOpen}
        familyName={familyName}
        onClose={() => setSaveAsOpen(false)}
        onExportYrj={saveProjectAs}
        onExportImage={handleExportImage}
        onExportHtml={handleExportHtml}
        notify={notify}
      />

      {/* 导出结果 Toast 通知 */}
      {toast && (
        <div
          className={`saveas-toast ${toast.type}`}
          onClick={() => setToast(null)}
        >
          <span className="saveas-toast-icon">
            {toast.type === 'success' ? '✓' : toast.type === 'error' ? '✕' : 'ℹ'}
          </span>
          <span className="saveas-toast-text">{toast.text}</span>
          <button className="saveas-toast-close" aria-label="关闭">✕</button>
        </div>
      )}
    </div>
  );
}
