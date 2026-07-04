import { useState, useRef, useEffect, useCallback } from 'react';
import { lockBodyScroll } from '../utils/bodyScrollLock';
import './AvatarCropModal.css';

interface AvatarCropModalProps {
  imageSrc: string;
  onClose: () => void;
  onSave: (circleDataUrl: string, rectDataUrl: string) => void;
}

// 圆形裁剪：正方形容器
const CIRCLE_CONTAINER = 320;
const CIRCLE_OUTPUT = 256;
// 矩形裁剪：4:5 竖向容器（适配个人信息页头像比例）
const RECT_CONTAINER_W = 256;
const RECT_CONTAINER_H = 320;
const RECT_OUTPUT_W = 320;
const RECT_OUTPUT_H = 400;

const MIN_ZOOM = 1;
const MAX_ZOOM = 4;

type CropTab = 'circle' | 'rect';

interface CropState {
  offset: { x: number; y: number };
  zoom: number;
  fitScale: number;
}

export default function AvatarCropModal({ imageSrc, onClose, onSave }: AvatarCropModalProps) {
  const imgRef = useRef<HTMLImageElement | null>(null);

  // 图片原始尺寸
  const [naturalSize, setNaturalSize] = useState({ w: 0, h: 0 });

  // 当前激活的裁剪 Tab
  const [activeTab, setActiveTab] = useState<CropTab>('circle');

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
    img.src = imageSrc;
  }, [imageSrc]);

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

  // 滚轮缩放
  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const delta = -e.deltaY * 0.002;
    const newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, current.zoom + delta));
    const next = clampOffset(current.offset.x, current.offset.y);
    setCurrent((s) => ({ ...s, zoom: newZoom, offset: next }));
  };

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
    return canvas.toDataURL('image/jpeg', 0.92);
  }, [naturalSize, rectState]);

  const handleSave = () => {
    const circleDataUrl = generateCircleCrop();
    const rectDataUrl = generateRectCrop();
    if (circleDataUrl && rectDataUrl) {
      onSave(circleDataUrl, rectDataUrl);
    } else if (circleDataUrl) {
      onSave(circleDataUrl, imageSrc);
    }
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
          <h3>选取头像</h3>
          <button type="button" className="avatar-crop-close-btn" onClick={onClose}>
            ×
          </button>
        </div>

        <div className="avatar-crop-tabs">
          <button
            type="button"
            className={`avatar-crop-tab ${activeTab === 'circle' ? 'active' : ''}`}
            onClick={() => setActiveTab('circle')}
          >
            圆形头像 · 家谱树
          </button>
          <button
            type="button"
            className={`avatar-crop-tab ${activeTab === 'rect' ? 'active' : ''}`}
            onClick={() => setActiveTab('rect')}
          >
            矩形头像 · 个人信息页
          </button>
        </div>

        <div className="avatar-crop-body">
          <div className="avatar-crop-left">
            <div
              className={`avatar-crop-container ${activeTab === 'circle' ? 'is-circle' : 'is-rect'}`}
              style={{ width: containerW, height: containerH }}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={handlePointerUp}
              onWheel={handleWheel}
            >
              {naturalSize.w > 0 && (
                <img
                  ref={imgRef}
                  src={imageSrc}
                  alt="待裁剪"
                  className="avatar-crop-image"
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
            <div className="avatar-crop-preview-section">
              <div className="avatar-crop-preview-title">家谱树头像（圆形）</div>
              <div className="avatar-crop-preview-circle">
                {previewCircleSrc && <img src={previewCircleSrc} alt="圆形头像预览" />}
              </div>
              <div className="avatar-crop-preview-desc">
                用于家谱树、人员列表中的圆形头像显示
              </div>
            </div>

            <div className="avatar-crop-preview-section">
              <div className="avatar-crop-preview-title">个人信息页头像（矩形 4:5）</div>
              <div className="avatar-crop-preview-rect">
                {previewRectSrc && <img src={previewRectSrc} alt="矩形头像预览" />}
              </div>
              <div className="avatar-crop-preview-desc">
                用于个人信息页左侧整图显示，可独立选取区域
              </div>
            </div>
          </div>
        </div>

        <div className="avatar-crop-footer">
          <button type="button" className="btn btn-secondary btn-sm" onClick={onClose}>
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
