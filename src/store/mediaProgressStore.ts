// 以苒纪 — 媒体文件导入进度状态管理

import { create } from 'zustand';

/** 单个导入任务的状态 */
export interface MediaImportTask {
  id: string;
  fileName: string;
  fileType: 'photo' | 'audio' | 'video' | 'avatar';
  status: 'pending' | 'processing' | 'done' | 'error';
  /** 0-100，仅用于粗略展示 */
  progress: number;
  errorMessage?: string;
  startedAt: number;
  finishedAt?: number;
}

interface MediaProgressStore {
  tasks: MediaImportTask[];
  isPanelVisible: boolean;

  startTask: (fileName: string, fileType: MediaImportTask['fileType']) => string;
  updateProgress: (id: string, progress: number) => void;
  finishTask: (id: string) => void;
  failTask: (id: string, errorMessage: string) => void;
  removeTask: (id: string) => void;
  clearFinished: () => void;
  hidePanel: () => void;
}

export const useMediaProgressStore = create<MediaProgressStore>((set, get) => ({
  tasks: [],
  isPanelVisible: false,

  startTask: (fileName, fileType) => {
    const id = `task_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    const task: MediaImportTask = {
      id,
      fileName,
      fileType,
      status: 'processing',
      progress: 10,
      startedAt: Date.now(),
    };
    set((state) => ({
      tasks: [...state.tasks, task],
      isPanelVisible: true,
    }));
    return id;
  },

  updateProgress: (id, progress) => {
    set((state) => ({
      tasks: state.tasks.map((t) =>
        t.id === id ? { ...t, progress: Math.min(99, Math.max(10, progress)) } : t
      ),
    }));
  },

  finishTask: (id) => {
    set((state) => ({
      tasks: state.tasks.map((t) =>
        t.id === id
          ? { ...t, status: 'done', progress: 100, finishedAt: Date.now() }
          : t
      ),
    }));
    // 5 秒后自动清理已完成任务
    setTimeout(() => {
      get().removeTask(id);
    }, 5000);
  },

  failTask: (id, errorMessage) => {
    set((state) => ({
      tasks: state.tasks.map((t) =>
        t.id === id
          ? { ...t, status: 'error', errorMessage, finishedAt: Date.now() }
          : t
      ),
    }));
  },

  removeTask: (id) => {
    set((state) => {
      const tasks = state.tasks.filter((t) => t.id !== id);
      return {
        tasks,
        isPanelVisible: tasks.length > 0 ? state.isPanelVisible : false,
      };
    });
  },

  clearFinished: () => {
    set((state) => ({
      tasks: state.tasks.filter((t) => t.status === 'processing' || t.status === 'pending'),
    }));
  },

  hidePanel: () => {
    set({ isPanelVisible: false });
  },
}));
