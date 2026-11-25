import type { ReactNode } from 'react'

type PageHeaderProps = {
  title: string
  description?: string
  actions?: ReactNode
  eyebrow?: string
}

/** V3 统一页面头：所有使用 PageHeader 的二级页自动进入同一空间层级。 */
export function PageHeader({ title, description, actions, eyebrow }: PageHeaderProps) {
  return (
    <header className="rc-page-header" data-rc-page-header>
      <div className="min-w-0">
        {eyebrow && <p className="rc-page-header__eyebrow">{eyebrow}</p>}
        <h2 className="rc-page-header__title">{title}</h2>
        {description && <p className="rc-page-header__desc">{description}</p>}
      </div>
      {actions && <div className="rc-page-header__actions">{actions}</div>}
    </header>
  )
}
