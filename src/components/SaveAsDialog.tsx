import { useEffect, useState } from 'react';
import type { RenderScale, ImageExportResult } from '../utils/imageExport';

// 以苒纪 — 另存为弹窗（左选格式，右看详情）
//
// 左侧为三个导出类别：YRJ 档案 / 图片（JPG·PNG）/ HTML 网页；
// 右侧为对应详情面板：格式子选项（图片类）、渲染倍率、默认文件名预览与保存按钮。

export type ExportCategory = 'yrj' | 'image' | 'html';
export type ExportFormat = 'yrj' | 'jpg' | 'png' | 'html';

export type NotifyFn = (text: string, type: 'success' | 'error' | 'info') => void;

interface SaveAsDialogProps {
  open: boolean;
  familyName: string;
  onClose: () => void;
  /** YRJ 档案导出（复用 store 的 saveProjectAs），返回是否成功 */
  onExportYrj: () => Promise<boolean>;
  /** 图片导出（MainLayout 负责确保画布就绪），返回保存结果 */
  onExportImage: (format: 'jpg' | 'png', renderScale: RenderScale) => Promise<ImageExportResult>;
  /** HTML 导出，返回保存结果 */
  onExportHtml: () => Promise<'saved' | 'cancelled'>;
  /** 结果通知（toast 由父组件渲染） */
  notify: NotifyFn;
}

const CATEGORY_OPTIONS: Array<{
  id: ExportCategory;
  icon: string;
  title: string;
  brief: string;
}> = [
  { id: 'yrj', icon: '🗂️', title: 'YRJ 档案', brief: '完整家谱档案' },
  { id: 'image', icon: '🖼️', title: '图片', brief: 'JPG · PNG' },
  { id: 'html', icon: '🌐', title: 'HTML 网页', brief: '矢量清晰可搜索' },
];

const CATEGORY_DETAILS: Record<
  ExportCategory,
  { title: string; desc: string }
> = {
  yrj: {
    title: 'YRJ 档案',
    desc: '打包全部人员信息与照片为单个加密档案文件，可再次打开编辑，适合长期保存与迁移。',
  },
  image: {
    title: '图片',
    desc: '将整棵家谱树渲染为一张高清大图，适合发朋友圈、微信群或插入文档。',
  },
  html: {
    title: 'HTML 网页',
    desc: '单文件网页，双击即可在浏览器打开。文字为矢量渲染，放大不模糊，可搜索可复制。',
  },
};

const IMAGE_FORMAT_INFO: Record<'jpg' | 'png', { label: string; desc: string }> = {
  jpg: { label: 'JPG', desc: '智能压缩，体积小巧便于分享' },
  png: { label: 'PNG', desc: '无损画质，细节完整不失真' },
};

const SCALE_OPTIONS: RenderScale[] = [1, 2, 3, 4];

export default function SaveAsDialog({
  open,
  familyName,
  onClose,
  onExportYrj,
  onExportImage,
  onExportHtml,
  notify,
}: SaveAsDialogProps) {
  const [category, setCategory] = useState<ExportCategory>('yrj');
  const [imageFormat, setImageFormat] = useState<'jpg' | 'png'>('jpg');
  const [renderScale, setRenderScale] = useState<RenderScale>(2);
  const [isExporting, setIsExporting] = useState(false);

  // 每次打开时重置选择状态
  useEffect(() => {
    if (open) {
      setCategory('yrj');
      setImageFormat('jpg');
      setRenderScale(2);
      setIsExporting(false);
    }
  }, [open]);

  if (!open) return null;

  const detail = CATEGORY_DETAILS[category];
  const isImage = category === 'image';

  const confirmLabel =
    category === 'yrj'
      ? '保存档案'
      : isImage
        ? `保存为 ${IMAGE_FORMAT_INFO[imageFormat].label}`
        : '保存网页';

  const handleConfirm = async () => {
    if (isExporting) return;
    setIsExporting(true);

    try {
      if (category === 'yrj') {
        const ok = await onExportYrj();
        if (!ok) return;
        notify('YRJ 档案已成功导出！', 'success');
        onClose();
      } else if (isImage) {
        const result = await onExportImage(imageFormat, renderScale);
        if (result.status === 'cancelled') return;
        if (result.warning) {
          notify(result.warning, 'info');
        }
        notify(
          `家谱图 ${imageFormat.toUpperCase()} 已成功导出！${result.warning ? '（倍率已自动调整）' : ''}`,
          'success'
        );
        onClose();
      } else {
        const result = await onExportHtml();
        if (result === 'cancelled') return;
        notify('家谱图 HTML 网页已成功导出！', 'success');
        onClose();
      }
    } catch (err) {
      console.error('导出失败:', err);
      notify(`导出失败：${(err as Error)?.message || '未知错误'}`, 'error');
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="saveas-overlay" onClick={() => !isExporting && onClose()}>
      <div className="saveas-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="saveas-header">
          <div className="saveas-title">另存为</div>
          <div className="saveas-subtitle">{familyName}</div>
        </div>
        <div className="saveas-body">
          {/* 左侧：类别选择 */}
          <nav className="saveas-category-list">
            {CATEGORY_OPTIONS.map((opt) => (
              <button
                key={opt.id}
                type="button"
                className={`saveas-category-item ${category === opt.id ? 'selected' : ''}`}
                onClick={() => setCategory(opt.id)}
                disabled={isExporting}
              >
                <span className="saveas-category-icon">{opt.icon}</span>
                <span className="saveas-category-info">
                  <span className="saveas-category-title">{opt.title}</span>
                  <span className="saveas-category-brief">{opt.brief}</span>
                </span>
              </button>
            ))}
          </nav>

          {/* 右侧：详情面板 */}
          <div className="saveas-detail">
            <div className="saveas-detail-header">
              <div className="saveas-detail-title">{detail.title}</div>
              <div className="saveas-detail-desc">{detail.desc}</div>
            </div>

            {isImage && (
              <>
                {/* 图片格式子选项：JPG / PNG */}
                <div className="saveas-image-formats">
                  {(['jpg', 'png'] as const).map((f) => (
                    <button
                      key={f}
                      type="button"
                      className={`saveas-image-format ${imageFormat === f ? 'selected' : ''}`}
                      onClick={() => setImageFormat(f)}
                      disabled={isExporting}
                    >
                      <span className="saveas-image-format-label">
                        {IMAGE_FORMAT_INFO[f].label}
                      </span>
                      <span className="saveas-image-format-desc">
                        {IMAGE_FORMAT_INFO[f].desc}
                      </span>
                    </button>
                  ))}
                </div>

                {/* 渲染倍率 */}
                <div className="saveas-scale-row">
                  <span className="saveas-scale-label">渲染倍率</span>
                  <div className="saveas-scale-options">
                    {SCALE_OPTIONS.map((s) => (
                      <button
                        key={s}
                        type="button"
                        className={`saveas-scale-option ${renderScale === s ? 'selected' : ''}`}
                        onClick={() => setRenderScale(s)}
                        disabled={isExporting}
                      >
                        {s}x
                        {s === 2 && <em className="saveas-scale-tag">推荐</em>}
                      </button>
                    ))}
                  </div>
                  <span className="saveas-scale-hint">倍率越高越清晰，文件也越大</span>
                </div>
              </>
            )}

            {/* 保存按钮 */}
            <div className="saveas-footer">
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={onClose}
                disabled={isExporting}
              >
                取消
              </button>
              <button
                type="button"
                className="btn btn-primary btn-sm saveas-confirm-btn"
                onClick={handleConfirm}
                disabled={isExporting}
              >
                {isExporting ? '⏳ 导出中…' : confirmLabel}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
