import { useMutation } from '@tanstack/react-query'
import { ArrowLeft, CheckCircle2, Download, FileArchive, RotateCw, ShieldCheck, Upload } from 'lucide-react'
import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { EmptyState } from '../components/EmptyState'
import { ErrorState } from '../components/ErrorState'
import { JsonBlock } from '../components/JsonBlock'
import { LoadingState } from '../components/LoadingState'
import { PageHeader } from '../components/PageHeader'
import { StatusBadge } from '../components/StatusBadge'
import { useTrackProject } from '../hooks/useTrackProject'
import { ApiError, api } from '../services/api'
import { toast } from '../stores/toastStore'

function errorInfo(error: unknown): { message: string; code?: string } {
  return {
    message: error instanceof Error ? error.message : '请求失败，请稍后重试。',
    code: error instanceof ApiError ? error.code : undefined,
  }
}

export default function HandoffPage() {
  const projectId = useParams().projectId ?? ''
  useTrackProject(projectId)
  const [file, setFile] = useState<File | null>(null)

  const exportMutation = useMutation({
    mutationFn: () => api.exportHandoff(projectId),
    onSuccess: () => toast.success('交接包 ZIP 已开始下载'),
    onError: (error) => toast.error(errorInfo(error).message),
  })

  const validateMutation = useMutation({
    mutationFn: (selected: File) => api.validateHandoff(projectId, selected),
    onSuccess: () => toast.success('交接包完整性校验通过（未写入数据库）'),
    onError: (error) => toast.error(errorInfo(error).message),
  })

  const result = validateMutation.data

  return (
    <div className="space-y-5">
      <PageHeader
        title="科研交接包"
        description="导出项目交接 ZIP，或上传 ZIP 做完整性与安全校验；校验仅读取文件，不写数据库。"
        actions={
          <nav className="flex flex-wrap items-center gap-2">
            <Link to={`/projects/${projectId}/verification`} className="btn-ghost">项目验证</Link>
            <Link to={`/projects/${projectId}/materials`} className="btn-ghost">材料管理</Link>
          </nav>
        }
      />

      <div className="rounded-md border border-accent/20 bg-accent-wash px-3 py-2 text-xs leading-relaxed text-ink">
        <span className="inline-flex items-center gap-1.5 font-semibold">
          <ShieldCheck size={14} className="text-accent-dark" />
          仅校验不写库
        </span>
        <span className="ml-2">上传后只验证 ZIP 路径、文件类型、manifest 与 SHA-256；后端返回 import_mode=validated_not_applied，不会导入任何数据。</span>
      </div>

      <section className="panel overflow-hidden">
        <div className="panel-header">
          <div className="flex items-center gap-2">
            <FileArchive size={17} className="text-accent-dark" />
            <h3 className="text-sm font-semibold">导出交接包</h3>
          </div>
        </div>
        <div className="p-5">
          <p className="text-xs text-ink-muted">
            POST /projects/{'{id}'}/handoff/export：按当前项目真实数据生成 ZIP（带 Bearer 下载）。
          </p>
          <button
            type="button"
            className="btn-primary mt-3"
            disabled={!projectId || exportMutation.isPending}
            onClick={() => exportMutation.mutate()}
          >
            {exportMutation.isPending
              ? <RotateCw size={15} className="animate-spin" />
              : <Download size={15} />}
            {exportMutation.isPending ? '正在生成…' : '导出 ZIP'}
          </button>
          {exportMutation.isError && (
            <div className="mt-4">
              <ErrorState
                compact
                message={errorInfo(exportMutation.error).message}
                code={errorInfo(exportMutation.error).code}
                onRetry={() => exportMutation.mutate()}
              />
            </div>
          )}
          {exportMutation.isSuccess && (
            <p className="mt-3 inline-flex items-center gap-1.5 rounded bg-success-wash px-3 py-2 text-xs text-success">
              <CheckCircle2 size={14} />
              导出成功，浏览器已开始下载交接包。
            </p>
          )}
        </div>
      </section>

      <section className="panel overflow-hidden">
        <div className="panel-header">
          <div className="flex items-center gap-2">
            <Upload size={17} className="text-accent-dark" />
            <h3 className="text-sm font-semibold">校验交接包</h3>
          </div>
        </div>
        <div className="p-5">
          <label className="block text-xs font-semibold text-ink-muted" htmlFor="handoff-file">
            选择 ZIP 文件（accept=.zip）
          </label>
          <input
            id="handoff-file"
            type="file"
            accept=".zip,application/zip"
            className="mt-2 block w-full max-w-md text-xs text-ink file:mr-3 file:rounded file:border-0 file:bg-accent file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-accent-dark"
            onChange={(event) => {
              setFile(event.target.files?.[0] ?? null)
              validateMutation.reset()
            }}
          />
          {file && (
            <p className="mono mt-2 break-all text-xs text-ink-muted">
              已选择：{file.name}（{file.size} 字节）
            </p>
          )}
          <button
            type="button"
            className="btn-primary mt-3"
            disabled={!file || !projectId || validateMutation.isPending}
            onClick={() => {
              if (file) validateMutation.mutate(file)
            }}
          >
            {validateMutation.isPending
              ? <RotateCw size={15} className="animate-spin" />
              : <Upload size={15} />}
            {validateMutation.isPending ? '正在校验…' : '上传并校验'}
          </button>

          {validateMutation.isPending && (
            <div className="mt-4">
              <LoadingState compact message="正在校验 ZIP 完整性与文件哈希…" />
            </div>
          )}
          {validateMutation.isError && (
            <div className="mt-4">
              <ErrorState
                compact
                message={errorInfo(validateMutation.error).message}
                code={errorInfo(validateMutation.error).code}
                onRetry={() => {
                  if (file) validateMutation.mutate(file)
                }}
              />
            </div>
          )}
          {!validateMutation.isPending && !validateMutation.isError && !result && (
            <div className="mt-4">
              <EmptyState
                compact
                icon={FileArchive}
                title="尚未校验交接包"
                description="选择导出的 ZIP 并点击「上传并校验」，这里会展示 manifest 摘要与文件清单。"
              />
            </div>
          )}

          {result && (
            <div className="mt-5 space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge tone={result.valid ? 'success' : 'danger'}>
                  {result.valid ? '校验通过' : '校验未通过'}
                </StatusBadge>
                <StatusBadge tone="accent">import_mode: {result.import_mode}</StatusBadge>
                {result.target_project_id && (
                  <span className="mono text-xs text-ink-subtle">目标项目：{result.target_project_id}</span>
                )}
              </div>

              <div>
                <h4 className="text-xs font-semibold text-ink">manifest 摘要</h4>
                <dl className="mt-2 grid gap-3 sm:grid-cols-2">
                  <div className="rounded-md border border-line bg-canvas px-3 py-2">
                    <dt className="text-xs text-ink-subtle">bundle_version</dt>
                    <dd className="mono mt-1 text-xs text-ink">{result.manifest?.bundle_version ?? '—'}</dd>
                  </div>
                  <div className="rounded-md border border-line bg-canvas px-3 py-2">
                    <dt className="text-xs text-ink-subtle">generated_at</dt>
                    <dd className="mono mt-1 text-xs text-ink">{result.manifest?.generated_at ?? '—'}</dd>
                  </div>
                </dl>
                <div className="mt-2">
                  <p className="text-xs text-ink-subtle">counts</p>
                  <div className="mt-1"><JsonBlock value={result.manifest?.counts ?? null} /></div>
                </div>
              </div>

              <div>
                <h4 className="text-xs font-semibold text-ink">文件列表（{result.files.length}）</h4>
                {result.files.length > 0 ? (
                  <ul className="mono mt-2 max-h-64 space-y-1 overflow-auto rounded-md border border-line bg-canvas px-3 py-2 text-[11px] text-ink-muted">
                    {result.files.map((name) => <li key={name}>{name}</li>)}
                  </ul>
                ) : (
                  <p className="mt-2 text-xs text-ink-subtle">交接包未包含文件。</p>
                )}
              </div>

              {result.note && (
                <p className="rounded bg-success-wash px-3 py-2 text-xs text-success">{result.note}</p>
              )}
            </div>
          )}
        </div>
      </section>

      <p className="flex items-center gap-1 text-xs text-ink-subtle">
        <ArrowLeft size={12} />
        校验通过后如需恢复/迁移数据，请由管理员按规范流程处理；本页不会写入数据库。
      </p>
    </div>
  )
}
