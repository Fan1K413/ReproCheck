import React from 'react'
import ReactDOM from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import { useAuthStore } from './stores/authStore'
import { initThemeSync } from './stores/uiStore'
// Design Token 必须最先引入：全站唯一色源（黑绿深色默认 + 类纸浅色皮肤 + 旧变量别名）
import './styles/tokens.css'
import './styles/index.css'
import './styles/motion.css'
import './styles/workbench.css'
import './styles/workbench-petals.css'
import './styles/rc-unified.css'
import './styles/usability.css'
import './styles/usability-guided.css'
import './styles/usability-model-manual.css'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
      staleTime: 60_000,
      gcTime: 10 * 60_000,
    },
  },
})

useAuthStore.subscribe((state, previous) => {
  if (state.token !== previous.token) queryClient.clear()
})

initThemeSync()

const rootElement = document.getElementById('root')
if (!rootElement) {
  throw new Error('未找到挂载节点 #root')
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>,
)
