import { useEffect, useId, useRef, useState } from 'react'
import { BookOpen, ChevronRight, HelpCircle, X } from 'lucide-react'
import { Link, useLocation } from 'react-router-dom'
import { helpForPath } from './pageHelp'
import { Term } from './glossary'

type Props = { compact?: boolean; floating?: boolean; label?: string }

export default function PageHelpButton({ compact = false, floating = false, label = '使用帮助' }: Props) {
  const { pathname } = useLocation()
  const [open, setOpen] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const titleId = useId()
  const help = helpForPath(pathname)

  useEffect(() => setOpen(false), [pathname])

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        setOpen(false)
        triggerRef.current?.focus()
      }
    }
    document.addEventListener('keydown', onKey, true)
    window.setTimeout(() => panelRef.current?.focus(), 30)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [open])

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={`ux-help-trigger${floating ? ' ux-help-trigger--floating' : ''}`}
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`打开${help.title}使用帮助`}
        title={`${help.title}：这个功能怎么用？`}
      >
        <HelpCircle size={compact ? 17 : 18} />
        {compact ? <span className="ux-sr-only">使用帮助</span> : <span>{label}</span>}
      </button>

      {open && (
        <div className="ux-drawer-layer" role="dialog" aria-modal="true" aria-labelledby={titleId}>
          <button
            type="button"
            className="ux-drawer-scrim"
            aria-label="关闭帮助"
            onClick={() => setOpen(false)}
          />
          <aside ref={panelRef} className="ux-help-drawer" tabIndex={-1} data-rc-drawer="true">
            <header className="ux-help-drawer__head">
              <div>
                <span className="ux-eyebrow">这一页怎么用</span>
                <h2 id={titleId}>{help.title}</h2>
              </div>
              <button type="button" className="ux-icon-btn" onClick={() => setOpen(false)} aria-label="关闭帮助">
                <X size={18} />
              </button>
            </header>
            <div className="ux-help-drawer__body">
              <section className="ux-help-lead">
                <p>{help.what}</p>
                <p className="ux-help-when">什么时候用：{help.when}</p>
              </section>

              <section>
                <h3>开始前准备</h3>
                <ul className="ux-check-list">
                  {help.prepare.map((line) => <li key={line}>{line}</li>)}
                </ul>
              </section>

              <section>
                <h3>操作顺序</h3>
                <ol className="ux-step-list">
                  {help.start.map((line, index) => (
                    <li key={line}><span>{index + 1}</span><p>{line}</p></li>
                  ))}
                </ol>
              </section>

              <section className="ux-help-result">
                <h3>做完会得到什么</h3>
                <p>{help.result}</p>
              </section>

              {help.faq.length > 0 && (
                <section>
                  <h3>常见问题</h3>
                  <div className="ux-help-faq">
                    {help.faq.map((entry) => (
                      <details key={entry.q}>
                        <summary>{entry.q}</summary>
                        <p>{entry.a}</p>
                      </details>
                    ))}
                  </div>
                </section>
              )}

              <section>
                <h3>出错怎么办</h3>
                <ul className="ux-error-list">
                  {help.errors.map((line) => <li key={line}>{line}</li>)}
                </ul>
              </section>

              <section>
                <h3>本页常见术语</h3>
                <div className="ux-term-row">
                  {['paper', 'dataset', 'evidence', 'api'].map((key) => {
                    const label = key === 'paper' ? '论文' : key === 'dataset' ? '数据集' : key === 'evidence' ? '证据' : 'API'
                    return <Term key={key} name={label}>{label}</Term>
                  })}
                </div>
              </section>
            </div>
            <footer className="ux-help-drawer__foot">
              {help.related?.map((link) => (
                <Link key={link.to + link.label} to={link.to} className="ux-inline-link" onClick={() => setOpen(false)}>
                  {link.label}<ChevronRight size={14} />
                </Link>
              ))}
              <Link to="/manual" className="ux-inline-link ux-inline-link--strong" onClick={() => setOpen(false)}>
                <BookOpen size={15} />完整中文手册
              </Link>
            </footer>
          </aside>
        </div>
      )}
    </>
  )
}
