import { create } from 'zustand';

// 以苒纪 — 更新弹窗全局状态
//
// 发现新版本时打开弹窗；启动静默检查与设置页手动检查共用，
// 弹窗组件挂载在 App 根层，任何页面触发均可弹出。

interface UpdateDialogState {
  open: boolean;
  latestVersion: string;
  openUpdateDialog: (latestVersion: string) => void;
  closeUpdateDialog: () => void;
}

export const useUpdateStore = create<UpdateDialogState>((set) => ({
  open: false,
  latestVersion: '',
  openUpdateDialog: (latestVersion) => set({ open: true, latestVersion }),
  closeUpdateDialog: () => set({ open: false }),
}));
