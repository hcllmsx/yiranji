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

// 全局禁用 WebView / Chromium 默认的表单历史记录与自动填充弹窗（如“保存的信息”）
const disableAutofill = (el: Element) => {
  if (el.tagName === 'INPUT') {
    const input = el as HTMLInputElement;
    const type = (input.type || 'text').toLowerCase();
    if (!['checkbox', 'radio', 'file', 'button', 'submit', 'reset', 'range', 'color'].includes(type)) {
      if (!input.getAttribute('autocomplete')) {
        input.setAttribute('autocomplete', type === 'password' ? 'new-password' : 'off');
      }
      if (!input.hasAttribute('spellcheck')) {
        input.setAttribute('spellcheck', 'false');
      }
    }
  }
};

const observer = new MutationObserver((mutations) => {
  for (const mutation of mutations) {
    for (const node of mutation.addedNodes) {
      if (node.nodeType === Node.ELEMENT_NODE) {
        const el = node as HTMLElement;
        disableAutofill(el);
        const inputs = el.querySelectorAll?.('input');
        if (inputs) {
          inputs.forEach(disableAutofill);
        }
      }
    }
  }
});

observer.observe(document.documentElement, { childList: true, subtree: true });

document.addEventListener(
  'focusin',
  (e) => {
    if (e.target && (e.target as HTMLElement).tagName === 'INPUT') {
      disableAutofill(e.target as HTMLElement);
    }
  },
  true,
);

// 网页 UI：滚动与边缘自隐滚动条（双触发机制，遵循个人开发习惯约定）
(() => {
  let timer: number | null = null;
  const el = document.documentElement;

  // 1. 页面滚动时显现，停止滚动 800ms 后自动隐藏
  window.addEventListener(
    'scroll',
    () => {
      el.classList.add('is-scrolling');
      if (timer) clearTimeout(timer);
      timer = window.setTimeout(() => {
        el.classList.remove('is-scrolling');
      }, 800);
    },
    { passive: true },
  );

  // 2. 仅当鼠标移动到屏幕最右侧边缘 18px 以内时显现；移开立即隐藏
  window.addEventListener(
    'mousemove',
    (e) => {
      if (window.innerWidth - e.clientX <= 18) {
        el.classList.add('near-scrollbar');
      } else {
        el.classList.remove('near-scrollbar');
      }
    },
    { passive: true },
  );

  window.addEventListener('mouseleave', () => {
    el.classList.remove('near-scrollbar');
  });
})();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
