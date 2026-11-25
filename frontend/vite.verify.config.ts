import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// 仅用于隔离验收：把同一份源码代理到 8001 的临时后端（带临时加密钥）。
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5174,
    proxy: {
      '^/api/': {
        target: 'http://127.0.0.1:8001',
        changeOrigin: true,
      },
    },
  },
})
