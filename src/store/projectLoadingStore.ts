import { create } from 'zustand';

/**
 * 打开档案时的载入阶段。
 * 解包 .yrj（尤其是媒体较多时）需要数秒，必须给用户可见的进度反馈。
 */
export type ProjectLoadStage =
  | 'open'
  | 'check'
  | 'install'
  | 'unpack'
  | 'load'
  | 'prepare'
  | 'save';

export const PROJECT_LOAD_STAGE_LABEL: Record<ProjectLoadStage, string> = {
  open: '正在载入家谱档案…',
  check: '正在检查档案…',
  install: '正在准备示例家谱…',
  unpack: '正在解压档案与媒体…',
  load: '正在读取家谱数据…',
  prepare: '正在整理媒体与人物关系…',
  save: '正在写入整理后的数据…',
};

interface ProjectLoadingState {
  visible: boolean;
  stage: ProjectLoadStage;
  /** 正在打开的档案路径或名称，用于让用户确认打开的是哪个文件 */
  detail: string;
  startedAt: number;
  begin: (detail: string, stage?: ProjectLoadStage) => void;
  setStage: (stage: ProjectLoadStage) => void;
  end: (immediate?: boolean) => void;
}

/** 载入画面至少停留这么久，避免小档案一闪而过造成闪烁 */
const MIN_VISIBLE_MS = 420;

let hideTimer: number | null = null;

function clearHideTimer() {
  if (hideTimer !== null) {
    window.clearTimeout(hideTimer);
    hideTimer = null;
  }
}

export const useProjectLoadingStore = create<ProjectLoadingState>((set, get) => ({
  visible: false,
  stage: 'open',
  detail: '',
  startedAt: 0,

  begin: (detail, stage = 'open') => {
    clearHideTimer();
    set({ visible: true, stage, detail, startedAt: Date.now() });
  },

  setStage: (stage) => {
    if (!get().visible) return;
    set({ stage });
  },

  end: (immediate = false) => {
    const { visible, startedAt } = get();
    if (!visible) return;
    clearHideTimer();
    const hide = () => set({ visible: false, detail: '' });
    if (immediate) {
      hide();
      return;
    }
    const remain = MIN_VISIBLE_MS - (Date.now() - startedAt);
    if (remain > 0) {
      hideTimer = window.setTimeout(hide, remain);
    } else {
      hide();
    }
  },
}));

/** 等待浏览器把载入画面真正绘制出来，再开始可能耗时的原生调用 */
function waitForPaint(): Promise<void> {
  return new Promise<void>((resolve) => {
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    requestAnimationFrame(() => requestAnimationFrame(done));
    // 窗口被遮挡等情况下 rAF 可能不触发，兜底避免永久等待
    window.setTimeout(done, 120);
  });
}

/** 显示载入画面并等待其完成绘制 */
export async function beginProjectLoad(
  detail: string,
  stage: ProjectLoadStage = 'open'
): Promise<void> {
  useProjectLoadingStore.getState().begin(detail, stage);
  await waitForPaint();
}

/** 关闭载入画面；immediate 用于紧接着要弹出密码框等需要立刻切换界面的场景 */
export function endProjectLoad(immediate = false): void {
  useProjectLoadingStore.getState().end(immediate);
}
