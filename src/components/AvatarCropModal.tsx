import { useState, useRef, useEffect, useCallback } from 'react';
import { lockBodyScroll } from '../utils/bodyScrollLock';
import { convertLocalSrc } from '../utils/tauri';
import './AvatarCropModal.css';

interface AvatarCropModalProps {
  imageSrc: string;
  onClose: () => void;
  onSave: (circleDataUrl: string, rectDataUrl: string, newOriginalSource?: string) => void;
  initTab?: 'circle' | 'rect';
  syncSourceImage?: string;
}

// 圆形裁剪：正方形容器
const CIRCLE_CONTAINER = 320;
const CIRCLE_OUTPUT = 512;
// 矩形裁剪：4:5 竖向容器（适配个人信息页头像比例）
const RECT_CONTAINER_W = 256;
const RECT_CONTAINER_H = 320;
const RECT_OUTPUT_W = 1200;
const RECT_OUTPUT_H = 1500;

const MIN_ZOOM = 1;
const MAX_ZOOM = 4;

interface CropState {
  offset: { x: number; y: number };
  zoom: number;
  fitScale: number;
}

export default function AvatarCropModal({ imageSrc, onClose, onSave, initTab = 'circle', syncSourceImage }: AvatarCropModalProps) {
  const imgRef = useRef<HTMLImageElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // 当前进行裁剪的预览图 (可以是带协议的物理图、Base64 或带协议的同步图)
  const [currentImageSrc, setCurrentImageSrc] = useState(imageSrc);
  // 记录本次裁剪最终采用的原图数据 (用于在保存时传递给 PersonEditPage 做原图持久化备份)
  const [originalSource, setOriginalSource] = useState<string | undefined>();

  // 图片原始尺寸
  const [naturalSize, setNaturalSize] = useState({ w: 0, h: 0 });

  // 当前激活的裁剪 Tab
  const activeTab = initTab;

  // 圆形裁剪状态
  const [circleState, setCircleState] = useState<CropState>({
    offset: { x: 0, y: 0 },
    zoom: 1,
    fitScale: 1,
  });
  // 矩形裁剪状态
  const [rectState, setRectState] = useState<CropState>({
    offset: { x: 0, y: 0 },
    zoom: 1,
    fitScale: 1,
  });

  // 拖拽状态
  const [dragging, setDragging] = useState(false);
  const dragStart = useRef({ x: 0, y: 0, offsetX: 0, offsetY: 0 });

  // 加载图片得到原始尺寸，并初始化两个裁剪的 fitScale
  useEffect(() => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const w = img.naturalWidth;
      const h = img.naturalHeight;
      setNaturalSize({ w, h });
      setCircleState({
        offset: { x: 0, y: 0 },
        zoom: 1,
        fitScale: Math.max(CIRCLE_CONTAINER / w, CIRCLE_CONTAINER / h),
      });
      setRectState({
        offset: { x: 0, y: 0 },
        zoom: 1,
        fitScale: Math.max(RECT_CONTAINER_W / w, RECT_CONTAINER_H / h),
      });
    };
    img.src = currentImageSrc;
  }, [currentImageSrc]);

  // ESC 关闭弹窗
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  // 锁定背景滚动
  useEffect(() => {
    return lockBodyScroll();
  }, []);

  const current = activeTab === 'circle' ? circleState : rectState;
  const setCurrent = activeTab === 'circle' ? setCircleState : setRectState;
  const containerW = activeTab === 'circle' ? CIRCLE_CONTAINER : RECT_CONTAINER_W;
  const containerH = activeTab === 'circle' ? CIRCLE_CONTAINER : RECT_CONTAINER_H;

  const actualScale = current.fitScale * current.zoom;

  // 限制偏移范围，避免出现空白
  const clampOffset = useCallback(
    (x: number, y: number) => {
      const displayW = naturalSize.w * actualScale;
      const displayH = naturalSize.h * actualScale;
      const maxX = Math.max(0, (displayW - containerW) / 2);
      const maxY = Math.max(0, (displayH - containerH) / 2);
      return {
        x: Math.max(-maxX, Math.min(maxX, x)),
        y: Math.max(-maxY, Math.min(maxY, y)),
      };
    },
    [naturalSize, actualScale, containerW, containerH]
  );

  // 拖拽开始
  const handlePointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    setDragging(true);
    dragStart.current = {
      x: e.clientX,
      y: e.clientY,
      offsetX: current.offset.x,
      offsetY: current.offset.y,
    };
    (e.target as Element).setPointerCapture(e.pointerId);
  };

  // 拖拽中
  const handlePointerMove = (e: React.PointerEvent) => {
    if (!dragging) return;
    const dx = e.clientX - dragStart.current.x;
    const dy = e.clientY - dragStart.current.y;
    const next = clampOffset(dragStart.current.offsetX + dx, dragStart.current.offsetY + dy);
    setCurrent((s) => ({ ...s, offset: next }));
  };

  // 拖拽结束
  const handlePointerUp = (e: React.PointerEvent) => {
    setDragging(false);
    try {
      (e.target as Element).releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  };

  // 滚轮缩放：用 ref 保存最新的 state 与回调，避免 native listener 频繁重绑
  const wheelStateRef = useRef({ current, clampOffset, setCurrent });
  useEffect(() => {
    wheelStateRef.current = { current, clampOffset, setCurrent };
  }, [current, clampOffset, setCurrent]);

  // 用原生 addEventListener 注册 wheel，并显式声明 { passive: false } 以便 preventDefault 生效
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const { current: c, clampOffset: clamp, setCurrent: set } = wheelStateRef.current;
      const delta = -e.deltaY * 0.002;
      const newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, c.zoom + delta));
      const next = clamp(c.offset.x, c.offset.y);
      set((s) => ({ ...s, zoom: newZoom, offset: next }));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  // 生成圆形裁剪图（透明背景 PNG）
  const generateCircleCrop = useCallback((): string => {
    if (!naturalSize.w || !naturalSize.h) return '';
    const scale = circleState.fitScale * circleState.zoom;
    const canvas = document.createElement('canvas');
    canvas.width = CIRCLE_OUTPUT;
    canvas.height = CIRCLE_OUTPUT;
    const ctx = canvas.getContext('2d');
    if (!ctx) return '';

    const displayW = naturalSize.w * scale;
    const displayH = naturalSize.h * scale;
    const imgLeftInContainer = (CIRCLE_CONTAINER - displayW) / 2 + circleState.offset.x;
    const imgTopInContainer = (CIRCLE_CONTAINER - displayH) / 2 + circleState.offset.y;
    const sourceX = -imgLeftInContainer / scale;
    const sourceY = -imgTopInContainer / scale;
    const sourceSize = CIRCLE_CONTAINER / scale;

    ctx.save();
    ctx.beginPath();
    ctx.arc(CIRCLE_OUTPUT / 2, CIRCLE_OUTPUT / 2, CIRCLE_OUTPUT / 2, 0, Math.PI * 2);
    ctx.closePath();
    ctx.clip();

    if (imgRef.current) {
      ctx.drawImage(
        imgRef.current,
        sourceX,
        sourceY,
        sourceSize,
        sourceSize,
        0,
        0,
        CIRCLE_OUTPUT,
        CIRCLE_OUTPUT
      );
    }
    ctx.restore();
    return canvas.toDataURL('image/png');
  }, [naturalSize, circleState]);

  // 生成矩形裁剪图（JPG）
  const generateRectCrop = useCallback((): string => {
    if (!naturalSize.w || !naturalSize.h) return '';
    const scale = rectState.fitScale * rectState.zoom;
    const canvas = document.createElement('canvas');
    canvas.width = RECT_OUTPUT_W;
    canvas.height = RECT_OUTPUT_H;
    const ctx = canvas.getContext('2d');
    if (!ctx) return '';

    const displayW = naturalSize.w * scale;
    const displayH = naturalSize.h * scale;
    const imgLeftInContainer = (RECT_CONTAINER_W - displayW) / 2 + rectState.offset.x;
    const imgTopInContainer = (RECT_CONTAINER_H - displayH) / 2 + rectState.offset.y;
    const sourceX = -imgLeftInContainer / scale;
    const sourceY = -imgTopInContainer / scale;
    const sourceW = RECT_CONTAINER_W / scale;
    const sourceH = RECT_CONTAINER_H / scale;

    if (imgRef.current) {
      ctx.drawImage(
        imgRef.current,
        sourceX,
        sourceY,
        sourceW,
        sourceH,
        0,
        0,
        RECT_OUTPUT_W,
        RECT_OUTPUT_H
      );
    }
    return canvas.toDataURL('image/jpeg', 0.98);
  }, [naturalSize, rectState]);

  const localInputRef = useRef<HTMLInputElement | null>(null);

  const handleSave = () => {
    const circleDataUrl = generateCircleCrop();
    const rectDataUrl = generateRectCrop();
    if (circleDataUrl && rectDataUrl) {
      onSave(circleDataUrl, rectDataUrl, originalSource || undefined);
    }
  };

  // 选择本地文件并作为裁剪源
  const handleLocalUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = reader.result as string;
      setOriginalSource(base64);
      setCurrentImageSrc(base64);
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const handleLocalUploadClick = () => {
    localInputRef.current?.click();
  };

  // 直接在 Modal 内部同步另一张图的原图
  const handleSyncImage = () => {
    if (!syncSourceImage) return;
    setOriginalSource(syncSourceImage);
    setCurrentImageSrc(syncSourceImage.startsWith('data:') ? syncSourceImage : convertLocalSrc(syncSourceImage));
  };

  const handleZoomChange = (val: number) => {
    const next = clampOffset(current.offset.x, current.offset.y);
    setCurrent((s) => ({ ...s, zoom: val, offset: next }));
  };

  const handleReset = () => {
    setCurrent((s) => ({ ...s, zoom: 1, offset: { x: 0, y: 0 } }));
  };

  // 预览
  const previewCircleSrc = generateCircleCrop();
  const previewRectSrc = generateRectCrop();

  // 当前 Tab 的图片显示参数
  const displayW = naturalSize.w * actualScale;
  const displayH = naturalSize.h * actualScale;
  const imgLeft = (containerW - displayW) / 2 + current.offset.x;
  const imgTop = (containerH - displayH) / 2 + current.offset.y;

  return (
    <div className="avatar-crop-overlay" onClick={onClose}>
      <div className="avatar-crop-modal" onClick={(e) => e.stopPropagation()}>
        <div className="avatar-crop-modal-header">
          <h3>{activeTab === 'circle' ? '选取圆形头像' : '选取形象大图'}</h3>
          <button type="button" className="avatar-crop-close-btn" onClick={onClose}>
            ×
          </button>
        </div>

        <div className="avatar-crop-body">
          <div className="avatar-crop-left">
            <div
              ref={containerRef}
              className={`avatar-crop-container ${activeTab === 'circle' ? 'is-circle' : 'is-rect'}`}
              style={{ width: containerW, height: containerH }}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={handlePointerUp}
            >
              {naturalSize.w > 0 && (
                <img
                  ref={imgRef}
                  src={currentImageSrc}
                  alt="待裁剪"
                  className="avatar-crop-image"
                  crossOrigin="anonymous"
                  style={{
                    width: displayW,
                    height: displayH,
                    left: imgLeft,
                    top: imgTop,
                  }}
                  draggable={false}
                />
              )}
              {/* 裁剪框遮罩 + 边框 */}
              <div className="avatar-crop-overlay-mask" />
              {activeTab === 'circle' ? (
                <div
                  className="avatar-crop-circle-frame"
                  style={{ width: CIRCLE_CONTAINER, height: CIRCLE_CONTAINER }}
                />
              ) : (
                <div
                  className="avatar-crop-rect-frame"
                  style={{ width: RECT_CONTAINER_W, height: RECT_CONTAINER_H }}
                />
              )}
              <div className="avatar-crop-hint">拖动调整位置 · 滚轮缩放</div>
            </div>

            <div className="avatar-crop-controls" style={{ width: containerW }}>
              <span className="avatar-crop-zoom-label">缩放</span>
              <input
                type="range"
                min={MIN_ZOOM}
                max={MAX_ZOOM}
                step={0.05}
                value={current.zoom}
                onChange={(e) => handleZoomChange(parseFloat(e.target.value))}
              />
              <span className="avatar-crop-zoom-value">{current.zoom.toFixed(2)}x</span>
              <button type="button" className="avatar-crop-reset-btn" onClick={handleReset}>
                重置
              </button>
            </div>
          </div>

          <div className="avatar-crop-right">
            {activeTab === 'circle' ? (
              <div className="avatar-crop-preview-section">
                <div className="avatar-crop-preview-title">家谱树头像（圆形）</div>
                <div className="avatar-crop-preview-circle">
                  {previewCircleSrc && <img src={previewCircleSrc} alt="圆形头像预览" />}
                </div>
                <div className="avatar-crop-preview-desc">
                  用于家谱树、人员列表中的圆形头像显示
                </div>
              </div>
            ) : (
              <div className="avatar-crop-preview-section">
                <div className="avatar-crop-preview-title">个人信息页大图（4:5）</div>
                <div className="avatar-crop-preview-rect">
                  {previewRectSrc && <img src={previewRectSrc} alt="形象大图预览" />}
                </div>
                <div className="avatar-crop-preview-desc">
                  用于个人信息页顶部大海报展示，可独立选取裁剪区域
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="avatar-crop-footer">
          {/* 隐藏的本地选图 input */}
          <input
            type="file"
            ref={localInputRef}
            onChange={handleLocalUpload}
            accept="image/*"
            style={{ display: 'none' }}
          />

          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={handleLocalUploadClick}
            title="从本地电脑上传一张新照片"
          >
            📂 选择本地照片
          </button>

          {syncSourceImage && (
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              style={{ marginRight: 'auto', marginLeft: '8px' }}
              onClick={handleSyncImage}
              title="直接拉取另一侧的照片进行裁剪，实现快捷同步"
            >
              🔄 同步已有照片
            </button>
          )}
          
          <button type="button" className="btn btn-secondary btn-sm" style={{ marginLeft: syncSourceImage ? '0' : 'auto' }} onClick={onClose}>
            取消
          </button>
          <button type="button" className="btn btn-primary btn-sm" onClick={handleSave}>
            确认保存
          </button>
        </div>
      </div>
    </div>
  );
}
