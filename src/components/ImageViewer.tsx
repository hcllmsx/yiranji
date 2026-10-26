// 以苒纪 — 通用图片查看器
// 任意图片都可以丢进来全屏查看：滚轮/按钮缩放、拖拽平移、双击放大、旋转、
// 多图左右切换（含缩略图条）、键盘快捷键、移动端双指缩放。
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { lockBodyScroll } from '../utils/bodyScrollLock';
import './ImageViewer.css';

export interface ViewerImage {
  /** 可直接用于 <img src> 的地址（本地文件请先经 convertLocalSrc 转换） */
  src: string;
  /** 图片下方的标题/备注 */
  caption?: string;
  /** 附加信息，如拍摄日期、年龄 */
  meta?: string;
  alt?: string;
}

export interface ImageViewerProps {
  images: ViewerImage[];
  /** 打开时显示第几张（默认 0） */
  startIndex?: number;
  onClose: () => void;
  /** 提供后，工具栏会出现「编辑备注」按钮 */
  onEditNote?: (index: number) => void;
  editNoteLabel?: string;
  /** 左上角标题，默认取当前图片的 caption */
  title?: string;
}

const MIN_ZOOM = 0.2;
const MAX_ZOOM = 8;
const ZOOM_STEP = 1.25;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export default function ImageViewer({
  images,
  startIndex = 0,
  onClose,
  onEditNote,
  editNoteLabel = '编辑备注',
  title,
}: ImageViewerProps) {
  const safeImages = images.filter((item) => !!item?.src);
  const total = safeImages.length;

  const [index, setIndex] = useState(() =>
    clamp(startIndex, 0, Math.max(0, safeImages.length - 1))
  );
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [rotation, setRotation] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);

  const stageRef = useRef<HTMLDivElement | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const thumbRefs = useRef<Array<HTMLButtonElement | null>>([]);

  // 变换的"真值"放在 ref 里：滚轮 / 双指连续触发时避免读到过期 state，
  // 也避免在 setState 的更新函数里再调用另一个 setState。
  const zoomRef = useRef(1);
  const offsetRef = useRef({ x: 0, y: 0 });

  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const dragRef = useRef<{
    startX: number;
    startY: number;
    originX: number;
    originY: number;
  } | null>(null);
  const pinchRef = useRef<{
    distance: number;
    zoom: number;
    centerX: number;
    centerY: number;
    offsetX: number;
    offsetY: number;
  } | null>(null);
  const movedRef = useRef(false);

  const current = safeImages[clamp(index, 0, Math.max(0, total - 1))];

  // 锁定背景滚动（支持嵌套模态）
  useEffect(() => lockBodyScroll(), []);


  const clampOffset = useCallback((x: number, y: number, scale: number) => {
    const stage = stageRef.current;
    const img = imgRef.current;
    if (!stage || !img) return { x, y };
    const maxX = Math.max(0, (img.offsetWidth * scale - stage.clientWidth) / 2) + 48;
    const maxY = Math.max(0, (img.offsetHeight * scale - stage.clientHeight) / 2) + 48;
    return { x: clamp(x, -maxX, maxX), y: clamp(y, -maxY, maxY) };
  }, []);

  const applyTransform = useCallback((nextZoom: number, nextOffset: { x: number; y: number }) => {
    zoomRef.current = nextZoom;
    offsetRef.current = nextOffset;
    setZoom(nextZoom);
    setOffset(nextOffset);
  }, []);

  const setPan = useCallback(
    (x: number, y: number) => {
      const next = clampOffset(x, y, zoomRef.current);
      offsetRef.current = next;
      setOffset(next);
    },
    [clampOffset]
  );

  /** 以 stage 中心为原点缩放；anchor 为缩放锚点（相对中心） */
  const zoomTo = useCallback(
    (nextZoom: number, anchor?: { x: number; y: number }) => {
      const target = clamp(nextZoom, MIN_ZOOM, MAX_ZOOM);
      const prevZoom = zoomRef.current;
      if (Math.abs(target - prevZoom) < 0.0001) return;
      const prev = offsetRef.current;
      const a = anchor ?? { x: 0, y: 0 };
      const ratio = target / prevZoom;
      applyTransform(
        target,
        clampOffset(a.x - ratio * (a.x - prev.x), a.y - ratio * (a.y - prev.y), target)
      );
    },
    [applyTransform, clampOffset]
  );

  const resetTransform = useCallback(() => {
    setRotation(0);
    applyTransform(1, { x: 0, y: 0 });
  }, [applyTransform]);

  const rotate = useCallback(() => {
    setRotation((prev) => (prev + 90) % 360);
    applyTransform(zoomRef.current, { x: 0, y: 0 });
  }, [applyTransform]);

  const handleImageLoad = useCallback(() => setLoaded(true), []);
  const handleImageError = useCallback(() => setFailed(true), []);

  const goTo = useCallback(
    (nextIndex: number) => {
      if (total === 0) return;
      setIndex(((nextIndex % total) + total) % total);
    },
    [total]
  );

  // 切图时复位，并接管图片加载状态：
  // data URI / 缓存图的 load 事件可能在 React 挂上 onLoad 监听前就同步触发（探针实测会漏），
  // 所以复位之后立刻用原生 complete 检查 + 原生事件监听兜底。
  useEffect(() => {
    setLoaded(false);
    setFailed(false);
    setRotation(0);
    applyTransform(1, { x: 0, y: 0 });

    const img = imgRef.current;
    if (!img) return;
    const settle = () => {
      if (img.naturalWidth === 0) {
        setFailed(true);
      } else {
        setLoaded(true);
      }
    };
    if (img.complete) {
      settle();
      return;
    }
    img.addEventListener('load', settle);
    img.addEventListener('error', settle);
    return () => {
      img.removeEventListener('load', settle);
      img.removeEventListener('error', settle);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index]);

  // 缩略图跟随当前项
  useEffect(() => {
    thumbRefs.current[index]?.scrollIntoView({ block: 'nearest', inline: 'center' });
  }, [index]);

  // 键盘
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const key = e.key;
      if (key === 'Escape') {
        e.preventDefault();
        onClose();
      } else if (key === 'ArrowLeft') {
        e.preventDefault();
        goTo(index - 1);
      } else if (key === 'ArrowRight') {
        e.preventDefault();
        goTo(index + 1);
      } else if (key === '+' || key === '=') {
        e.preventDefault();
        zoomTo(zoomRef.current * ZOOM_STEP);
      } else if (key === '-' || key === '_') {
        e.preventDefault();
        zoomTo(zoomRef.current / ZOOM_STEP);
      } else if (key === '0') {
        e.preventDefault();
        resetTransform();
      } else if (key === 'r' || key === 'R') {
        e.preventDefault();
        rotate();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [index, goTo, onClose, resetTransform, rotate, zoomTo]);

  // 滚轮缩放（需要 passive: false 才能阻止页面滚动）
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = stage.getBoundingClientRect();
      const anchor = {
        x: e.clientX - rect.left - rect.width / 2,
        y: e.clientY - rect.top - rect.height / 2,
      };
      const factor = Math.exp(-e.deltaY * 0.0016);
      zoomTo(zoomRef.current * factor, anchor);
    };
    stage.addEventListener('wheel', onWheel, { passive: false });
    return () => stage.removeEventListener('wheel', onWheel);
  }, [zoomTo]);

  // ---------- 指针：拖拽 / 双指缩放 ----------
  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    const stage = stageRef.current;
    if (!stage) return;
    stage.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    movedRef.current = false;

    if (pointers.current.size === 1) {
      dragRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        originX: offsetRef.current.x,
        originY: offsetRef.current.y,
      };
      setDragging(true);
    } else if (pointers.current.size === 2) {
      const [p1, p2] = Array.from(pointers.current.values());
      const rect = stage.getBoundingClientRect();
      pinchRef.current = {
        distance: Math.hypot(p1.x - p2.x, p1.y - p2.y) || 1,
        zoom: zoomRef.current,
        centerX: (p1.x + p2.x) / 2 - rect.left - rect.width / 2,
        centerY: (p1.y + p2.y) / 2 - rect.top - rect.height / 2,
        offsetX: offsetRef.current.x,
        offsetY: offsetRef.current.y,
      };
      dragRef.current = null;
    }
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointers.current.size === 2 && pinchRef.current) {
      const [p1, p2] = Array.from(pointers.current.values());
      const distance = Math.hypot(p1.x - p2.x, p1.y - p2.y) || 1;
      const info = pinchRef.current;
      const target = clamp((info.zoom * distance) / info.distance, MIN_ZOOM, MAX_ZOOM);
      const ratio = target / info.zoom;
      const rect = stageRef.current?.getBoundingClientRect();
      const centerX = rect ? (p1.x + p2.x) / 2 - rect.left - rect.width / 2 : info.centerX;
      const centerY = rect ? (p1.y + p2.y) / 2 - rect.top - rect.height / 2 : info.centerY;
      applyTransform(
        target,
        clampOffset(
          centerX - ratio * (info.centerX - info.offsetX),
          centerY - ratio * (info.centerY - info.offsetY),
          target
        )
      );
      movedRef.current = true;
      return;
    }

    const drag = dragRef.current;
    if (!drag) return;
    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) movedRef.current = true;
    setPan(drag.originX + dx, drag.originY + dy);
  };

  const endPointer = (e: React.PointerEvent<HTMLDivElement>) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size === 0) {
      dragRef.current = null;
      pinchRef.current = null;
      setDragging(false);
    } else if (pointers.current.size === 1) {
      const [point] = Array.from(pointers.current.values());
      pinchRef.current = null;
      dragRef.current = {
        startX: point.x,
        startY: point.y,
        originX: offsetRef.current.x,
        originY: offsetRef.current.y,
      };
    }
  };

  const handleStageClick = (e: React.MouseEvent<HTMLDivElement>) => {
    // 只有点到空白处（不是图片、不是工具栏）且没有拖动过，才关闭
    if (e.target === stageRef.current && !movedRef.current) onClose();
  };

  const handleDoubleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target !== stageRef.current) return;
    if (zoomRef.current > 1.01) {
      resetTransform();
      return;
    }
    const rect = stageRef.current?.getBoundingClientRect();
    const anchor = rect
      ? { x: e.clientX - rect.left - rect.width / 2, y: e.clientY - rect.top - rect.height / 2 }
      : { x: 0, y: 0 };
    zoomTo(2.5, anchor);
  };

  if (total === 0) return null;

  const caption = current?.caption || '';
  const meta = current?.meta || '';
  const heading = title || caption || '图片查看';

  return createPortal(
    <div className="iv-overlay" role="dialog" aria-modal="true" aria-label="图片查看器">
      <div className="iv-topbar">
        <div className="iv-heading">
          <span className="iv-title">{heading}</span>
          {total > 1 && (
            <span className="iv-counter">
              {index + 1} / {total}
            </span>
          )}
        </div>
        <div className="iv-topbar-actions">
          {onEditNote && (
            <button
              type="button"
              className="iv-btn iv-btn-text"
              onClick={() => onEditNote(index)}
              title={editNoteLabel}
            >
              ✎ {editNoteLabel}
            </button>
          )}
          <button type="button" className="iv-btn iv-close" onClick={onClose} aria-label="关闭">
            ×
          </button>
        </div>
      </div>

      <div
        className={`iv-stage${dragging ? ' dragging' : ''}`}
        ref={stageRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endPointer}
        onPointerCancel={endPointer}
        onClick={handleStageClick}
        onDoubleClick={handleDoubleClick}
      >
        {!loaded && !failed && <div className="iv-loading">加载中…</div>}
        {failed ? (
          <div className="iv-error">
            <div className="iv-error-icon">🖼️</div>
            <div>图片加载失败</div>
            <div className="iv-error-path">{current?.src}</div>
          </div>
        ) : (
          <img
            key={current?.src}
            ref={imgRef}
            src={current?.src}
            alt={current?.alt || caption || heading}
            className={`iv-image${loaded ? ' loaded' : ''}`}
            draggable={false}
            onLoad={handleImageLoad}
            onError={handleImageError}
            style={{
              transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom}) rotate(${rotation}deg)`,
            }}
          />
        )}
      </div>

      {total > 1 && (
        <>
          <button
            type="button"
            className="iv-nav iv-nav-prev"
            onClick={() => goTo(index - 1)}
            aria-label="上一张"
            title="上一张（←）"
          >
            ‹
          </button>
          <button
            type="button"
            className="iv-nav iv-nav-next"
            onClick={() => goTo(index + 1)}
            aria-label="下一张"
            title="下一张（→）"
          >
            ›
          </button>
        </>
      )}

      <div className="iv-bottom">
        {(caption || meta) && (
          <div className="iv-caption">
            {caption && <span className="iv-caption-text">{caption}</span>}
            {meta && <span className="iv-caption-meta">{meta}</span>}
          </div>
        )}

        {total > 1 && (
          <div className="iv-thumbs">
            {safeImages.map((item, itemIndex) => (
              <button
                key={`${item.src}-${itemIndex}`}
                type="button"
                ref={(node) => {
                  thumbRefs.current[itemIndex] = node;
                }}
                className={`iv-thumb${itemIndex === index ? ' active' : ''}`}
                onClick={() => goTo(itemIndex)}
                title={item.caption || `第 ${itemIndex + 1} 张`}
              >
                <img src={item.src} alt="" draggable={false} />
              </button>
            ))}
          </div>
        )}

        <div className="iv-controls">
          <button
            type="button"
            className="iv-btn"
            onClick={() => zoomTo(zoomRef.current / ZOOM_STEP)}
            title="缩小（-）"
            aria-label="缩小"
            disabled={zoom <= MIN_ZOOM + 0.001}
          >
            −
          </button>
          <button
            type="button"
            className="iv-zoom-label"
            onClick={resetTransform}
            title="点击恢复 100%（0）"
          >
            {Math.round(zoom * 100)}%
          </button>
          <button
            type="button"
            className="iv-btn"
            onClick={() => zoomTo(zoomRef.current * ZOOM_STEP)}
            title="放大（+）"
            aria-label="放大"
            disabled={zoom >= MAX_ZOOM - 0.001}
          >
            +
          </button>
          <span className="iv-divider" />
          <button
            type="button"
            className="iv-btn"
            onClick={resetTransform}
            title="适应窗口（0）"
            aria-label="适应窗口"
          >
            ⤢
          </button>
          <button
            type="button"
            className="iv-btn"
            onClick={rotate}
            title="旋转 90°（R）"
            aria-label="旋转"
          >
            ↻
          </button>
        </div>

        <div className="iv-hint">滚轮缩放 · 拖拽平移 · 双击放大 · ←/→ 切换 · Esc 关闭</div>
      </div>
    </div>,
    document.body
  );
}
