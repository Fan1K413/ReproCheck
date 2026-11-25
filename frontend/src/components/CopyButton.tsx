import { Check, Copy } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Icon } from './Icon'

type CopyButtonProps = {
  text: string
  label?: string
  className?: string
}

export function CopyButton({ text, label = '复制', className = '' }: CopyButtonProps) {
  const [copied, setCopied] = useState(false)
  const resetTimer = useRef<number | undefined>(undefined)

  useEffect(() => () => window.clearTimeout(resetTimer.current), [])

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      const area = document.createElement('textarea')
      area.value = text
      area.style.position = 'fixed'
      area.style.opacity = '0'
      document.body.appendChild(area)
      area.select()
      document.execCommand('copy')
      area.remove()
    }
    setCopied(true)
    window.clearTimeout(resetTimer.current)
    resetTimer.current = window.setTimeout(() => setCopied(false), 1600)
  }

  return (
    <button type="button" onClick={() => void copy()} className={`btn-ghost ${className}`}>
      <Icon as={copied ? Check : Copy} size="xs" tone={copied ? 'success' : 'current'} />
      {copied ? '已复制' : label}
    </button>
  )
}
