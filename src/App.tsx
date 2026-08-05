import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import WelcomePage from './pages/WelcomePage';
import MainLayout from './components/MainLayout';
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
  return (
    <BrowserRouter>
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
