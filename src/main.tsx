import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

// 生产环境下屏蔽 WebView 默认右键菜单（避免出现浏览器风格的上下文菜单）
// 开发环境保留右键菜单，方便调试
if (!import.meta.env.DEV) {
  window.addEventListener('contextmenu', (e) => {
    e.preventDefault();
  });
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
