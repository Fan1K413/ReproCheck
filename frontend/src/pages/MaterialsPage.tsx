import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardList,
  Download,
  Files,
  ListChecks,
  Play,
  Trash2,
  UploadCloud,
  X,
} from 'lucide-react'
import { useRef, useState } from 'react'
import type { ChangeEvent, DragEvent, ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'
import { DataTable, type Column } from '../components/DataTable'
import { EmptyState } from '../components/EmptyState'
import { ErrorState } from '../components/ErrorState'
import { LoadingState } from '../components/LoadingState'
import { StatusBadge } from '../components/StatusBadge'
import { formatBytes, formatDateTime } from '../features/format'
import {
  materialTypeLabel,
  materialTypeTone,
  parseStatusLabel,
  parseStatusTone,
} from '../features/stage2Meta'
import { useTrackProject } from '../hooks/useTrackProject'
import { ApiError, api } from '../services/api'
import type { MaterialView } from '../types/api'

type Notice = { tone: 'success' | 'error'; text: string }

function errorCode(error: unknown): string | undefined {
  return error instanceof ApiError ? error.code : undefined
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback
}

export default function MaterialsPage() {
  const projectId = useParams().projectId ?? ''
  useTrackProject(projectId)
  const queryClient = useQueryClient()

  const fileInputRef = useRef<HTMLInputElement>(null)
  const [dragActive, setDragActive] = useState(false)
  const [selectedFiles, setSelectedFiles] = useState<File[]>([])
  const [uploading, setUploading] = useState(false)
  const [notice, setNotice] = useState<Notice | null>(null)
  const [deleteInfo, setDeleteInfo] = useState<string | null>(null)

  const materialsQuery = useQuery({
    queryKey: ['materials', projectId],
    queryFn: () => api.listMaterials(projectId),
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
  })

  const materials = materialsQuery.data?.items ?? []
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
    // 逐个上传：不伪造进度百分比，仅展示真实"上传中…"状态与服务器返回结果。
    for (const file of selectedFiles) {
      try {
        const result = await uploadMutation.mutateAsync(file)
        succeeded.push(`${result.filename}（${parseStatusLabel[result.parse_status]}）`)
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

  function renderActions(material: MaterialView): ReactNode {
    const parseActive =
      material.parse_status === 'queued' ||
      material.parse_status === 'parsing' ||
      material.parse_status === 'extracting'
    const actionClass =
      'inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-medium text-ink-muted transition-colors hover:bg-canvas hover:text-ink disabled:cursor-not-allowed disabled:opacity-50'
    return (
      <div className="flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          className={actionClass}
          disabled={parseActive || parseMutation.isPending}
          title={parseActive ? '该材料正在解析中' : '发起解析与事实抽取'}
          onClick={() => parseMutation.mutate(material.material_id)}
        >
          <Play size={13} />
          解析
        </button>
        <button
          type="button"
          className={actionClass}
          disabled={downloadMutation.isPending}
          title="下载原始文件"
          onClick={() => downloadMutation.mutate(material.material_id)}
        >
          <Download size={13} />
          下载
        </button>
        <button
          type="button"
          className={`${actionClass} hover:text-danger`}
          disabled={deleteMutation.isPending}
          title="删除材料及其级联数据"
          onClick={() => handleDelete(material)}
        >
          <Trash2 size={13} />
          删除
        </button>
      </div>
    )
  }

  const columns: Column<MaterialView>[] = [
    {
      key: 'filename',
      header: '文件名',
      render: (material) => (
        <div className="min-w-0 max-w-[260px]">
          <Link
            to={`/materials/${material.material_id}`}
            className="block truncate font-medium text-ink hover:text-accent-dark hover:underline"
            title={material.filename}
          >
            {material.filename}
          </Link>
          {material.error_message && (
            <p className="mt-0.5 truncate text-xs text-danger" title={material.error_message}>
              {material.error_message}
            </p>
          )}
        </div>
      ),
    },
    {
      key: 'type',
      header: '类型',
      render: (material) => (
        <StatusBadge tone={materialTypeTone(material.material_type)} dot={false}>
          {materialTypeLabel[material.material_type]}
        </StatusBadge>
      ),
    },
    {
      key: 'size',
      header: '大小',
      render: (material) => (
        <span className="mono whitespace-nowrap text-xs text-ink-muted">
          {formatBytes(material.size_bytes)}
        </span>
      ),
    },
    {
      key: 'status',
      header: '解析状态',
      render: (material) => (
        <StatusBadge tone={parseStatusTone(material.parse_status)}>
          {parseStatusLabel[material.parse_status]}
        </StatusBadge>
      ),
    },
    {
      key: 'counts',
      header: '块 / 事实',
      align: 'right',
      render: (material) => (
        <span className="mono whitespace-nowrap text-xs text-ink-muted">
          {material.chunk_count} / {material.fact_count}
        </span>
      ),
    },
    {
      key: 'created',
      header: '上传时间',
      render: (material) => (
        <span className="mono whitespace-nowrap text-xs text-ink-muted">
          {formatDateTime(material.created_at)}
        </span>
      ),
    },
    {
      key: 'actions',
      header: '操作',
      render: (material) => renderActions(material),
    },
  ]

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-accent-dark">Materials</p>
          <h2 className="mt-1 text-lg font-semibold">材料管理</h2>
          <p className="mt-1 text-sm text-ink-muted">
            上传科研材料并发起解析，列表数据来自 GET /materials。
          </p>
        </div>
        <nav className="flex flex-wrap items-center gap-2">
          <Link to={`${base}/tasks`} className="btn-ghost">
            <ListChecks size={15} />
            解析任务
          </Link>
          <Link to={`${base}/facts`} className="btn-ghost">
            <ClipboardList size={15} />
            科研事实
          </Link>
          <Link to={`${base}/overview`} className="btn-ghost">
            解析概览
          </Link>
        </nav>
      </div>

      <section className="panel p-5">
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
          className={`flex flex-col items-center rounded-panel border-2 border-dashed px-4 py-7 text-center transition-colors ${
            dragActive ? 'border-accent bg-accent-wash' : 'border-line bg-canvas'
          }`}
        >
          <UploadCloud size={26} strokeWidth={1.7} className="text-accent-dark" />
          <p className="mt-2 text-sm font-medium text-ink">拖拽文件到此处，或点击选择文件</p>
          <p className="mt-1 text-xs text-ink-muted">支持多文件；上传状态与解析状态均由服务器返回。</p>
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
            className="btn-primary mt-3"
            disabled={uploading}
            onClick={() => fileInputRef.current?.click()}
          >
            选择文件
          </button>
        </div>

        {selectedFiles.length > 0 && (
          <div className="mt-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs font-semibold text-ink-muted">
                待上传 {selectedFiles.length} 个文件
              </p>
              <button
                type="button"
                className="text-xs text-ink-subtle hover:text-danger"
                disabled={uploading}
                onClick={() => setSelectedFiles([])}
              >
                清空
              </button>
            </div>
            <ul className="mt-2 flex flex-wrap gap-2">
              {selectedFiles.map((file, index) => (
                <li
                  key={`${file.name}-${index}`}
                  className="inline-flex max-w-full items-center gap-1.5 rounded bg-neutral-wash px-2 py-1 text-xs text-ink-muted"
                >
                  <span className="max-w-[200px] truncate" title={file.name}>{file.name}</span>
                  <button
                    type="button"
                    disabled={uploading}
                    aria-label={`移除 ${file.name}`}
                    onClick={() =>
                      setSelectedFiles((prev) => prev.filter((_, i) => i !== index))
                    }
                  >
                    <X size={12} />
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
                <UploadCloud size={15} />
                {uploading ? '上传中…' : `上传 ${selectedFiles.length} 个文件`}
              </button>
              {uploading && (
                <span className="inline-flex items-center gap-2 text-xs text-ink-muted" role="status">
                  <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-line border-t-accent" />
                  上传中…（真实进度由服务器返回后刷新列表）
                </span>
              )}
            </div>
          </div>
        )}

        {notice && (
          <div
            className={`mt-4 flex items-start gap-2 rounded-md px-3 py-2 text-xs ${
              notice.tone === 'success'
                ? 'bg-success-wash text-success'
                : 'bg-danger-wash text-danger'
            }`}
            role={notice.tone === 'error' ? 'alert' : 'status'}
          >
            {notice.tone === 'success' ? <CheckCircle2 size={14} className="mt-0.5 shrink-0" /> : <AlertTriangle size={14} className="mt-0.5 shrink-0" />}
            <span className="min-w-0 break-words">{notice.text}</span>
          </div>
        )}
        {deleteInfo && (
          <p className="mt-3 rounded-md bg-neutral-wash px-3 py-2 text-xs text-ink-muted" role="status">
            {deleteInfo}
          </p>
        )}
        {parseMutation.isError && (
          <p className="mt-3 text-xs text-danger" role="alert">
            发起解析失败：{errorMessage(parseMutation.error, '请重试')}
          </p>
        )}
        {downloadMutation.isError && (
          <p className="mt-3 text-xs text-danger" role="alert">
            下载失败：{errorMessage(downloadMutation.error, '请重试')}
          </p>
        )}
      </section>

      <section className="panel overflow-hidden">
        <div className="panel-header">
          <div className="flex items-center gap-2">
            <Files size={17} className="text-accent-dark" />
            <h3 className="text-sm font-semibold">材料列表</h3>
          </div>
          {materialsQuery.data && (
            <StatusBadge tone="neutral">{materialsQuery.data.total} 项</StatusBadge>
          )}
        </div>

        {materialsQuery.isPending ? (
          <LoadingState compact message="正在读取材料列表…" />
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
        ) : (
          <>
            <div className="hidden md:block">
              <DataTable columns={columns} data={materials} rowKey={(m) => m.material_id} />
            </div>
            <ul className="divide-y divide-line-soft md:hidden">
              {materials.map((material) => (
                <li key={material.material_id} className="px-4 py-3">
                  <div className="flex items-start justify-between gap-2">
                    <Link
                      to={`/materials/${material.material_id}`}
                      className="min-w-0 break-all text-sm font-medium text-ink hover:text-accent-dark"
                    >
                      {material.filename}
                    </Link>
                    <StatusBadge tone={parseStatusTone(material.parse_status)}>
                      {parseStatusLabel[material.parse_status]}
                    </StatusBadge>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-ink-muted">
                    <StatusBadge tone={materialTypeTone(material.material_type)} dot={false}>
                      {materialTypeLabel[material.material_type]}
                    </StatusBadge>
                    <span className="mono">{formatBytes(material.size_bytes)}</span>
                    <span className="mono">{material.chunk_count} 块 / {material.fact_count} 事实</span>
                    <span className="mono">{formatDateTime(material.created_at)}</span>
                  </div>
                  {material.error_message && (
                    <p className="mt-2 break-words text-xs text-danger">{material.error_message}</p>
                  )}
                  <div className="mt-3">{renderActions(material)}</div>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
    </div>
  )
}
