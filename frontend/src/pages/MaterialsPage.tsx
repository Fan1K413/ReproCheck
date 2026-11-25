import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  BookOpen,
  Braces,
  FileSpreadsheet,
  FileText,
  Files,
  ShieldCheck,
  UploadCloud,
  X,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, ChangeEvent, DragEvent, ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'
import { EmptyState } from '../components/EmptyState'
import { ErrorState } from '../components/ErrorState'
import { Icon } from '../components/Icon'
import { LoadingState } from '../components/LoadingState'
import { StatusBadge, type Tone } from '../components/StatusBadge'
import { formatBytes, formatDateTime } from '../features/format'
import { materialTypeLabel, materialTypeTone, parseStatusLabel, parseStatusTone } from '../features/stage2Meta'
import { useTrackProject } from '../hooks/useTrackProject'
import { ApiError, api } from '../services/api'
import { toast } from '../stores/toastStore'
import type { MaterialView, ParseStatus } from '../types/api'
import '../styles/wave-b-material.css'

type Notice = { tone: 'success' | 'error'; text: string }

/**
 * 后端 parse_status 可能返回 ParseStatus 联合之外的取值（例如 seeded 演示快照的 "parsed"）。
 * 这里以 Partial 映射承载扩展值，缺项时回落到原始字符串，绝不显示空白。
 */
const PARSE_STATUS_TEXT: Partial<Record<string, string>> = {
  ...parseStatusLabel,
  parsed: '已解析',
}

function statusText(status: string): string {
  return PARSE_STATUS_TEXT[status] ?? status
}

function statusTone(status: string): Tone {
  if (status in parseStatusLabel) return parseStatusTone(status as ParseStatus)
  return status === 'parsed' ? 'success' : 'neutral'
}

const TYPE_ICON: Record<string, LucideIcon> = {
  pdf: BookOpen,
  readme: BookOpen,
  text: FileText,
  python: Braces,
  notebook: FileSpreadsheet,
  requirements: Braces,
  yaml: FileText,
  json: FileText,
  toml: FileText,
  zip: FileText,
  csv: FileSpreadsheet,
  xlsx: FileSpreadsheet,
  unknown: FileText,
}

function errorCode(error: unknown): string | undefined {
  return error instanceof ApiError ? error.code : undefined
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback
}

type SortKey = 'created' | 'name' | 'size'

const SORT_LABEL: Record<SortKey, string> = {
  created: '上传时间',
  name: '文件名',
  size: '文件大小',
}

export default function MaterialsPage() {
  const projectId = useParams().projectId ?? ''
  useTrackProject(projectId)
  const queryClient = useQueryClient()

  const fileInputRef = useRef<HTMLInputElement>(null)
  const drawerCloseRef = useRef<HTMLButtonElement>(null)
  const triggerRef = useRef<HTMLElement | null>(null)

  const [dragActive, setDragActive] = useState(false)
  const [selectedFiles, setSelectedFiles] = useState<File[]>([])
  const [uploading, setUploading] = useState(false)
  const [notice, setNotice] = useState<Notice | null>(null)
  const [deleteInfo, setDeleteInfo] = useState<string | null>(null)

  const [typeFilter, setTypeFilter] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState<string | null>(null)
  const [sortKey, setSortKey] = useState<SortKey>('created')
  const [openMaterialId, setOpenMaterialId] = useState<string | null>(null)

  const materialsQuery = useQuery({
    queryKey: ['materials', projectId],
    queryFn: () => api.listMaterials(projectId),
    enabled: !!projectId,
  })

  const factsQuery = useQuery({
    queryKey: ['facts', projectId],
    queryFn: () => api.listFacts(projectId),
    enabled: !!projectId,
  })

  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData()
      formData.append('project_id', projectId)
      formData.append('file', file)
      return api.uploadMaterial(formData)
    },
  })

  const parseMutation = useMutation({
    mutationFn: (materialId: string) => api.startParse(materialId),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['materials', projectId] }),
        queryClient.invalidateQueries({ queryKey: ['parse-tasks', projectId] }),
      ])
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (materialId: string) => api.deleteMaterial(materialId),
    onSuccess: async (result) => {
      setDeleteInfo(
        `已删除，级联清理：${result.cascaded.chunks} 个文本块、${result.cascaded.facts} 条事实、${result.cascaded.evidence} 条证据。`,
      )
      setOpenMaterialId(null)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['materials', projectId] }),
        queryClient.invalidateQueries({ queryKey: ['parse-tasks', projectId] }),
        queryClient.invalidateQueries({ queryKey: ['facts', projectId] }),
        queryClient.invalidateQueries({ queryKey: ['facts-summary', projectId] }),
        queryClient.invalidateQueries({ queryKey: ['parse-overview', projectId] }),
      ])
    },
  })

  const downloadMutation = useMutation({
    mutationFn: (materialId: string) => api.downloadMaterial(materialId),
    onSuccess: () => toast.success('已开始下载原始文件'),
    onError: (error) => toast.error(`下载失败：${errorMessage(error, '请重试')}`),
  })

  const materials = useMemo(() => materialsQuery.data?.items ?? [], [materialsQuery.data])

  /** 真实可选项：只列出数据集中实际出现过的类型与状态 */
  const typeOptions = useMemo(() => {
    const counts = new Map<string, number>()
    for (const material of materials) {
      counts.set(material.material_type, (counts.get(material.material_type) ?? 0) + 1)
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1])
  }, [materials])

  const statusOptions = useMemo(() => {
    const counts = new Map<string, number>()
    for (const material of materials) {
      counts.set(material.parse_status, (counts.get(material.parse_status) ?? 0) + 1)
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1])
  }, [materials])

  /** 真实事实聚���：卡片上的事实 / 证据 / 待复核徽标均来自 GET /facts */
  const factStats = useMemo(() => {
    const map = new Map<string, { total: number; withEvidence: number; needsReview: number }>()
    for (const fact of factsQuery.data?.items ?? []) {
      const current = map.get(fact.material_id) ?? { total: 0, withEvidence: 0, needsReview: 0 }
      current.total += 1
      if (fact.evidence.length > 0) current.withEvidence += 1
      if (fact.extraction_status === 'needs_review') current.needsReview += 1
      map.set(fact.material_id, current)
    }
    return map
  }, [factsQuery.data])

  const visibleMaterials = useMemo(() => {
    const filtered = materials.filter((material) => {
      if (typeFilter && material.material_type !== typeFilter) return false
      if (statusFilter && material.parse_status !== statusFilter) return false
      return true
    })
    const sorted = [...filtered]
    sorted.sort((a, b) => {
      if (sortKey === 'name') return a.filename.localeCompare(b.filename, 'zh-CN')
      if (sortKey === 'size') return b.size_bytes - a.size_bytes
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    })
    return sorted
  }, [materials, typeFilter, statusFilter, sortKey])

  const openMaterial = useMemo(
    () => materials.find((material) => material.material_id === openMaterialId) ?? null,
    [materials, openMaterialId],
  )

  const openFacts = useMemo(
    () => (factsQuery.data?.items ?? []).filter((fact) => fact.material_id === openMaterialId),
    [factsQuery.data, openMaterialId],
  )

  // 抽屉开关：Esc 关闭、焦点进入面板、关闭后焦点归还触发卡
  useEffect(() => {
    if (!openMaterialId) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpenMaterialId(null)
    }
    window.addEventListener('keydown', onKeyDown)
    const timer = window.setTimeout(() => drawerCloseRef.current?.focus(), 60)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.clearTimeout(timer)
    }
  }, [openMaterialId])

  useEffect(() => {
    if (!openMaterialId) triggerRef.current?.focus()
  }, [openMaterialId])

  const base = `/projects/${projectId}`

  function addFiles(files: File[]) {
    if (files.length > 0) {
      setSelectedFiles((prev) => [...prev, ...files])
      setNotice(null)
    }
  }

  function onFileChange(event: ChangeEvent<HTMLInputElement>) {
    addFiles(Array.from(event.target.files ?? []))
    event.target.value = ''
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault()
    setDragActive(false)
    addFiles(Array.from(event.dataTransfer.files))
  }

  async function handleUpload() {
    if (selectedFiles.length === 0 || uploading) return
    setUploading(true)
    setNotice(null)
    const succeeded: string[] = []
    const failed: string[] = []
    // 逐个上传，展示真实上传状态与服务器返回结果。
    for (const file of selectedFiles) {
      try {
        const result = await uploadMutation.mutateAsync(file)
        succeeded.push(`${result.filename}（${statusText(result.parse_status)}）`)
      } catch (error) {
        failed.push(`${file.name}：${errorMessage(error, '上传失败')}`)
      }
    }
    setUploading(false)
    setSelectedFiles([])
    if (succeeded.length > 0) {
      setNotice({ tone: 'success', text: `上传成功：${succeeded.join('、')}` })
      await queryClient.invalidateQueries({ queryKey: ['materials', projectId] })
    }
    if (failed.length > 0) {
      setNotice({ tone: 'error', text: failed.join('；') })
    }
  }

  function handleDelete(material: MaterialView) {
    const confirmed = window.confirm(
      `确定删除材料「${material.filename}」？该操作会级联删除其文本块、事实与证据，且不可撤销。`,
    )
    if (confirmed) {
      setDeleteInfo(null)
      deleteMutation.mutate(material.material_id)
    }
  }

  const isParseActive = (material: MaterialView) =>
    material.parse_status === 'queued' ||
    material.parse_status === 'parsing' ||
    material.parse_status === 'extracting'

  function renderActions(material: MaterialView, variant: 'panel' | 'row' = 'row'): ReactNode {
    const actionClass =
      'inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50'

    const isRepository = material.material_type === 'code_repository'
    return (
      <div className="flex flex-wrap items-center gap-2">
        {isRepository ? (
          material.external_url ? (
            <a
              href={material.external_url}
              target="_blank"
              rel="noreferrer"
              className={`${actionClass} hover:bg-accent-wash hover:text-accent-soft`}
              style={{ color: 'var(--rc-text-muted)' }}
              title="在浏览器打开代码仓库（不会下载或执行）"
            >
              <Icon name="externalLink" size="xs" />
              打开仓库
            </a>
          ) : null
        ) : (
          <button
            type="button"
            className={`${actionClass} hover:bg-accent-wash hover:text-accent-soft`}
            style={{ color: 'var(--rc-text-muted)' }}
            disabled={isParseActive(material) || parseMutation.isPending}
            title={isParseActive(material) ? '该材料正在解析中' : '发起解析与事实抽取'}
            onClick={() => parseMutation.mutate(material.material_id)}
          >
            <Icon name="play" size="xs" />
            解析
          </button>
        )}
        {!isRepository && (
          <button
            type="button"
            className={`${actionClass} hover:bg-accent-wash hover:text-accent-soft`}
            style={{ color: 'var(--rc-text-muted)' }}
            disabled={downloadMutation.isPending}
            title="下载原始文件"
            onClick={() => downloadMutation.mutate(material.material_id)}
          >
            <Icon name="download" size="xs" />
            下载
          </button>
        )}
        <button
          type="button"
          className={`${actionClass} hover:bg-danger-wash`}
          style={{ color: 'var(--rc-danger)' }}
          disabled={deleteMutation.isPending}
          title="删除材料及其级联数据"
          onClick={() => handleDelete(material)}
        >
          <Icon name="trash" size="xs" />
          删除
        </button>
        {variant === 'panel' && (
          <Link to={`/materials/${material.material_id}`} className="btn-ghost">
            <Icon name="externalLink" size="sm" />
            打开完整详情
          </Link>
        )}
      </div>
    )
  }

  const filterPanel = (
    <section className="mb-panel" aria-label="材料筛选">
      <div className="mb-panel__head">
        <h3 className="mb-panel__title">
          <Icon name="filter" size="sm" tone="accent" />
          档案筛选
        </h3>
        {(typeFilter || statusFilter) && (
          <button
            type="button"
            className="mb-chip mb-chip--static"
            onClick={() => {
              setTypeFilter(null)
              setStatusFilter(null)
            }}
          >
            清除
          </button>
        )}
      </div>
      <div className="mb-panel__body">
        <div className="mb-filter__group">
          <p className="mb-label">材料类型</p>
          <div className="mb-filter__list">
            {typeOptions.length === 0 ? (
              <p className="text-xs" style={{ color: 'var(--rc-text-subtle)' }}>
                暂无类型分布
              </p>
            ) : (
              typeOptions.map(([type, count]) => (
                <button
                  key={type}
                  type="button"
                  aria-pressed={typeFilter === type}
                  className={`mb-filter__opt ${typeFilter === type ? 'mb-filter__opt--on' : ''}`}
                  onClick={() => setTypeFilter((prev) => (prev === type ? null : type))}
                >
                  <span className="truncate">
                    {materialTypeLabel[type as keyof typeof materialTypeLabel] ?? type}
                  </span>
                  <span className="mb-filter__opt__n">{count}</span>
                </button>
              ))
            )}
          </div>
        </div>

        <div className="mb-filter__group">
          <p className="mb-label">解析状态</p>
          <div className="mb-filter__list">
            {statusOptions.length === 0 ? (
              <p className="text-xs" style={{ color: 'var(--rc-text-subtle)' }}>
                暂无状态分布
              </p>
            ) : (
              statusOptions.map(([status, count]) => (
                <button
                  key={status}
                  type="button"
                  aria-pressed={statusFilter === status}
                  className={`mb-filter__opt ${statusFilter === status ? 'mb-filter__opt--on' : ''}`}
                  onClick={() => setStatusFilter((prev) => (prev === status ? null : status))}
                >
                  <span className="truncate">{statusText(status)}</span>
                  <span className="mb-filter__opt__n">{count}</span>
                </button>
              ))
            )}
          </div>
        </div>

        <div className="mb-filter__group">
          <p className="mb-label">排序</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {(Object.keys(SORT_LABEL) as SortKey[]).map((key) => (
              <button
                key={key}
                type="button"
                aria-pressed={sortKey === key}
                className={`mb-chip ${sortKey === key ? 'mb-chip--on' : ''}`}
                onClick={() => setSortKey(key)}
              >
                {SORT_LABEL[key]}
              </button>
            ))}
          </div>
        </div>
      </div>
    </section>
  )

  return (
    <div className="mb-page">
      <header className="mb-head">
        <div className="min-w-0">
          <p className="mb-head__eyebrow">项目材料 · 上传与自动处理</p>
          <h1 className="mb-head__title">论文与材料</h1>
          <p className="mb-head__desc">管理论文、数据、代码与仓库</p>
        </div>
        <nav className="mb-head__actions">
          <Link to={`/start/reproduce?project=${projectId}&step=3`} className="btn-ghost">
            <Icon name="gitBranch" size="sm" />
            登记代码仓库
          </Link>
          <Link to={`${base}/tasks`} className="btn-ghost">
            <Icon name="listTree" size="sm" />
            自动处理任务
          </Link>
          <Link to={`${base}/facts`} className="btn-ghost">
            <Icon name="clipboardCheck" size="sm" />
            科研事实
          </Link>
          <Link to={`${base}/overview`} className="btn-ghost">
            <Icon name="grid" size="sm" />
            解析概览
  </Link>
        </nav>
      </header>

      <section className="mb-panel" aria-label="上传材料">
        <div className="mb-panel__head">
          <h3 className="mb-panel__title">
            <Icon name="upload" size="sm" tone="accent" />
            上传材料
          </h3>
          <span className="mb-panel__hint">支持多文件</span>
        </div>
        <div className="mb-panel__body">
          <div
            onDragOver={(event) => {
              event.preventDefault()
              setDragActive(true)
            }}
            onDragLeave={(event) => {
              event.preventDefault()
              setDragActive(false)
            }}
            onDrop={onDrop}
            className={`mb-drop ${dragActive ? 'mb-drop--active' : ''}`}
          >
            <Icon as={UploadCloud} size="xl" tone="accent" />
            <p className="mt-3 text-sm font-semibold" style={{ color: 'var(--rc-text)' }}>
              拖拽文件到此处，或点击选择文件
            </p>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={onFileChange}
              aria-label="选择材料文件"
            />
            <button
              type="button"
              className="btn-primary mt-4"
              disabled={uploading}
              onClick={() => fileInputRef.current?.click()}
            >
              <Icon name="upload" size="sm" />
              选择文件
            </button>
          </div>

          {selectedFiles.length > 0 && (
            <div className="mt-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="mb-label">待上传 {selectedFiles.length} 个文件</p>
                <button
                  type="button"
                  className="mb-chip mb-chip--static"
                  disabled={uploading}
                  onClick={() => setSelectedFiles([])}
                >
                  清空
                </button>
              </div>
              <ul className="mt-2 flex flex-wrap gap-2">
                {selectedFiles.map((file, index) => (
                  <li key={`${file.name}-${index}`} className="mb-filechip">
                    <span className="max-w-[220px] truncate" title={file.name}>
                      {file.name}
                    </span>
                    <button
                      type="button"
                      aria-label={`移除 ${file.name}`}
                      disabled={uploading}
                      onClick={() =>
                        setSelectedFiles((prev) => prev.filter((_, i) => i !== index))
                      }
                    >
                      <Icon name="x" size="xs" />
                    </button>
                  </li>
                ))}
              </ul>
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  className="btn-primary"
                  disabled={uploading}
                  onClick={() => void handleUpload()}
                >
                  <Icon name="upload" size="sm" />
                  {uploading ? '上传中…' : `上传 ${selectedFiles.length} 个文件`}
                </button>
                {uploading && (
                  <span
                    className="inline-flex items-center gap-2 text-xs"
                    style={{ color: 'var(--rc-text-muted)' }}
                    role="status"
                  >
                    <Icon name="loader" size="sm" className="animate-spin" />
                    上传中…
                  </span>
                )}
              </div>
            </div>
          )}

          {notice && (
            <div
              className="mt-4 flex items-start gap-2 rounded-md px-3 py-2 text-xs"
              style={{
                backgroundColor:
                  notice.tone === 'success' ? 'var(--rc-success-wash)' : 'var(--rc-danger-wash)',
                color: notice.tone === 'success' ? 'var(--rc-success)' : 'var(--rc-danger)',
              }}
              role={notice.tone === 'error' ? 'alert' : 'status'}
            >
              <Icon
                as={notice.tone === 'success' ? ShieldCheck : X}
                size="xs"
                className="mt-0.5 shrink-0"
              />
              <span className="min-w-0 break-words">{notice.text}</span>
            </div>
          )}
          {deleteInfo && (
            <p
              className="mt-3 rounded-md px-3 py-2 text-xs"
              style={{ backgroundColor: 'var(--rc-surface-2)', color: 'var(--rc-text-muted)' }}
              role="status"
            >
              {deleteInfo}
            </p>
          )}
          {parseMutation.isError && (
            <p className="mt-3 text-xs" style={{ color: 'var(--rc-danger)' }} role="alert">
              发起解析失败：{errorMessage(parseMutation.error, '请重试')}
            </p>
          )}
        </div>
      </section>

      <div className="mb-materials">
        <div className="min-w-0">{filterPanel}</div>

        <div className="min-w-0">
          <section className="mb-panel mb-panel--grid" aria-label="材料层叠列表">
            <div className="mb-panel__head">
              <h3 className="mb-panel__title">
                <Icon as={Files} size="sm" tone="accent" />
                材料档案
              </h3>
              <div className="flex items-center gap-2">
                <span className="mb-panel__hint">
                  {visibleMaterials.length} / {materials.length} 项
                </span>
                <StatusBadge tone="neutral">{materialsQuery.data?.total ?? 0} 项</StatusBadge>
              </div>
            </div>

            {materialsQuery.isPending ? (
              <LoadingState compact message="正在读取材料列表…" hint="GET /materials" />
            ) : materialsQuery.isError ? (
              <ErrorState
                compact
                message={errorMessage(materialsQuery.error, '无法获取材料列表，请确认后端服务已启动。')}
                code={errorCode(materialsQuery.error)}
                onRetry={() => void materialsQuery.refetch()}
              />
            ) : materials.length === 0 ? (
              <EmptyState
                icon={Files}
                title="尚无材料"
                description="上传论文、代码或配置文件后，即可在此发起解析与事实抽取。"
              />
            ) : visibleMaterials.length === 0 ? (
              <EmptyState
                compact
                icon={Files}
                title="当前筛选下没有材料"
                description="调整左侧的类型或状态筛选，或清除筛选查看全部材料。"
                action={
                  <button
                    type="button"
                    className="btn-ghost"
                    onClick={() => {
                      setTypeFilter(null)
                      setStatusFilter(null)
                    }}
                  >
                    清除筛选
                  </button>
                }
              />
            ) : (
              <>
                <div className="mb-stack-wrap">
                  <div className="mb-stack">
                    {visibleMaterials.map((material, index) => {
                      const stats = factStats.get(material.material_id)
                      const isOpen = openMaterialId === material.material_id
                      const TypeIcon = TYPE_ICON[material.material_type] ?? FileText
                      return (
                        <div
                          key={material.material_id}
                          className="mb-stack__slot"
                          style={{ '--mb-i': Math.min(index, 5) } as CSSProperties}
                        >
                          <span className="mb-stack__sheet" aria-hidden="true" />
                          <span className="mb-stack__sheet mb-stack__sheet--2" aria-hidden="true" />
                          <button
                            type="button"
                            ref={(node) => {
                              if (isOpen) triggerRef.current = node
                            }}
                            className={`mb-stack__card ${isOpen ? 'mb-stack__card--open' : ''}`}
                            aria-expanded={isOpen}
                            aria-controls="mb-material-detail"
                            onClick={() => setOpenMaterialId(isOpen ? null : material.material_id)}
                          >
                            <span className="mb-stack__grid">
                              <span className="mb-stack__idx">
                                {String(index + 1).padStart(2, '0')}
                              </span>
                              <span className="min-w-0">
                                <span className="flex flex-wrap items-center gap-2">
                                  <Icon as={TypeIcon} size="sm" tone="accent" />
                                  <span className="mb-stack__name">{material.filename}</span>
                                </span>
                                <span className="mb-stack__meta">
                                  <StatusBadge tone={materialTypeTone(material.material_type)} dot={false}>
                                    {materialTypeLabel[material.material_type]}
                                  </StatusBadge>
                                  <span className="mb-mono">{formatBytes(material.size_bytes)}</span>
                                  <span className="mb-mono">
                                    {material.chunk_count} 块 / {material.fact_count} 事实
                                  </span>
                                  <span className="mb-mono">{formatDateTime(material.created_at)}</span>
                                </span>
                                <span className="mb-stack__hash">
                                  SHA-256 {material.sha256 ? material.sha256.slice(0, 16) : '—'}
                                </span>
                              </span>
                              <span className="flex flex-col items-end gap-2">
                                <StatusBadge tone={statusTone(material.parse_status)}>
                                  {statusText(material.parse_status)}
                                </StatusBadge>
                                {stats && stats.needsReview > 0 && (
                                  <StatusBadge tone="warning" dot={false}>
                                    待复核 {stats.needsReview}
                                  </StatusBadge>
                                )}
                                <span className="flex items-center gap-1 text-xs" style={{ color: 'var(--rc-text-subtle)' }}>
                                  {isOpen ? '收起详情' : '展开详情'}
                                  <Icon name="chevronDown" size="xs" />
                                </span>
                              </span>
                            </span>
                            {material.error_message && (
                              <span className="mb-stack__err">{material.error_message}</span>
                            )}
                          </button>
                        </div>
                      )
                    })}
                  </div>
                </div>
              </>
            )}
          </section>
        </div>
      </div>

      {openMaterial && (
        <div className="mb-drawer" role="dialog" aria-modal="true" aria-label={`材料详情 ${openMaterial.filename}`}>
          <button
            type="button"
            className="mb-drawer__scrim"
            aria-label="关闭材料详情"
            onClick={() => setOpenMaterialId(null)}
          />
          <aside className="mb-drawer__panel" id="mb-material-detail">
            <div className="mb-drawer__head">
              <div className="min-w-0">
                <p className="mb-head__eyebrow">材料详情</p>
                <h2 className="mb-head__title break-all" style={{ fontSize: 'var(--rc-fs-h2)' }}>
                  {openMaterial.filename}
                </h2>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <StatusBadge tone={materialTypeTone(openMaterial.material_type)} dot={false}>
                    {materialTypeLabel[openMaterial.material_type]}
                  </StatusBadge>
                  <StatusBadge tone={statusTone(openMaterial.parse_status)}>
                    {statusText(openMaterial.parse_status)}
                  </StatusBadge>
                </div>
              </div>
              <button
                ref={drawerCloseRef}
                type="button"
                className="mb-iconbtn"
                aria-label="关闭材料详情"
                onClick={() => setOpenMaterialId(null)}
              >
                <Icon name="x" size="sm" />
              </button>
            </div>

            <div className="mb-drawer__body">
              {openMaterial.error_message && (
                <p
                  className="rounded-md px-3 py-2 text-xs"
                  style={{ backgroundColor: 'var(--rc-danger-wash)', color: 'var(--rc-danger)' }}
                >
                  解析失败原因：{openMaterial.error_message}
                </p>
              )}

              <dl className="mb-dl">
                <div className="mb-dl__row">
                  <dt className="mb-dl__key">文件大小</dt>
                  <dd className="mb-dl__val">{formatBytes(openMaterial.size_bytes)}</dd>
                </div>
                <div className="mb-dl__row">
                  <dt className="mb-dl__key">上传时间</dt>
                  <dd className="mb-dl__val">{formatDateTime(openMaterial.created_at)}</dd>
                </div>
                <div className="mb-dl__row">
                  <dt className="mb-dl__key">文本块数</dt>
                  <dd className="mb-dl__val">{openMaterial.chunk_count}</dd>
                </div>
                <div className="mb-dl__row">
                  <dt className="mb-dl__key">事实数</dt>
                  <dd className="mb-dl__val">{openMaterial.fact_count}</dd>
                </div>
                <div className="mb-dl__row">
                  <dt className="mb-dl__key">文件指纹 SHA-256</dt>
                  <dd className="mb-dl__val">{openMaterial.sha256 || '—'}</dd>
                </div>
                <div className="mb-dl__row">
                  <dt className="mb-dl__key">材料 ID</dt>
                  <dd className="mb-dl__val">{openMaterial.material_id}</dd>
                </div>
              </dl>

              <section>
                <h3 className="mb-label mb-2">关联事实与证据</h3>
                {factsQuery.isPending ? (
                  <LoadingState compact message="正在读取关联事实…" />
                ) : openFacts.length === 0 ? (
                  <p className="text-xs" style={{ color: 'var(--rc-text-subtle)' }}>
                    该材料尚未抽取到科研事实。
                  </p>
                ) : (
                  <ul className="flex flex-col gap-2">
                    {openFacts.slice(0, 8).map((fact) => (
                      <li key={fact.fact_id} className="mb-evidence">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="text-xs font-semibold" style={{ color: 'var(--rc-text)' }}>
                            {fact.field_label || fact.field_key}
                          </span>
                          <StatusBadge tone="neutral" dot={false}>
                            {fact.evidence.length} 条证据
                          </StatusBadge>
                        </div>
                        <p className="mb-mono mt-1 break-all text-xs" style={{ color: 'var(--rc-text-subtle)' }}>
                          {fact.field_key} · {fact.raw_value || '—'}
                        </p>
                      </li>
                    ))}
                  </ul>
                )}
                {openFacts.length > 8 && (
                  <p className="mt-2 text-xs" style={{ color: 'var(--rc-text-subtle)' }}>
                    仅展示前 8 条，共 {openFacts.length} 条；完整清单见
                    <Link to={`${base}/facts`} className="ml-1" style={{ color: 'var(--rc-violet)' }}>
                      科研事实
                    </Link>
                    。
                  </p>
                )}
              </section>
            </div>

            <div className="mb-drawer__foot">{renderActions(openMaterial, 'panel')}</div>
          </aside>
        </div>
      )}
    </div>
  )
}
