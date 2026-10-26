import { useEffect } from 'react';
import { useFamilyStore } from '../store/familyStore';
import { lockBodyScroll } from '../utils/bodyScrollLock';
import './DataMigrationDialog.css';

// 以苒纪 — 旧档案升级提示
//
// 打开旧版本家谱时，迁移会按最小改动断开无法成立的关系（自指、成环、角色互斥、年龄倒挂）。
// 这个弹窗把"动了什么、为什么动、备份在哪"讲清楚：用户有权知道数据被改过。

export default function DataMigrationDialog() {
  const report = useFamilyStore((state) => state.dataMigrationReport);
  const clearReport = useFamilyStore((state) => state.clearDataMigrationReport);
  const open = Boolean(report && report.brokenRelations.length > 0);

  useEffect(() => {
    if (!open) return;
    return lockBodyScroll();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') clearReport();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, clearReport]);

  if (!open || !report) return null;

  return (
    <div className="datamig-overlay" role="presentation">
      <div
        className="datamig-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="datamig-title"
      >
        <div className="datamig-header">
          <h2 className="datamig-title" id="datamig-title">
            家谱数据已升级
          </h2>
          <span className="datamig-version">
            {report.fromVersion} → {report.toVersion}
          </span>
        </div>

        <p className="datamig-lead">
          这份档案是用旧版本保存的。升级时会检查家庭关系是否成立，
          发现 <strong>{report.brokenRelations.length}</strong> 条无法成立的关系，
          已按最小改动断开；其余关系与人员资料都原样保留。
        </p>

        <div className="datamig-section">
          <div className="datamig-section-title">已断开的关系</div>
          <ul className="datamig-list">
            {report.brokenRelations.map((item, index) => (
              <li key={`${item.personId}-${item.role}-${index}`}>
                <span className="datamig-person">{item.personName}</span>
                <span className="datamig-role">{item.role}</span>
                <span className="datamig-target">{item.targetName}</span>
                <span className="datamig-reason">{item.reason}</span>
              </li>
            ))}
          </ul>
        </div>

        {report.isolatedPersons.length > 0 && (
          <div className="datamig-section">
            <div className="datamig-section-title">因此没有亲属关系的人</div>
            <p className="datamig-note">
              {report.isolatedPersons.map((person) => person.name).join('、')}
              —— 这些人在家谱树里仍会显示，可在「人员列表」中重新为他们关联亲属。
            </p>
          </div>
        )}

        {report.skippedUnknownAge > 0 && (
          <p className="datamig-note">
            另有 {report.skippedUnknownAge} 条亲子关系因缺少出生日期而未参与年龄判定，关系保持原样。
          </p>
        )}

        <p className="datamig-backup">
          {report.backupPath
            ? `升级前的档案已备份到：${report.backupPath}`
            : '升级前的档案已在浏览器本地留存备份。'}
        </p>

        <div className="datamig-actions">
          <button className="btn btn-primary" onClick={clearReport}>
            我知道了
          </button>
        </div>
      </div>
    </div>
  );
}
