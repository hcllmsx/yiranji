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
})
