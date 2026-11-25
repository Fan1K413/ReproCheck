/**
 * 科研交接包（图2 层叠基础态）
 *
 * 业务未变：导出 POST /projects/{id}/handoff/export、校验 POST /projects/{id}/handoff/validate
 * 均为原有逻辑，校验仍然只读不写库。
 * 特色交互：**交接包分层清单** —— 把后端返回的真实文件清单按目录层级折叠展开，
 * 每层显示真实文件数；无清单时显示空态，不虚构条目。
 */
import { useMemo, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Link, useParams } from 'react-router-dom'
import { FileArchive } from 'lucide-react'
import { Icon } from '../components/Icon'
import { EmptyState } from '../components/EmptyState'
import { ErrorState } from '../components/ErrorState'
import { JsonBlock } from '../components/JsonBlock'
import { LoadingState } from '../components/LoadingState'
import { PageHeader } from '../components/PageHeader'
import { StatusBadge } from '../components/StatusBadge'
import { useTrackProject } from '../hooks/useTrackProject'
import { ApiError, api } from '../services/api'
import { toast } from '../stores/toastStore'
import '../styles/wave-c-verify.css'

function errorInfo(error: unknown): { message: string; code?: string } {
  return {
    message: error instanceof Error ? error.message : '请求失败，请稍后重试。',
    code: error instanceof ApiError ? error.code : undefined,
  }
}

type TreeNode = {
  name: string
  path: string
  children: TreeNode[]
  files: string[]
}

/** 把扁平文件清单按路径层级聚合成树（全部来自后端真实文件列表）。 */
function buildTree(files: string[]): TreeNode {
  const root: TreeNode = { name: '', path: '', children: [], files: [] }

  for (const file of files) {
    const parts = file.split('/').filter(Boolean)
    if (parts.length === 0) continue
    let cursor = root
    let path = ''
    parts.forEach((part, index) => {
      path = path ? `${path}/${part}` : part
      const isFile = index === parts.length - 1
      if (isFile) {
        cursor.files.push(file)
        return
      }
      let next = cursor.children.find((child) => child.name === part)
      if (!next) {
        next = { name: part, path, children: [], files: [] }
        cursor.children.push(next)
      }
      cursor = next
    })
  }

  return root
}

function countFiles(node: TreeNode): number {
  return node.files.length + node.children.reduce((sum, child) => sum + countFiles(child), 0)
}

function TreeRow({ node, depth }: { node: TreeNode; depth: number }) {
  const [open, setOpen] = useState(depth < 2)
  const total = countFiles(node)

  return (
    <div>
      <button
        type="button"
        className="rc2-tree__row rc2-tree__row--dir w-full"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        style={{ paddingLeft: `calc(var(--rc-space-2) + ${depth * 14}px)` }}
      >
        <Icon name={open ? 'chevronDown' : 'chevronUp'} size="xs" tone="subtle" />
        <span className="truncate">{node.name}</span>
        <span className="rc2-tree__count">{total} 项</span>
      </button>
      {open && (
        <div className="rc2-tree__children">
          {node.children.map((child) => (
            <TreeRow key={child.path} node={child} depth={0} />
          ))}
          {node.files.map((file) => (
            <p key={file} className="rc2-tree__row truncate" title={file}>
              {file.split('/').pop()}
            </p>
          ))}
        </div>
      )}
    </div>
  )
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
  const tree = useMemo(() => buildTree(result?.files ?? []), [result])

  return (
    <div className="rc2-page">
      <PageHeader
        title="科研交接包"
        description="交接包导出与完整性校验"
        actions={
          <nav className="flex flex-wrap items-center gap-2">
            <Link to={`/projects/${projectId}/verification`} className="btn-ghost">
              项目验证
            </Link>
            <Link to={`/projects/${projectId}/materials`} className="btn-ghost">
              材料管理
            </Link>
          </nav>
        }
      />

      <div className="rc2-stack">
        <section className="rc2-card rc2-stack__full">
          <span className="rc2-card__stage rc2-card__stage--accent" aria-hidden="true" />
          <div className="rc2-card__head">
            <span className="rc2-card__index" aria-hidden="true">
              01
            </span>
            <div className="rc2-card__body">
              <h3 className="rc2-card__title">导出交接包</h3>
              <p className="rc2-card__paper">
                按当前项目数据生成交接包 ZIP。
              </p>
              <button
                type="button"
                className="btn-primary mt-4"
                disabled={!projectId || exportMutation.isPending}
                onClick={() => exportMutation.mutate()}
              >
                {exportMutation.isPending ? (
                  <Icon name="rotate" size="sm" className="animate-spin" />
                ) : (
                  <Icon name="download" size="sm" />
                )}
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
                <p
                  className="mt-3 inline-flex items-center gap-1.5 rounded px-3 py-2 text-xs"
                  style={{ backgroundColor: 'var(--rc-success-wash)', color: 'var(--rc-success)' }}
                >
                  <Icon name="badgeCheck" size="sm" tone="success" />
                  导出成功，浏览器已开始下载交接包。
                </p>
              )}
            </div>
          </div>
        </section>

        <section className="rc2-card rc2-stack__full">
          <span className="rc2-card__stage rc2-card__stage--accent" aria-hidden="true" />
          <div className="rc2-card__head">
            <span className="rc2-card__index" aria-hidden="true">
              02
            </span>
            <div className="rc2-card__body">
              <h3 className="rc2-card__title">校验交接包</h3>
              <label className="field-label mt-4" htmlFor="handoff-file">
                选择 ZIP 文件（accept=.zip）
              </label>
              <input
                id="handoff-file"
                type="file"
                accept=".zip,application/zip"
                className="rc2-file-input"
                onChange={(event) => {
                  setFile(event.target.files?.[0] ?? null)
                  validateMutation.reset()
                }}
              />
              {file && (
                <p className="rcw-chip mt-2">
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
                {validateMutation.isPending ? (
                  <Icon name="rotate" size="sm" className="animate-spin" />
                ) : (
                  <Icon name="upload" size="sm" />
                )}
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
                <div className="mt-5 flex flex-col gap-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge tone={result.valid ? 'success' : 'danger'}>
                      {result.valid ? '校验通过' : '校验未通过'}
                    </StatusBadge>
                    <StatusBadge tone="accent">import_mode: {result.import_mode}</StatusBadge>
                    {result.target_project_id && (
                      <span className="rcw-chip">目标项目：{result.target_project_id}</span>
                    )}
                  </div>

                  <div className="rc4-kpis">
                    <div className="rc4-kpi">
                      <p className="rc4-kpi__label">bundle_version</p>
                      <p className="rc4-kpi__value text-base">
                        {result.manifest?.bundle_version ?? '—'}
                      </p>
                    </div>
                    <div className="rc4-kpi">
                      <p className="rc4-kpi__label">generated_at</p>
                      <p className="rc4-kpi__value text-base">
                        {result.manifest?.generated_at ?? '—'}
                      </p>
                    </div>
                    <div className="rc4-kpi">
                      <p className="rc4-kpi__label">文件数</p>
                      <p className="rc4-kpi__value">{result.files.length}</p>
                    </div>
                    <div className="rc4-kpi">
                      <p className="rc4-kpi__label">清单层级</p>
                      <p className="rc4-kpi__value">{tree.children.length}</p>
                    </div>
                  </div>

                  <div>
                    <p className="rcw-overline mb-1">counts</p>
                    <JsonBlock value={result.manifest?.counts ?? null} />
                  </div>

                  <div>
                    <p className="rcw-overline mb-2">
                      分层文件清单（{result.files.length}）
                    </p>
                    {result.files.length > 0 ? (
                      <div className="rc2-tree">
                        {tree.children.map((child) => (
                          <TreeRow key={child.path} node={child} depth={0} />
                        ))}
                        {tree.files.map((fileName) => (
                          <p key={fileName} className="rc2-tree__row truncate" title={fileName}>
                            {fileName}
                          </p>
                        ))}
                      </div>
                    ) : (
                      <p className="rc4-list__meta">交接包未包含文件。</p>
                    )}
                  </div>

                  {result.note && (
                    <p
                      className="rounded px-3 py-2 text-xs"
                      style={{ backgroundColor: 'var(--rc-success-wash)', color: 'var(--rc-success)' }}
                    >
                      {result.note}
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>
        </section>
      </div>

      <p className="flex items-center gap-1 text-xs" style={{ color: 'var(--rc-text-subtle)' }}>
        <Icon name="arrowLeft" size="xs" />
        校验通过后如需恢复/迁移数据，请由管理员按规范流程处理；本页不会写入数据库。
      </p>
    </div>
  )
}
