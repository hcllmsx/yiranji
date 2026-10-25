import { create } from 'zustand';
import type { ReleaseNotes } from '../utils/updateChecker';

// 以苒纪 — 更新相关弹窗全局状态
//
// 两类弹窗挂载在 App 根层，同一时间只显示一个：
// - 「发现新版本」：检查到远端有更新时弹出，启动静默检查与设置页手动检查共用；
// - 「本次更新内容」：升级后首次启动弹出，内容随安装包内置，无需联网。

interface UpdatePrompt {
  latestVersion: string;
  sourceIndex: number;
}

interface UpdateDialogState {
  open: boolean;
  latestVersion: string;
  /** 成功返回 VERSION 的源索引，用于同源拉取 release-notes.json */
  sourceIndex: number;
  /** 非空时展示「本次更新内容」弹窗 */
  whatsNewNotes: ReleaseNotes | null;
  /** 「本次更新内容」未关闭时发现的新版本，等它关闭后再弹 */
  pendingUpdate: UpdatePrompt | null;
  openUpdateDialog: (latestVersion: string, sourceIndex?: number) => void;
  closeUpdateDialog: () => void;
  openWhatsNew: (notes: ReleaseNotes) => void;
  closeWhatsNew: () => void;
}

export const useUpdateStore = create<UpdateDialogState>((set, get) => ({
  open: false,
  latestVersion: '',
  sourceIndex: 0,
  whatsNewNotes: null,
  pendingUpdate: null,

  openUpdateDialog: (latestVersion, sourceIndex = 0) => {
    if (get().whatsNewNotes) {
      set({ pendingUpdate: { latestVersion, sourceIndex } });
      return;
    }
    set({ open: true, latestVersion, sourceIndex });
  },
  closeUpdateDialog: () => set({ open: false }),

  openWhatsNew: (notes) => {
    // 「发现新版本」已经弹出时以它为先，本次更新内容不再叠一层
    if (get().open) return;
    set({ whatsNewNotes: notes });
  },
  closeWhatsNew: () => {
    const pending = get().pendingUpdate;
    if (pending) {
      set({
        whatsNewNotes: null,
        pendingUpdate: null,
        open: true,
        latestVersion: pending.latestVersion,
        sourceIndex: pending.sourceIndex,
      });
      return;
    }
    set({ whatsNewNotes: null });
  },
}));
