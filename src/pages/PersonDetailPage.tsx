import { useState, useRef, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useFamilyStore } from '../store/familyStore';
import { useMediaProgressStore } from '../store/mediaProgressStore';
import {
  getFullName,
  formatDate,
  formatLunarDate,
  calculatePhotoAge,
  getAgeDescription,
  getLifeSpan,
  getZodiac,
  getSiblingRank,
} from '../utils';
import { convertLocalSrc, isTauri, saveMediaFile, deleteMediaFile } from '../utils/tauri';
import { lockBodyScroll } from '../utils/bodyScrollLock';
import type { Photo, VideoFile } from '../types';
import './PersonDetailPage.css';

export default function PersonDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { getPerson, getPersonsList, updatePerson, deletePerson, currentFilePath } = useFamilyStore();

  const person = id ? getPerson(id) : undefined;
  const allPersons = getPersonsList();

  // 音频播放状态
  const [playingAudioId, setPlayingAudioId] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // 灯箱状态：照片 / 视频
  const [lightboxPhoto, setLightboxPhoto] = useState<Photo | null>(null);
  const [lightboxVideo, setLightboxVideo] = useState<VideoFile | null>(null);

  // 自定义确认对话框
  const [dialog, setDialog] = useState<{
    show: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
  } | null>(null);

  if (!person) {
    return (
      <div className="page-container">
        <div className="empty-state">
          <div className="empty-state-icon">🔍</div>
          <div className="empty-state-title">未找到该人物</div>
          <button className="btn btn-primary" onClick={() => navigate('/persons')}>
            返回人物列表
          </button>
        </div>
      </div>
    );
  }

  const fullName = getFullName(person.surname, person.givenName);
  const ageDesc = getAgeDescription(person.birthDateSolar, person.deathDateSolar, person.isAlive);
  const lifeSpan = getLifeSpan(person.birthDateSolar, person.deathDateSolar, person.isAlive);

  // 获取关系人信息
  const getRelationPerson = (personId?: string) => {
    if (!personId) return null;
    return allPersons.find((p) => p.id === personId) || null;
  };

  // 构建关系列表
  const relations: { type: string; person: ReturnType<typeof getRelationPerson> }[] = [];
  if (person.relations.father) relations.push({ type: '父亲', person: getRelationPerson(person.relations.father) });
  if (person.relations.mother) relations.push({ type: '母亲', person: getRelationPerson(person.relations.mother) });
  if (person.relations.adoptiveFather) relations.push({ type: '养父', person: getRelationPerson(person.relations.adoptiveFather) });
  if (person.relations.adoptiveMother) relations.push({ type: '养母', person: getRelationPerson(person.relations.adoptiveMother) });
  if (person.relations.stepFather) relations.push({ type: '继父', person: getRelationPerson(person.relations.stepFather) });
  if (person.relations.stepMother) relations.push({ type: '继母', person: getRelationPerson(person.relations.stepMother) });

  // 挂载计算好的手足兄弟姐妹，带上智能长幼排行称呼
  const f = person.relations.father;
  const m = person.relations.mother;
  const af = person.relations.adoptiveFather;
  const am = person.relations.adoptiveMother;
  const personsDict = Object.fromEntries(allPersons.map(ap => [ap.id, ap]));
  allPersons.forEach((p) => {
    if (p.id === person.id) return;
    const shareFather = f && p.relations.father === f;
    const shareMother = m && p.relations.mother === m;
    const shareAdoptiveFather = af && p.relations.adoptiveFather === af;
    const shareAdoptiveMother = am && p.relations.adoptiveMother === am;
    
    if (shareFather || shareMother || shareAdoptiveFather || shareAdoptiveMother) {
      const rankText = getSiblingRank(p.id, personsDict, person.id);
      relations.push({ type: rankText || '兄弟姐妹', person: p });
    }
  });

  // 智能收集所有配偶 ID（包括正向 spouses 记录与反向推导声明配偶）
  const spouseIdsSet = new Set<string>();
  person.relations.spouses.forEach(s => spouseIdsSet.add(s.id));
  allPersons.forEach(p => {
    if (p.id === person.id) return;
    if (p.relations.spouses && p.relations.spouses.some(s => s.id === person.id)) {
      spouseIdsSet.add(p.id);
    }
  });

  // 智能收集所有子女 ID 及其关系类型（包括正向 children 记录与反向父母指向推导）
  const childrenMap = new Map<string, string>(); // childId -> type
  person.relations.children.forEach(c => childrenMap.set(c.id, c.type));
  allPersons.forEach(p => {
    if (p.id === person.id) return;
    if (p.relations.father === person.id || p.relations.mother === person.id) {
      if (!childrenMap.has(p.id)) {
        childrenMap.set(p.id, 'biological');
      }
    }
    if (p.relations.adoptiveFather === person.id || p.relations.adoptiveMother === person.id) {
      if (!childrenMap.has(p.id)) {
        childrenMap.set(p.id, 'adopted');
      }
    }
    if (p.relations.stepFather === person.id || p.relations.stepMother === person.id) {
      if (!childrenMap.has(p.id)) {
        childrenMap.set(p.id, 'step');
      }
    }
  });

  Array.from(spouseIdsSet).forEach((spouseId) => {
    relations.push({ type: '配偶', person: getRelationPerson(spouseId) });
  });

  Array.from(childrenMap.entries()).forEach(([childId, type]) => {
    const child = getRelationPerson(childId);
    relations.push({ type: type === 'biological' ? '子女' : type === 'adopted' ? '养子女' : '继子女', person: child });
  });

  const fileToDataUrl = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
  };

  const getMediaExtension = (file: File): string => {
    const mimeExt = file.type.split('/')[1]?.split(';')[0];
    const nameExt = file.name.split('.').pop();
    const ext = (mimeExt || nameExt || 'bin').toLowerCase();
    return ext === 'jpeg' ? 'jpg' : ext.replace(/[^a-z0-9]/g, '') || 'bin';
  };

  const saveMediaToWorkspace = async (file: File, prefix: 'photo' | 'audio' | 'video'): Promise<string> => {
    const dataUrl = await fileToDataUrl(file);
    if (!isTauri() || !currentFilePath) {
      return dataUrl;
    }

    const randomId = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2);
    const filename = `${prefix}_${randomId}.${getMediaExtension(file)}`;
    await saveMediaFile(currentFilePath, filename, dataUrl);
    return `${currentFilePath}/media/${filename}`;
  };

  // 视频封面缩略图生成：通过隐藏 video 元素跳转至指定时刻并截取一帧
  const generateVideoThumbnail = (videoSrc: string): Promise<{ thumbnail: string; width: number; height: number; duration: number }> => {
    return new Promise((resolve) => {
      const video = document.createElement('video');
      video.preload = 'auto';
      video.muted = true;
      video.playsInline = true;
      // 注意：不要设置 crossOrigin，否则 Tauri 本地 asset:// 协议会使 canvas 被污染，导致 toDataURL 抛 SecurityError
      video.src = videoSrc;
      video.load();

      let settled = false;
      const finish = (result: { thumbnail: string; width: number; height: number; duration: number }) => {
        if (settled) return;
        settled = true;
        resolve(result);
      };

      const fallback = () => finish({ thumbnail: '', width: 0, height: 0, duration: 0 });

      video.addEventListener('error', fallback);

      video.addEventListener('loadedmetadata', () => {
        const width = video.videoWidth || 0;
        const height = video.videoHeight || 0;
        const duration = isFinite(video.duration) ? video.duration : 0;

        // 没有可视尺寸时直接返回（仍保留 duration）
        if (!width || !height) {
          finish({ thumbnail: '', width, height, duration });
          return;
        }

        // 跳转至 1 秒处（或 10% 时长，避免开头黑帧）
        const seekTime = duration > 0 ? Math.min(1, duration * 0.1) : 0.1;

        const captureFrame = () => {
          try {
            const canvas = document.createElement('canvas');
            const targetW = Math.min(width, 480);
            const targetH = Math.round(targetW * (height / width));
            canvas.width = targetW;
            canvas.height = targetH;
            const ctx = canvas.getContext('2d');
            if (!ctx) {
              finish({ thumbnail: '', width, height, duration });
              return;
            }
            ctx.drawImage(video, 0, 0, targetW, targetH);
            // 若 canvas 被污染，toDataURL 会抛 SecurityError
            const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
            finish({ thumbnail: dataUrl, width, height, duration });
          } catch {
            // canvas 被污染或其它异常，回退无封面（灯箱会用 video 首帧兜底）
            finish({ thumbnail: '', width, height, duration });
          }
        };

        video.addEventListener('seeked', captureFrame, { once: true });

        try {
          video.currentTime = seekTime;
        } catch {
          captureFrame();
        }

        // seek 超时兜底：3 秒未触发 seeked，直接尝试截取当前帧
        setTimeout(() => {
          if (!settled) {
            video.removeEventListener('seeked', captureFrame);
            captureFrame();
          }
        }, 3000);
      });

      // 总体兜底：8 秒未完成
      setTimeout(fallback, 8000);
    });
  };

  const deletePhysicalMedia = async (mediaPath: string) => {
    if (!isTauri() || !currentFilePath || mediaPath.startsWith('data:')) return;
    try {
      await deleteMediaFile(currentFilePath, mediaPath);
    } catch (err) {
      console.error('删除媒体文件失败:', err);
    }
  };

  const confirmRemovePhoto = (photoId: string, mediaPath: string) => {
    if (!id) return;
    setDialog({
      show: true,
      title: '删除照片',
      message: '确定要删除这张照片吗？',
      onConfirm: async () => {
        await deletePhysicalMedia(mediaPath);
        if (lightboxPhoto?.id === photoId) setLightboxPhoto(null);
        updatePerson(id, {
          photos: person.photos.filter((photo) => photo.id !== photoId),
        });
      },
    });
  };

  const confirmRemoveAudio = (audioId: string, mediaPath: string) => {
    if (!id) return;
    setDialog({
      show: true,
      title: '删除音频',
      message: '确定要删除这个音频吗？',
      onConfirm: async () => {
        if (playingAudioId === audioId && audioRef.current) {
          audioRef.current.pause();
          setPlayingAudioId(null);
        }
        await deletePhysicalMedia(mediaPath);
        updatePerson(id, {
          audioFiles: person.audioFiles.filter((audio) => audio.id !== audioId),
        });
      },
    });
  };

  const confirmRemoveVideo = (videoId: string, mediaPath: string, thumbnailPath?: string) => {
    if (!id) return;
    setDialog({
      show: true,
      title: '删除视频',
      message: '确定要删除这个视频吗？',
      onConfirm: async () => {
        if (lightboxVideo?.id === videoId) setLightboxVideo(null);
        await deletePhysicalMedia(mediaPath);
        await deleteVideoThumbnail(thumbnailPath);
        updatePerson(id, {
          videoFiles: person.videoFiles.filter((video) => video.id !== videoId),
        });
      },
    });
  };

  // 添加媒体文件（照片、音频、视频） — 支持多文件批量导入 + 进度提示
  const handleAddPhoto = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0 || !id) return;
    const fileList = Array.from(files);
    e.target.value = '';

    const newPhotos: Photo[] = [];
    for (const file of fileList) {
      const taskId = useMediaProgressStore.getState().startTask(file.name, 'photo');
      try {
        useMediaProgressStore.getState().updateProgress(taskId, 30);
        const path = await saveMediaToWorkspace(file, 'photo');
        useMediaProgressStore.getState().updateProgress(taskId, 80);
        newPhotos.push({
          id: `${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
          path,
          caption: file.name,
        });
        useMediaProgressStore.getState().finishTask(taskId);
      } catch (err) {
        console.error('保存照片文件失败:', err);
        useMediaProgressStore.getState().failTask(taskId, '保存失败');
      }
    }

    if (newPhotos.length > 0) {
      updatePerson(id, {
        photos: [...person.photos, ...newPhotos],
      });
    }
  };

  const handleAddAudio = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0 || !id) return;
    const fileList = Array.from(files);
    e.target.value = '';

    const newAudios = [];
    for (const file of fileList) {
      const taskId = useMediaProgressStore.getState().startTask(file.name, 'audio');
      try {
        useMediaProgressStore.getState().updateProgress(taskId, 30);
        const path = await saveMediaToWorkspace(file, 'audio');
        useMediaProgressStore.getState().updateProgress(taskId, 80);
        newAudios.push({
          id: `${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
          path,
          caption: file.name,
        });
        useMediaProgressStore.getState().finishTask(taskId);
      } catch (err) {
        console.error('保存音频文件失败:', err);
        useMediaProgressStore.getState().failTask(taskId, '保存失败');
      }
    }

    if (newAudios.length > 0) {
      updatePerson(id, {
        audioFiles: [...person.audioFiles, ...newAudios],
      });
    }
  };

  const handleAddVideo = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0 || !id) return;
    const fileList = Array.from(files);
    e.target.value = '';

    const newVideos: VideoFile[] = [];
    for (const file of fileList) {
      const taskId = useMediaProgressStore.getState().startTask(file.name, 'video');
      try {
        useMediaProgressStore.getState().updateProgress(taskId, 20);
        const path = await saveMediaToWorkspace(file, 'video');
        useMediaProgressStore.getState().updateProgress(taskId, 60);

        // 生成视频封面缩略图
        const videoSrc = convertLocalSrc(path);
        const thumbInfo = await generateVideoThumbnail(videoSrc);
        useMediaProgressStore.getState().updateProgress(taskId, 90);

        // 若生成了封面，则将其一并写入工作区
        let thumbnailPath: string | undefined;
        if (thumbInfo.thumbnail && isTauri() && currentFilePath) {
          try {
            const randomId = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2);
            const thumbName = `video_thumb_${randomId}.jpg`;
            await saveMediaFile(currentFilePath, thumbName, thumbInfo.thumbnail);
            thumbnailPath = `${currentFilePath}/media/${thumbName}`;
          } catch {
            thumbnailPath = thumbInfo.thumbnail;
          }
        } else if (thumbInfo.thumbnail) {
          thumbnailPath = thumbInfo.thumbnail;
        }

        newVideos.push({
          id: `${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
          path,
          caption: file.name,
          thumbnail: thumbnailPath,
          width: thumbInfo.width || undefined,
          height: thumbInfo.height || undefined,
          duration: thumbInfo.duration || undefined,
        });
        useMediaProgressStore.getState().finishTask(taskId);
      } catch (err) {
        console.error('保存视频文件失败:', err);
        useMediaProgressStore.getState().failTask(taskId, '保存失败');
      }
    }

    if (newVideos.length > 0) {
      updatePerson(id, {
        videoFiles: [...person.videoFiles, ...newVideos],
      });
    }
  };

  const toggleAudioPlay = (audioId: string, audioSrc: string) => {
    if (playingAudioId === audioId && audioRef.current) {
      audioRef.current.pause();
      setPlayingAudioId(null);
    } else {
      if (audioRef.current) audioRef.current.pause();
      const audio = new Audio(audioSrc);
      audio.play();
      audio.onended = () => setPlayingAudioId(null);
      audioRef.current = audio;
      setPlayingAudioId(audioId);
    }
  };

  // 灯箱：保存照片备注/日期
  const handleSavePhotoMeta = (photoId: string, caption: string, date: string) => {
    if (!id) return;
    const updatedPhotos = person.photos.map((p) =>
      p.id === photoId ? { ...p, caption, date: date || undefined } : p
    );
    updatePerson(id, { photos: updatedPhotos });
    // 同步刷新当前灯箱
    if (lightboxPhoto?.id === photoId) {
      const updated = updatedPhotos.find((p) => p.id === photoId);
      if (updated) setLightboxPhoto(updated);
    }
  };

  // 灯箱：保存视频备注/日期
  const handleSaveVideoMeta = (videoId: string, caption: string, date: string) => {
    if (!id) return;
    const updatedVideos = person.videoFiles.map((v) =>
      v.id === videoId ? { ...v, caption, date: date || undefined } : v
    );
    updatePerson(id, { videoFiles: updatedVideos });
    if (lightboxVideo?.id === videoId) {
      const updated = updatedVideos.find((v) => v.id === videoId);
      if (updated) setLightboxVideo(updated);
    }
  };

  // 删除视频时一并删除封面缩略图物理文件
  const deleteVideoThumbnail = async (thumbnailPath?: string) => {
    if (!thumbnailPath || !isTauri() || !currentFilePath) return;
    if (thumbnailPath.startsWith('data:')) return;
    try {
      await deleteMediaFile(currentFilePath, thumbnailPath).catch(() => {});
    } catch {
      /* ignore */
    }
  };

  // ESC 键关闭灯箱
  useEffect(() => {
    if (!lightboxPhoto && !lightboxVideo) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setLightboxPhoto(null);
        setLightboxVideo(null);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [lightboxPhoto, lightboxVideo]);

  // 格式化视频时长为 mm:ss 或 hh:mm:ss
  const formatVideoDuration = (seconds: number): string => {
    if (!seconds || isNaN(seconds)) return '';
    const s = Math.floor(seconds % 60);
    const m = Math.floor((seconds / 60) % 60);
    const h = Math.floor(seconds / 3600);
    const pad = (n: number) => String(n).padStart(2, '0');
    return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
  };

  return (
    <div className="person-detail-page">
      {/* 头部信息 */}
      <div className={`person-detail-header ${person.avatarRect ? 'has-rect-avatar' : ''}`}>
        <div className="person-detail-avatar">
          {person.avatarRect ? (
            // 矩形原图视图：左侧整图 + 右侧文字信息
            <img
              src={convertLocalSrc(person.avatarRect)}
              alt={fullName}
              className="rect-avatar-img"
            />
          ) : person.avatar ? (
            <img
              src={convertLocalSrc(person.avatar)}
              alt={fullName}
              className={person.isDefaultPerspective ? 'perspective-border' : ''}
            />
          ) : (
            <div className={`avatar-placeholder ${person.isDefaultPerspective ? 'perspective-border' : ''}`}>
              {person.surname}
            </div>
          )}
          {person.avatarPhotoDate && person.birthDateSolar && (
            <div className="person-detail-photo-age">
              📷 {calculatePhotoAge(person.birthDateSolar, person.avatarPhotoDate)}时
            </div>
          )}
        </div>

        <div className="person-detail-info">
          {/* 头部：名字与标签 */}
          <div className="header-section">
            <div className="name-row">
              <h1 className="user-name">{fullName}</h1>
            </div>
            {person.isDefaultPerspective && (
              <span className="role-tag">默认视角</span>
            )}
          </div>

          {/* 信息网格：第一行3列，后续行跨整行 */}
          <div className="info-grid">
            {person.gender && (
              <div className="info-item">
                <div className="icon-box">{person.gender === 'male' ? '♂' : '♀'}</div>
                <div className="info-text-group">
                  <span className="info-label">性别</span>
                  <span className="info-value">{person.gender === 'male' ? '男' : '女'}</span>
                </div>
              </div>
            )}
            {person.birthDateSolar && (
              <div className="info-item">
                <div className="icon-box">🐾</div>
                <div className="info-text-group">
                  <span className="info-label">生肖</span>
                  <span className="info-value">{getZodiac(new Date(person.birthDateSolar).getFullYear())}</span>
                </div>
              </div>
            )}
            {ageDesc && (
              <div className="info-item">
                <div className="icon-box">🎂</div>
                <div className="info-text-group">
                  <span className="info-label">年龄 / 年份</span>
                  <span className="info-value">
                    {ageDesc}
                    {lifeSpan && !person.isAlive && <>（{lifeSpan}）</>}
                  </span>
                </div>
              </div>
            )}
            {person.birthDateSolar && (
              <div className="info-item info-item-full">
                <div className="icon-box">☀️</div>
                <div className="info-text-group">
                  <span className="info-label">出生日期</span>
                  <span className="info-value">
                    公历 {formatDate(person.birthDateSolar, person.birthTimePrecision)}
                    {person.birthDateLunar && (
                      <> &nbsp;|&nbsp; 农历 {formatLunarDate(person.birthDateLunar)}</>
                    )}
                  </span>
                </div>
              </div>
            )}
            {person.birthPlace && (
              <div className="info-item info-item-full">
                <div className="icon-box">📍</div>
                <div className="info-text-group">
                  <span className="info-label">出生地</span>
                  <span className="info-value">{person.birthPlace}</span>
                </div>
              </div>
            )}
          </div>

          {/* 底部操作栏 */}
          <div className="action-bar">
            <button className="btn btn-secondary action-btn" onClick={() => navigate(`/person/${id}/edit`)}>
              <span>✏️</span> 编辑资料
            </button>
            <button className="btn btn-secondary action-btn" onClick={() => navigate('/tree')}>
              <span>🌳</span> 在树中查看
            </button>
            <button
              className="btn btn-secondary action-btn"
              onClick={() => {
                setDialog({
                  show: true,
                  title: '删除确认',
                  message: `确定要删除"${fullName}"吗？此操作将彻底删除此人，并移除其在谱系中的所有家庭关联。`,
                  onConfirm: () => {
                    if (id) {
                      deletePerson(id);
                      navigate('/persons');
                    }
                  }
                });
              }}
            >
              <span>🗑️</span> 删除人物
            </button>
          </div>
        </div>
      </div>

      {/* 个人简介 */}
      {person.bio && (
        <div className="detail-section">
          <div className="detail-section-header">
            <div className="detail-section-title">个人简介</div>
          </div>
          <div className="detail-bio">{person.bio}</div>
        </div>
      )}

      {/* 关系 */}
      {relations.length > 0 && (
        <div className="detail-section">
          <div className="detail-section-header">
            <div className="detail-section-title">家庭关系</div>
          </div>
          <div className="relation-list">
            {relations.map((r, i) => (
              r.person && (
                <Link
                  key={i}
                  to={`/person/${r.person.id}`}
                  className="relation-card"
                >
                  <div className="avatar avatar-sm">
                    {r.person.avatar ? (
                      <img src={convertLocalSrc(r.person.avatar)} alt="" />
                    ) : (
                      r.person.surname
                    )}
                  </div>
                  <div>
                    <div className="relation-type">{r.type}</div>
                    <div className="relation-name">
                      {getFullName(r.person.surname, r.person.givenName)}
                    </div>
                  </div>
                </Link>
              )
            ))}
          </div>
        </div>
      )}

      {/* 照片 */}
      <div className="detail-section">
        <div className="detail-section-header">
          <div className="detail-section-title">照片</div>
          {person.photos.length > 0 && (
            <span className="detail-section-hint">点击照片可放大查看并编辑备注</span>
          )}
        </div>
        {person.photos.length > 0 ? (
          <div className="photo-grid">
            {person.photos.map((photo) => (
              <div key={photo.id} className="photo-grid-item">
                <button
                  type="button"
                  className="media-delete-btn"
                  aria-label="删除照片"
                  onClick={(e) => {
                    e.stopPropagation();
                    confirmRemovePhoto(photo.id, photo.path);
                  }}
                >
                  ×
                </button>
                <button
                  type="button"
                  className="photo-grid-item-inner"
                  onClick={() => setLightboxPhoto(photo)}
                  title="点击查看大图"
                >
                  <img src={convertLocalSrc(photo.path)} alt={photo.caption || ''} />
                  <div className="photo-info">
                    {photo.caption && <div>{photo.caption}</div>}
                    {photo.date && person.birthDateSolar && (
                      <div>{calculatePhotoAge(person.birthDateSolar, photo.date)}</div>
                    )}
                  </div>
                </button>
              </div>
            ))}
          </div>
        ) : null}
        <label className="add-media-btn" style={{ marginTop: person.photos.length > 0 ? '12px' : 0 }}>
          <input type="file" accept="image/*" multiple onChange={handleAddPhoto} style={{ display: 'none' }} />
          ＋ 添加照片
        </label>
      </div>

      {/* 音频 */}
      <div className="detail-section">
        <div className="detail-section-header">
          <div className="detail-section-title">音频</div>
        </div>
        {person.audioFiles.length > 0 ? (
          <div className="audio-list">
            {person.audioFiles.map((audio) => (
              <div key={audio.id} className="audio-item">
                <button
                  className="play-btn"
                  onClick={() => toggleAudioPlay(audio.id, convertLocalSrc(audio.path))}
                >
                  {playingAudioId === audio.id ? '⏸' : '▶'}
                </button>
                <div className="audio-item-info">
                  <div className="audio-item-caption">{audio.caption || '音频文件'}</div>
                  {audio.date && <div className="audio-item-date">{formatDate(audio.date)}</div>}
                </div>
                <button
                  type="button"
                  className="media-delete-btn inline"
                  aria-label="删除音频"
                  onClick={() => confirmRemoveAudio(audio.id, audio.path)}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        ) : null}
        <label className="add-media-btn" style={{ marginTop: person.audioFiles.length > 0 ? '12px' : 0 }}>
          <input type="file" accept="audio/*" multiple onChange={handleAddAudio} style={{ display: 'none' }} />
          ＋ 添加音频
        </label>
      </div>

      {/* 视频 */}
      <div className="detail-section">
        <div className="detail-section-header">
          <div className="detail-section-title">视频</div>
          {person.videoFiles.length > 0 && (
            <span className="detail-section-hint">点击视频封面可播放</span>
          )}
        </div>
        {person.videoFiles.length > 0 ? (
          <div className="video-list">
            {person.videoFiles.map((video) => (
              <div key={video.id} className="video-item">
                <button
                  type="button"
                  className="media-delete-btn"
                  aria-label="删除视频"
                  onClick={(e) => {
                    e.stopPropagation();
                    confirmRemoveVideo(video.id, video.path, video.thumbnail);
                  }}
                >
                  ×
                </button>
                <button
                  type="button"
                  className="video-thumb-wrapper"
                  onClick={() => setLightboxVideo(video)}
                  title="点击播放视频"
                >
                  {video.thumbnail ? (
                    <img
                      src={convertLocalSrc(video.thumbnail)}
                      alt={video.caption || '视频封面'}
                      className="video-thumb-img"
                    />
                  ) : (
                    // 无显式封面时，用 video 标签 preload metadata 显示首帧
                    // 附加 #t=0.1 片段提示，强制浏览器渲染首帧而非黑屏
                    <video
                      className="video-thumb-img"
                      src={`${convertLocalSrc(video.path)}#t=0.1`}
                      preload="metadata"
                      muted
                      playsInline
                    />
                  )}
                  <span className="video-thumb-play-btn">▶</span>
                  {video.duration ? (
                    <span className="video-thumb-duration">
                      {formatVideoDuration(video.duration)}
                    </span>
                  ) : null}
                </button>
                <div className="video-item-info">
                  <div className="video-item-caption">{video.caption || '视频文件'}</div>
                  {video.date && <div className="video-item-date">{formatDate(video.date)}</div>}
                </div>
              </div>
            ))}
          </div>
        ) : null}
        <label className="add-media-btn" style={{ marginTop: person.videoFiles.length > 0 ? '12px' : 0 }}>
          <input type="file" accept="video/*" multiple onChange={handleAddVideo} style={{ display: 'none' }} />
          ＋ 添加视频
        </label>
      </div>

      {/* 自定义删除确认弹窗 */}
      {dialog && (
        <div className="custom-dialog-overlay" onClick={() => setDialog(null)}>
          <div className="custom-dialog-box" onClick={(e) => e.stopPropagation()}>
            <div className="custom-dialog-header">
              <span className="custom-dialog-icon">⚠️</span>
              <span className="custom-dialog-title">{dialog.title}</span>
            </div>
            <div className="custom-dialog-message">{dialog.message}</div>
            <div className="custom-dialog-buttons">
              <button className="btn btn-secondary btn-sm" onClick={() => setDialog(null)}>
                取消
              </button>
              <button
                className="btn btn-danger btn-sm"
                onClick={() => {
                  dialog.onConfirm();
                  setDialog(null);
                }}
              >
                确认删除
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 照片灯箱：左侧大图 + 右侧备注编辑 */}
      {lightboxPhoto && (
        <PhotoLightbox
          photo={lightboxPhoto}
          birthDateSolar={person.birthDateSolar}
          onClose={() => setLightboxPhoto(null)}
          onSave={handleSavePhotoMeta}
        />
      )}

      {/* 视频灯箱：左侧播放器 + 右侧备注编辑 */}
      {lightboxVideo && (
        <VideoLightbox
          video={lightboxVideo}
          onClose={() => setLightboxVideo(null)}
          onSave={handleSaveVideoMeta}
        />
      )}
    </div>
  );
}

// ==================== 照片灯箱组件 ====================

interface PhotoLightboxProps {
  photo: Photo;
  birthDateSolar?: string;
  onClose: () => void;
  onSave: (photoId: string, caption: string, date: string) => void;
}

function PhotoLightbox({ photo, birthDateSolar, onClose, onSave }: PhotoLightboxProps) {
  const [caption, setCaption] = useState(photo.caption || '');
  const [date, setDate] = useState(photo.date || '');
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    setCaption(photo.caption || '');
    setDate(photo.date || '');
    setDirty(false);
  }, [photo.id]);

  // 锁定背景滚动
  useEffect(() => {
    return lockBodyScroll();
  }, []);

  const handleCaptionChange = (val: string) => {
    setCaption(val);
    setDirty(true);
  };

  const handleDateChange = (val: string) => {
    setDate(val);
    setDirty(true);
  };

  const handleSave = () => {
    onSave(photo.id, caption, date);
    setDirty(false);
  };

  const ageText = birthDateSolar && date ? calculatePhotoAge(birthDateSolar, date) : '';

  return (
    <div className="lightbox-overlay" onClick={onClose}>
      <div className="lightbox-container" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="lightbox-close-btn" onClick={onClose} aria-label="关闭">
          ×
        </button>
        <div className="lightbox-body">
          <div className="lightbox-media">
            <img src={convertLocalSrc(photo.path)} alt={photo.caption || ''} />
          </div>
          <div className="lightbox-sidebar">
            <div className="lightbox-sidebar-title">照片备注</div>
            <div className="lightbox-form-group">
              <label className="lightbox-form-label">备注 / 描述</label>
              <textarea
                className="lightbox-form-textarea"
                value={caption}
                onChange={(e) => handleCaptionChange(e.target.value)}
                placeholder="为这张照片添加备注..."
                rows={5}
              />
            </div>
            <div className="lightbox-form-group">
              <label className="lightbox-form-label">拍摄日期</label>
              <input
                type="date"
                className="lightbox-form-input"
                value={date}
                onChange={(e) => handleDateChange(e.target.value)}
              />
            </div>
            {ageText && (
              <div className="lightbox-age-tag">
                📷 {ageText}时的照片
              </div>
            )}
            <div className="lightbox-sidebar-actions">
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={handleSave}
                disabled={!dirty}
              >
                💾 保存备注
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ==================== 视频灯箱组件 ====================

interface VideoLightboxProps {
  video: VideoFile;
  onClose: () => void;
  onSave: (videoId: string, caption: string, date: string) => void;
}

function VideoLightbox({ video, onClose, onSave }: VideoLightboxProps) {
  const [caption, setCaption] = useState(video.caption || '');
  const [date, setDate] = useState(video.date || '');
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    setCaption(video.caption || '');
    setDate(video.date || '');
    setDirty(false);
  }, [video.id]);

  // 锁定背景滚动
  useEffect(() => {
    return lockBodyScroll();
  }, []);

  const handleCaptionChange = (val: string) => {
    setCaption(val);
    setDirty(true);
  };

  const handleDateChange = (val: string) => {
    setDate(val);
    setDirty(true);
  };

  const handleSave = () => {
    onSave(video.id, caption, date);
    setDirty(false);
  };

  return (
    <div className="lightbox-overlay" onClick={onClose}>
      <div className="lightbox-container" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="lightbox-close-btn" onClick={onClose} aria-label="关闭">
          ×
        </button>
        <div className="lightbox-body">
          <div className="lightbox-media video">
            <video
              src={convertLocalSrc(video.path)}
              controls
              autoPlay
              preload="metadata"
              poster={video.thumbnail ? convertLocalSrc(video.thumbnail) : undefined}
            />
          </div>
          <div className="lightbox-sidebar">
            <div className="lightbox-sidebar-title">视频备注</div>
            <div className="lightbox-form-group">
              <label className="lightbox-form-label">备注 / 描述</label>
              <textarea
                className="lightbox-form-textarea"
                value={caption}
                onChange={(e) => handleCaptionChange(e.target.value)}
                placeholder="为这个视频添加备注..."
                rows={5}
              />
            </div>
            <div className="lightbox-form-group">
              <label className="lightbox-form-label">拍摄日期</label>
              <input
                type="date"
                className="lightbox-form-input"
                value={date}
                onChange={(e) => handleDateChange(e.target.value)}
              />
            </div>
            <div className="lightbox-sidebar-actions">
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={handleSave}
                disabled={!dirty}
              >
                💾 保存备注
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
