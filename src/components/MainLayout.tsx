import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { useFamilyStore } from '../store/familyStore';
import { isTauri, openUrl } from '../utils/tauri';
import MediaImportProgress from './MediaImportProgress';
import './MainLayout.css';

export default function MainLayout() {
  const {
    project,
    currentFilePath,
    saveCurrentProject,
    saveProjectAs,
    closeProject,
  } = useFamilyStore();
  const navigate = useNavigate();

  if (!project) {
    navigate('/');
    return null;
  }

  const handleSave = async () => {
    if (isTauri() && !currentFilePath) {
      await saveProjectAs();
    } else {
      await saveCurrentProject();
    }
  };

  const handleSaveAs = async () => {
    await saveProjectAs();
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
            <span>保存</span>
          </button>

          {isTauri() && (
            <button className="sidebar-nav-item" onClick={handleSaveAs}>
              <span className="nav-icon">📤</span>
              <span>另存为...</span>
            </button>
          )}

          <button className="sidebar-nav-item" onClick={handleClose}>
            <span className="nav-icon">🏠</span>
            <span>返回首页</span>
          </button>
        </nav>

        {/* 侧边栏底部 */}
        <div className="sidebar-footer">
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
        <Outlet />
      </main>

      {/* 媒体文件导入进度浮层 */}
      <MediaImportProgress />
    </div>
  );
}
