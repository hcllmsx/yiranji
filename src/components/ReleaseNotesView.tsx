import type { ReleaseNoteSection } from '../utils/updateChecker';
import './ReleaseNotesView.css';

// 以苒纪 — 更新内容列表
//
// 「发现新版本」与「本次更新内容」两个弹窗共用：
// 按 release-notes.json 的分类渲染标题 + 条目列表，超长时在块内滚动。

interface ReleaseNotesViewProps {
  sections: ReleaseNoteSection[];
}

export default function ReleaseNotesView({ sections }: ReleaseNotesViewProps) {
  return (
    <div className="release-notes">
      {sections.map((section) => (
        <div className="release-notes-section" key={section.title}>
          <div className="release-notes-title">{section.title}</div>
          <ul className="release-notes-list">
            {section.items.map((item, index) => (
              <li key={index}>{item.replace(/`/g, '')}</li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
