// 以苒纪 — Body 滚动锁定工具（引用计数式，支持嵌套模态）

let lockCount = 0;
let originalOverflow = '';
let originalPaddingRight = '';

/**
 * 锁定 body 滚动。返回解锁函数，应在 useEffect 的清理阶段调用。
 * 支持嵌套：多个模态同时锁定时，只有全部解锁后才会恢复滚动。
 */
export function lockBodyScroll(): () => void {
  if (lockCount === 0) {
    originalOverflow = document.body.style.overflow;
    originalPaddingRight = document.body.style.paddingRight;
    // 补偿滚动条宽度，避免锁定/解锁时页面横向跳动
    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
    if (scrollbarWidth > 0) {
      document.body.style.paddingRight = `${scrollbarWidth}px`;
    }
    document.body.style.overflow = 'hidden';
  }
  lockCount++;
  return () => {
    lockCount = Math.max(0, lockCount - 1);
    if (lockCount === 0) {
      document.body.style.overflow = originalOverflow;
      document.body.style.paddingRight = originalPaddingRight;
    }
  };
}
