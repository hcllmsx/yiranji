import { useEffect } from 'react';
import { useFamilyStore } from '../store/familyStore';
import { openInExplorer } from '../utils/tauri';
import { lockBodyScroll } from '../utils/bodyScrollLock';
import './DataMigrationDialog.css';

/** 旧版 JSON 工作区已自动转换为 YRP 后，告知用户原始文件备份位置。 */
export default function FormatMigrationDialog() {
  const backupPath = useFamilyStore((state) => state.formatBackupPath);
  const clearBackupPath = useFamilyStore((state) => state.clearFormatBackupPath);
  const open = Boolean(backupPath);

  useEffect(() => {
    if (!open) return;
    return lockBodyScroll();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') clearBackupPath();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, clearBackupPath]);

  if (!backupPath) return null;

  return (
    <div className="datamig-overlay" role="presentation">
      <div className="datamig-dialog" role="dialog" aria-modal="true" aria-labelledby="format-mig-title">
        <div className="datamig-header">
          <h2 className="datamig-title" id="format-mig-title">工程已升级为 YRP 格式</h2>
          <span className="datamig-version">JSON → YRP</span>
        </div>
        <p className="datamig-lead">
          旧版 project.json 已自动转换为 project.yrp，人员、关系和媒体文件均保持原样。
          转换前的原始 JSON 已单独备份到软件缓存的 backups 文件夹。
        </p>
        <p className="datamig-backup">备份位置：{backupPath}</p>
        <div className="datamig-actions" style={{ gap: 'var(--space-3)' }}>
          <button className="btn btn-secondary" onClick={() => openInExplorer(backupPath)}>
            打开备份位置
          </button>
          <button className="btn btn-primary" onClick={clearBackupPath}>我知道了</button>
        </div>
      </div>
    </div>
  );
}
