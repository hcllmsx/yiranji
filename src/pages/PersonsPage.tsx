import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useFamilyStore } from '../store/familyStore';
import { getFullName, getLifeSpan, getAgeDescription } from '../utils';
import { convertLocalSrc } from '../utils/tauri';
import './PersonsPage.css';

export default function PersonsPage() {
  const navigate = useNavigate();
  const { getPersonsList } = useFamilyStore();
  const [search, setSearch] = useState('');

  const persons = getPersonsList();
  const filtered = persons.filter((p) => {
    const name = getFullName(p.surname, p.givenName);
    return name.includes(search) || p.birthPlace?.includes(search);
  });

  return (
    <div className="persons-page">
      <div className="persons-header">
        <h2>人员列表</h2>
        <button className="btn btn-primary" onClick={() => navigate('/person/new/edit')}>
          ＋ 添加人员
        </button>
      </div>

      <div className="persons-search">
        <span className="search-icon">🔍</span>
        <input
          type="text"
          placeholder="搜索人员姓名、出生地..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div className="persons-grid">
        {filtered.map((person) => (
          <Link
            key={person.id}
            to={`/person/${person.id}`}
            className={`person-card ${person.isDefaultPerspective ? 'perspective' : ''}`}
          >
            <div className="person-card-avatar">
              {person.avatar ? (
                <img src={convertLocalSrc(person.avatar)} alt="" />
              ) : (
                person.surname
              )}
            </div>
            <div className="person-card-name">
              {getFullName(person.surname, person.givenName) || '未命名'}
            </div>
            <div className="person-card-meta">
              {getLifeSpan(person.birthDateSolar, person.deathDateSolar, person.isAlive)}
              {' '}
              {getAgeDescription(person.birthDateSolar, person.deathDateSolar, person.isAlive)}
            </div>
            {person.isDefaultPerspective && (
              <div className="person-card-badge">
                <span className="badge badge-accent">默认视角</span>
              </div>
            )}
          </Link>
        ))}

        {/* 添加人员卡片 */}
        <button
          className="person-card person-card-add"
          onClick={() => navigate('/person/new/edit')}
        >
          <span className="add-icon">＋</span>
          <span>添加人员</span>
        </button>
      </div>

      {filtered.length === 0 && search && (
        <div className="empty-state" style={{ marginTop: '32px' }}>
          <div className="empty-state-icon">🔍</div>
          <div className="empty-state-title">未找到匹配的人员</div>
          <div className="empty-state-desc">尝试使用其他关键词搜索</div>
        </div>
      )}
    </div>
  );
}
