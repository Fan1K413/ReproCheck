import { Compass, Home, SearchX } from 'lucide-react'
import { Link } from 'react-router-dom'
import { PageHeader } from '../components/PageHeader'

/**
 * 未知路径兜底：不静默重定向，明确告诉用户目标路由不存在，并提供两个真实可达出口。
 * 不使用静态效果图或伪造搜索数据；仅展示路由层事实。
 */
export default function NotFoundPage() {
  return (
    <div className="rcw-page">
      <PageHeader
        eyebrow="页面不存在"
        title="没有找到这条审计路径"
        description="该地址不属于 ReproCheck 的 38 条核心科研路由；链接可能已失效、拼写有误，或来自旧版界面。"
      />

      <section className="rcw-card rcw-card-glass" style={{ overflow: 'hidden', position: 'relative' }}>
        <span
          aria-hidden="true"
          className="mono"
          style={{
            position: 'absolute',
            right: 26,
            top: 8,
            fontSize: 'clamp(54px, 11vw, 128px)',
            lineHeight: 1,
            fontWeight: 700,
            color: 'var(--rc-watermark)',
            letterSpacing: '-0.06em',
            pointerEvents: 'none',
          }}
        >
          404
        </span>
        <div className="rcw-stack" style={{ position: 'relative', zIndex: 1, maxWidth: 680 }}>
          <div className="rcw-row" style={{ gap: 'var(--rc-space-3)', alignItems: 'flex-start' }}>
            <span className="rcw-kpi-icon" aria-hidden="true">
              <SearchX size={22} />
            </span>
            <div>
              <p className="text-base font-semibold">这条路由没有对应页面</p>
              <p className="mt-1 text-sm leading-relaxed rcw-muted">
                系统没有用空白页或首页内容伪装成功。你可以回到根工作台重新选择真实业务入口，或进入项目档案继续已有审计。
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3" style={{ marginTop: 'var(--rc-space-2)' }}>
            <Link to="/" className="btn-primary">
              <Home size={16} />返回根工作台
            </Link>
            <Link to="/projects" className="btn-ghost">
              <Compass size={16} />进入项目档案
            </Link>
          </div>

          <p className="mono text-[11px] rcw-faint" style={{ marginTop: 'var(--rc-space-2)' }}>
            错误类型：ROUTE_NOT_FOUND · 未发起任何数据写入
          </p>
        </div>
      </section>
    </div>
  )
}
