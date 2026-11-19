import { Check, Copy } from 'lucide-react'
import { useState } from 'react'

type CopyButtonProps = {
  text: string
  label?: string
  className?: string
}

export function CopyButton({ text, label = '复制', className = '' }: CopyButtonProps) {
  const [copied, setCopied] = useState(false)

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
    window.setTimeout(() => setCopied(false), 1600)
  }

  return (
    <button type="button" onClick={() => void copy()} className={`btn-ghost ${className}`}>
      {copied ? <Check size={14} className="text-success" /> : <Copy size={14} />}
      {copied ? '已复制' : label}
    </button>
  )
}