import { lazy, Suspense, useEffect, useRef } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import WelcomePage from './pages/WelcomePage';
import MainLayout from './components/MainLayout';
import UpdateDialog from './components/UpdateDialog';
import WhatsNewDialog from './components/WhatsNewDialog';
import MajorUpdateNotice from './components/MajorUpdateNotice';
import { checkForUpdate } from './utils/updateChecker';
import { getStartupReleaseNotes } from './utils/whatsNew';
import { useUpdateStore } from './store/updateStore';
import { initAppSettings } from './utils/appSettings';
import './index.css';

// 页面级代码分割：各页面按需加载，减小首屏 bundle 体积
const TreePage = lazy(() => import('./pages/TreePage'));
const PersonsPage = lazy(() => import('./pages/PersonsPage'));
const PersonEditPage = lazy(() => import('./pages/PersonEditPage'));
const PersonDetailPage = lazy(() => import('./pages/PersonDetailPage'));
const SettingsPage = lazy(() => import('./pages/SettingsPage'));

// 路由级 loading 占位：chunk 加载期间展示，避免白屏
function RouteLoading() {
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      height: '100%',
      minHeight: '60vh',
      color: 'var(--color-text-tertiary, #9ca3af)',
      fontSize: '14px',
      gap: '8px',
    }}>
      <span className="route-loading-spinner" />
      <span>加载中…</span>
    </div>
  );
}

function App() {
  // 启动静默检查更新 + 升级后首次启动展示本次更新内容
  const didSilentCheckRef = useRef(false);
  useEffect(() => {
    if (didSilentCheckRef.current) return;
    didSilentCheckRef.current = true;

    // 设置从磁盘加载完成后再判断版本变化，避免读到旧缓存
    initAppSettings()
      .then(() => {
        const notes = getStartupReleaseNotes();
        if (notes) {
          useUpdateStore.getState().openWhatsNew(notes);
        }
      })
      .catch(() => {
        // 设置读取失败时跳过本次更新说明，不影响启动
      });

    // 发现新版本弹窗优先；若「本次更新内容」还开着，由 store 排队稍后弹出
    checkForUpdate()
      .then((result) => {
        if (result.status === 'update-available' && result.latestVersion) {
          useUpdateStore.getState().openUpdateDialog(result.latestVersion, result.sourceIndex);
        }
      })
      .catch(() => {
        // 静默检查失败不提示
      });
  }, []);

  return (
    <BrowserRouter>
      <UpdateDialog />
      <WhatsNewDialog />
      <MajorUpdateNotice />
      <Routes>
        <Route path="/" element={<WelcomePage />} />
        <Route element={<MainLayout />}>
          <Route
            path="/tree"
            element={
              <Suspense fallback={<RouteLoading />}>
                <TreePage />
              </Suspense>
            }
          />
          <Route
            path="/persons"
            element={
              <Suspense fallback={<RouteLoading />}>
                <PersonsPage />
              </Suspense>
            }
          />
          <Route
            path="/person/:id/edit"
            element={
              <Suspense fallback={<RouteLoading />}>
                <PersonEditPage />
              </Suspense>
            }
          />
          <Route
            path="/person/:id"
            element={
              <Suspense fallback={<RouteLoading />}>
                <PersonDetailPage />
              </Suspense>
            }
          />
          <Route
            path="/settings"
            element={
              <Suspense fallback={<RouteLoading />}>
                <SettingsPage />
              </Suspense>
            }
          />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

export default App;
