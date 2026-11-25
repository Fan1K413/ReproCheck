import { useMutation, useQuery } from '@tanstack/react-query'
import { AlertTriangle, Cpu, ScanSearch } from 'lucide-react'
import { useState } from 'react'
import { StatusBadge } from './StatusBadge'
import { formatConfidence } from '../features/format'
import { reproductionApi } from '../services/reproductionApi'

/**
 * 确定性失败诊断面板（验证引擎第一层）：无需大模型密钥。
 * 只依据原始日志做规则分类，所有结论都是候选原因（is_confirmed=false）。
 */
export function DeterministicDiagnosisPanel() {
  const [rawLog, setRawLog] = useState('')
  const [errorCode, setErrorCode] = useState('')
  const categoriesQuery = useQuery({
    queryKey: ['failure-categories'],
    queryFn: () => reproductionApi.listFailureCategories(),
    staleTime: 5 * 60 * 1000,
  })

  const classifyMutation = useMutation({
    mutationFn: () => reproductionApi.classifyLog({
      raw_log: rawLog,
      error_code: errorCode.trim() || undefined,
    }),
  })

  return (
    <section className="panel p-5" aria-label="确定性失败诊断">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <Cpu size={16} className="text-accent-dark" /> 确定性诊断（无需 AI 密钥）
          </h3>
          <p className="mt-1 text-xs text-ink-muted">
            基于原始日志匹配确定性规则，推断结果仅供参考。
          </p>
        </div>
        {categoriesQuery.data && (
          <StatusBadge tone="neutral" dot={false}>
            {categoriesQuery.data.total} 类标准分类
          </StatusBadge>
        )}
      </div>

      <div className="mt-4 grid gap-3">
        <label className="block">
          <span className="field-label">原始错误日志</span>
          <textarea
            className="field-input min-h-[110px] resize-y"
            value={rawLog}
            placeholder="粘贴运行日志，例如：Traceback ... ModuleNotFoundError ..."
            onChange={(e) => setRawLog(e.target.value)}
          />
        </label>
        <label className="block">
          <span className="field-label">错误码（可选，确定性证据）</span>
          <input
            className="field-input"
            value={errorCode}
            placeholder="例如 TASK_TIMEOUT"
            onChange={(e) => setErrorCode(e.target.value)}
          />
        </label>
        <div>
          <button
            type="button"
            className="btn-primary"
            disabled={classifyMutation.isPending || (!rawLog.trim() && !errorCode.trim())}
            onClick={() => classifyMutation.mutate()}
          >
            <ScanSearch size={15} />
            {classifyMutation.isPending ? '分类中…' : '推断候选原因'}
          </button>
        </div>
      </div>

      {classifyMutation.isError && (
        <p className="mt-3 flex items-center gap-1.5 text-xs text-danger" role="alert">
          <AlertTriangle size={14} />
          {classifyMutation.error instanceof Error ? classifyMutation.error.message : '分类请求失败'}
        </p>
      )}

      {classifyMutation.data && (
        <div className="mt-4 border-t border-line-soft pt-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-ink-subtle">首要候选</span>
            <StatusBadge tone="warning" dot={false}>{classifyMutation.data.primary_label}</StatusBadge>
            <span className="mono text-[11px] text-ink-subtle">{classifyMutation.data.method}</span>
          </div>
          <ul className="mt-3 space-y-2">
            {classifyMutation.data.candidates.map((c) => (
              <li key={c.category} className="rounded-md border border-line-soft p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm font-medium text-ink">{c.label}</span>
                  <span className="flex items-center gap-2">
                    <StatusBadge tone="accent" dot={false}>
                      {formatConfidence(c.confidence)} · 候选
                    </StatusBadge>
                  </span>
                </div>
                <p className="mt-2 text-xs text-ink-muted">修复建议：{c.suggested_fix}</p>
                {c.matched_evidence.length > 0 && (
                  <p className="mono mt-1 break-all text-[11px] text-ink-subtle">
                    依据：{c.matched_evidence.join(' | ')}
                  </p>
                )}
              </li>
            ))}
          </ul>
          <p className="mt-3 rounded-md bg-warning-wash px-3 py-2 text-xs text-warning">
            {classifyMutation.data.note}
          </p>
        </div>
      )}
    </section>
  )
}
