import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const appVersion = readFileSync(resolve(__dirname, 'VERSION'), 'utf8').trim()

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
  },
  server: {
    host: '0.0.0.0', // 绑定所有网卡，TUN 模式下也能访问
    port: 5273, // 避开 Windows Hyper-V/WSL 保留的 5150-5249 端口范围（原 5173 会报 EACCES）
    strictPort: true, // 与 tauri.conf.json 的 devUrl 保持一致，端口被占时直接报错而非递增
  },
  build: {
    // 拆分大依赖为独立 chunk，减小主 bundle 体积，配合页面级 lazy 按需加载
    rollupOptions: {
      output: {
        manualChunks: (id: string) => {
          // 只拆 node_modules 里的第三方依赖，业务代码仍由页面级 lazy 处理
          if (!id.includes('node_modules')) return undefined;
          // 家谱树渲染引擎：体积最大，只在 /tree 页面用到
          if (id.includes('@xyflow/react') || id.includes('dagre')) return 'flow';
          // 农历计算库：只在编辑/详情页用到
          if (id.includes('lunar-javascript')) return 'lunar';
          // 通用工具库
          if (id.includes('jszip') || id.includes('uuid') || id.includes('zustand')) return 'utils';
          // React 核心：react、react-dom、react-router-dom，几乎所有页面都要用
          if (id.includes('react-router') || /node_modules[/\\]react(?:-dom)?[/\\]/.test(id)) {
            return 'react-vendor';
          }
          return undefined;
        },
      },
    },
  },
})
