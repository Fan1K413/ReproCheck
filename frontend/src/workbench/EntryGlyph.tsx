/**
 * 一级主工作台 · 入口图标渲染层
 *
 * 所有入口（圆盘、功能卡组标题、展开全部清单）共用同一份画布、描边与光学缩放，
 * 保证同一个入口在不同位置的图标观感一致。
 */

import { ICON_CANVAS, ICON_STROKE, iconSpecFor } from './entryIcons'

type Props = {
  entryId: string
  /** 不传则跟随 CSS 变量 --rc-glyph-size（圆盘内按断点自适应） */
  size?: number
  className?: string
}

export default function EntryGlyph({ entryId, size, className }: Props) {
  const spec = iconSpecFor(entryId)
  const Icon = spec.icon
  return (
    <span
      className={className ? `rc-glyph ${className}` : 'rc-glyph'}
      style={size ? { width: `${size}px`, height: `${size}px` } : undefined}
      aria-hidden="true"
    >
      <Icon
        size={ICON_CANVAS}
        strokeWidth={ICON_STROKE}
        style={{ transform: `translate(${spec.dx}px, ${spec.dy}px) scale(${spec.scale})` }}
      />
    </span>
  )
}
