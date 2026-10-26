import { useEffect, useState } from 'react';
import { lockBodyScroll } from '../utils/bodyScrollLock';
import { dismissMajorUpdateNotice, shouldShowMajorUpdateNotice } from '../utils/appPrefs';
import './MajorUpdateNotice.css';

// 以苒纪 — 重大更新提示
//
// 这次改版动了家谱存档的内部结构（媒体目录布局等），旧存档打开后媒体文件可能读不出来。
// 弹窗只在本机第一次启动新版时出现一次，把「可能出问题的是哪类东西」和「先备份」讲清楚，
// 不吓唬用户，也不替用户做决定。

export default function MajorUpdateNotice() {
  const [open, setOpen] = useState(() => shouldShowMajorUpdateNotice());

  useEffect(() => {
    if (!open) return;
    return lockBodyScroll();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') dismiss();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open]);

  const dismiss = () => {
    dismissMajorUpdateNotice();
    setOpen(false);
  };

  if (!open) return null;

  return (
    <div className="majorupd-overlay" role="presentation">
      <div
        className="majorupd-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="majorupd-title"
      >
        <div className="majorupd-header">
          <h2 className="majorupd-title" id="majorupd-title">
            这次是一次大更新
          </h2>
          <span className="majorupd-version">v{__APP_VERSION__}</span>
        </div>

        <p className="majorupd-lead">
          这次更新改动较大，家谱存档的内部结构做了调整。
        </p>

        <p className="majorupd-text">
          如果你用旧版本创建过家谱，打开后少数内容可能读取异常——
          <strong>头像、照片、音频、视频</strong>
          这类媒体文件尤其明显，可能需要你重新设置一次。
        </p>

        <p className="majorupd-text">
          在打开旧存档之前，建议先把家谱工程文件夹整个复制一份备份。
          这样万一哪里不对，随时能退回旧版本，数据不会丢。
        </p>

        <p className="majorupd-note">
          备份很简单：在磁盘上找到你的家谱工程文件夹，整个复制一份到别处即可。
        </p>

        <div className="majorupd-actions">
          <button className="btn btn-primary" onClick={dismiss}>
            我知道了
          </button>
        </div>
      </div>
    </div>
  );
}
