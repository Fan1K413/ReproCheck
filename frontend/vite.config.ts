import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // 仅代理真实 API 路径（/api/v1/…）；避免前缀误吞 SPA 路由 /api-tokens
      '^/api/': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
      // 站点模式：同源 Function 桥接（dev/function-local.mjs）
      '/functions/v1/app': {
        target: 'http://127.0.0.1:8001',
        changeOrigin: true,
      },
    },
  },
})
