import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Check,
  CheckCircle2,
  ChevronDown,
  ExternalLink,
  Eye,
  EyeOff,
  Globe,
  KeyRound,
  Loader2,
  Settings2,
  ShieldCheck,
  XCircle,
} from 'lucide-react'
import { ApiError } from '../services/api'
import { modelApi } from '../services/modelApi'
import { toast } from '../stores/toastStore'
import type { ModelProvider, TestResult } from '../types/model'

type ProtocolId = 'openai_compatible' | 'anthropic_messages' | 'gemini_generate'

const PROTOCOLS: ReadonlyArray<{
  id: ProtocolId
  label: string
  fallbackKey: string
  urlPlaceholder: string
  modelPlaceholder: string
}> = [
  {
    id: 'openai_compatible',
    label: 'OpenAI',
    fallbackKey: 'openai_compatible',
    urlPlaceholder: 'https://api.openai.com/v1',
    modelPlaceholder: 'gpt-4o-mini / deepseek-chat / qwen-plus',
  },
  {
    id: 'anthropic_messages',
    label: 'Anthropic',
    fallbackKey: 'anthropic',
    urlPlaceholder: 'https://api.anthropic.com',
    modelPlaceholder: 'claude-3-5-sonnet-20241022',
  },
  {
    id: 'gemini_generate',
    label: 'Gemini',
    fallbackKey: 'gemini',
    urlPlaceholder: 'https://generativelanguage.googleapis.com',
    modelPlaceholder: 'gemini-2.0-flash',
  },
]

const FAIL_COPY: Record<string, string> = {
  auth_failed: 'API Key 无效或未开通所选模型',
  rate_limited: '请求触发限流或额度不足',
  timeout: '服务响应超时，可调大高级参数中的超时时间',
  network_error: '无法连接目标地址，请检查网络或代理',
  incompatible_format: '返回格式不兼容，请核对所选协议与接口地址',
  model_not_found: '目标服务中找不到该模型名称',
  capability_unsupported: '该模型不支持当前对话/文本能力',
  ssrf_blocked: '地址未通过校验，请填写可访问的公网 HTTPS 地址，去掉查询参数和账密',
  provider_error: '服务商返回错误，请展开详情查看',
}

function humanError(error: unknown): string {
  if (error instanceof ApiError) {
    if (/MODEL_CREDENTIAL_KEY|加密密钥/.test(error.message)) {
      return '服务端未配置 MODEL_CREDENTIAL_KEY，暂无法加密保存密钥。'
    }
    return error.message
  }
  const message = error instanceof Error ? error.message : String(error)
  if (/Failed to fetch|network/i.test(message)) return '无法连接 ReproCheck 后端服务。'
  return message || '操作失败，请稍后重试。'
}

function normalizeProtocol(protocol?: string): ProtocolId {
  if (protocol === 'anthropic_messages' || protocol === 'gemini_generate') return protocol
  return 'openai_compatible'
}

/**
 * 添加提供商表单：
 * 选协议 + 填名称 / URL / API Key（可选填初始模型），右侧下拉框一键预填内置厂商（不含冗余的自定义项）。
 */
export default function GuidedModelSetup({ onDone }: { onDone?: () => void }) {
  const qc = useQueryClient()
  const providersQ = useQuery({ queryKey: ['model-providers'], queryFn: modelApi.providers })

  const [protocol, setProtocol] = useState<ProtocolId>('openai_compatible')
  const [presetKey, setPresetKey] = useState<string>('')
  const [providerName, setProviderName] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [modelId, setModelId] = useState('')
  const [timeoutS, setTimeoutS] = useState(60)
  const [maxTokens, setMaxTokens] = useState('')
  const [temperature, setTemperature] = useState('0')
  const [advanced, setAdvanced] = useState(false)

  const [testing, setTesting] = useState(false)
  const [saving, setSaving] = useState(false)
  const [testResult, setTestResult] = useState<TestResult | null>(null)
  const [error, setError] = useState('')

  // 过滤掉无预设 URL 的「自定义 OpenAI 兼容接口」：选协议直接填即可
  const presets = useMemo(
    () => (providersQ.data ?? []).filter((item: ModelProvider) => item.key !== 'openai_compatible'),
    [providersQ.data],
  )
  const selectedPreset = useMemo(
    () => presets.find((item) => item.key === presetKey) ?? null,
    [presetKey, presets],
  )
  const protocolMeta = PROTOCOLS.find((p) => p.id === protocol) ?? PROTOCOLS[0]

  const effectiveProviderKey = useMemo(() => {
    if (selectedPreset && normalizeProtocol(selectedPreset.protocol) === protocol) {
      return selectedPreset.key
    }
    return protocolMeta.fallbackKey
  }, [selectedPreset, protocol, protocolMeta.fallbackKey])

  const quickModels = useMemo(() => {
    if (selectedPreset?.default_models.length) return selectedPreset.default_models
    const fallback = presets.find((p) => p.key === protocolMeta.fallbackKey)
    return fallback?.default_models ?? []
  }, [selectedPreset, presets, protocolMeta.fallbackKey])

  const clearFeedback = () => {
    setTestResult(null)
    setError('')
  }

  const handleProtocolChange = (next: ProtocolId) => {
    setProtocol(next)
    clearFeedback()
    if (selectedPreset && normalizeProtocol(selectedPreset.protocol) !== next) {
      setPresetKey('')
      if (providerName === selectedPreset.name) setProviderName('')
      if (baseUrl === selectedPreset.default_base_url) setBaseUrl('')
      if (selectedPreset.default_models.includes(modelId)) setModelId('')
    }
  }

  const handlePresetChange = (key: string) => {
    setPresetKey(key)
    clearFeedback()
    const picked = presets.find((item) => item.key === key)
    if (!picked) return
    setProtocol(normalizeProtocol(picked.protocol))
    setProviderName(picked.name)
    setBaseUrl(picked.default_base_url || '')
    setModelId(picked.default_models[0] ?? '')
  }

  const handleTest = async () => {
    setError('')
    setTestResult(null)
    if (!apiKey.trim()) return setError('请填写 API Key')
    if (effectiveProviderKey === 'openai_compatible' && !baseUrl.trim()) {
      return setError('请填写接口地址（Base URL）')
    }
    const probeModel = modelId.trim() || quickModels[0] || ''
    if (!probeModel) return setError('测试连接需要填写一个模型名称')
    setTesting(true)
    try {
      const result = await modelApi.testDraft({
        provider_key: effectiveProviderKey,
        api_key: apiKey.trim(),
        model_id: probeModel,
        base_url: baseUrl.trim() || undefined,
      })
      setTestResult(result)
      if (result.status === 'success') toast.success('连接测试通过')
      else toast.error(FAIL_COPY[result.status] ?? FAIL_COPY.provider_error)
    } catch (err) {
      setError(humanError(err))
    } finally {
      setTesting(false)
    }
  }

  const handleSave = async () => {
    setError('')
    if (!apiKey.trim()) return setError('请填写 API Key')
    if (effectiveProviderKey === 'openai_compatible' && !baseUrl.trim()) {
      return setError('请填写接口地址（Base URL）')
    }
    setSaving(true)
    try {
      const name = providerName.trim() || selectedPreset?.name || protocolMeta.label
      if (modelId.trim()) {
        const setup = {
          provider_key: effectiveProviderKey,
          api_key: apiKey.trim(),
          model_id: modelId.trim(),
          display_name: modelId.trim(),
          name,
          base_url: baseUrl.trim() || undefined,
          timeout_s: timeoutS,
          max_tokens: maxTokens.trim() ? Number(maxTokens) : null,
          temperature: temperature.trim() === '' ? null : Number(temperature),
          is_default: true,
        }
        try {
          await modelApi.createGuidedSetup(setup)
        } catch (err) {
          if (!(err instanceof ApiError) || err.code !== 'CONFLICT') throw err
          if (!window.confirm(`模型「${setup.model_id}」已有配置。要更换关联的凭据和模型参数吗？`)) return
          await modelApi.createGuidedSetup({ ...setup, replace_existing: true })
        }
        toast.success(`已添加提供商「${name}」并设为默认模型`)
      } else {
        await modelApi.createCredential({
          provider_key: effectiveProviderKey,
          api_key: apiKey.trim(),
          name,
          base_url: baseUrl.trim() || undefined,
        })
        toast.success(`已添加提供商「${name}」`)
      }
      setApiKey('')
      setProviderName('')
      setPresetKey('')
      setBaseUrl('')
      setModelId('')
      setTestResult(null)
      await qc.invalidateQueries()
      onDone?.()
    } catch (err) {
      setError(humanError(err))
    } finally {
      setSaving(false)
    }
  }

  const failMessage =
    testResult && testResult.status !== 'success'
      ? FAIL_COPY[testResult.status] ?? FAIL_COPY.provider_error
      : null

  return (
    <div className="ux-model-wizard">
      <header className="ux-model-wizard__head">
        <div>
          <span className="ux-eyebrow">新增连接</span>
          <h2>添加提供商</h2>
        </div>
      </header>

      <div className="ux-model-compact">
        {/* 第一行：接口协议 + 预填提供商 */}
        <div className="ux-model-row-split">
          <div className="ux-model-group">
            <span className="field-label">接口协议</span>
            <div className="ux-proto-tabs" role="radiogroup" aria-label="接口协议">
              {PROTOCOLS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  role="radio"
                  aria-checked={protocol === item.id}
                  className={`ux-proto-tab${protocol === item.id ? ' is-active' : ''}`}
                  onClick={() => handleProtocolChange(item.id)}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>

          <div className="ux-model-group">
            <div className="ux-model-label-row">
              <label htmlFor="rc-preset-provider" className="field-label mb-0">
                预填提供商
              </label>
              {selectedPreset?.docs_url && (
                <a
                  href={selectedPreset.docs_url}
                  target="_blank"
                  rel="noreferrer"
                  className="ux-text-link text-[11px]"
                >
                  文档
                  <ExternalLink size={11} />
                </a>
              )}
            </div>
            <select
              id="rc-preset-provider"
              className="field-input"
              value={presetKey}
              onChange={(e) => handlePresetChange(e.target.value)}
              disabled={providersQ.isLoading}
            >
              <option value="">
                {providersQ.isLoading ? '读取中…' : '选择预设厂商自动填充（可选）'}
              </option>
              {presets.map((item) => (
                <option key={item.key} value={item.key}>
                  {item.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* 第二行：提供商名称 + 接口地址 */}
        <div className="ux-model-row-split">
          <div className="ux-model-group">
            <label htmlFor="rc-provider-name" className="field-label">
              名称
            </label>
            <input
              id="rc-provider-name"
              type="text"
              className="field-input"
              value={providerName}
              onChange={(e) => {
                setProviderName(e.target.value)
                clearFeedback()
              }}
              placeholder={selectedPreset?.name || `例如：课题组 ${protocolMeta.label}`}
            />
          </div>

          <div className="ux-model-group">
            <label htmlFor="rc-model-url" className="field-label">
              接口地址（Base URL）
            </label>
            <div className="ux-input-with-icon">
              <Globe size={15} />
              <input
                id="rc-model-url"
                type="url"
                className="field-input mono"
                value={baseUrl}
                onChange={(e) => {
                  setBaseUrl(e.target.value)
                  clearFeedback()
                }}
                placeholder={selectedPreset?.default_base_url || protocolMeta.urlPlaceholder}
              />
            </div>
          </div>
        </div>

        {/* 第三行：API Key + 初始模型（可选） */}
        <div className="ux-model-row-split">
          <div className="ux-model-group">
            <label htmlFor="rc-model-key" className="field-label">
              API Key
            </label>
            <div className="ux-input-with-icon ux-input-with-action">
              <KeyRound size={15} />
              <input
                id="rc-model-key"
                type={showKey ? 'text' : 'password'}
                autoComplete="off"
                spellCheck={false}
                className="field-input mono"
                value={apiKey}
                onChange={(e) => {
                  setApiKey(e.target.value)
                  clearFeedback()
                }}
                placeholder="sk-..."
              />
              <button
                type="button"
                className="ux-input-eye"
                onClick={() => setShowKey((v) => !v)}
                aria-label={showKey ? '隐藏密钥' : '显示密钥'}
              >
                {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
          </div>

          <div className="ux-model-group">
            <label htmlFor="rc-model-id" className="field-label">
              默认模型（可选）
            </label>
            <input
              id="rc-model-id"
              type="text"
              className="field-input mono"
              value={modelId}
              onChange={(e) => {
                setModelId(e.target.value)
                clearFeedback()
              }}
              placeholder={protocolMeta.modelPlaceholder}
            />
          </div>
        </div>

        {quickModels.length > 0 && (
          <div className="ux-model-options" aria-label="常用模型">
            {quickModels.map((model) => (
              <button
                type="button"
                key={model}
                className={`ux-model-option${modelId === model ? ' is-selected' : ''}`}
                onClick={() => {
                  setModelId(model)
                  clearFeedback()
                }}
              >
                <span>{modelId === model ? <Check size={11} /> : null}</span>
                <strong>{model}</strong>
              </button>
            ))}
          </div>
        )}

        <div>
          <button
            type="button"
            className="ux-model-advanced-toggle"
            onClick={() => setAdvanced((v) => !v)}
            aria-expanded={advanced}
          >
            <Settings2 size={14} />
            高级参数
            <ChevronDown size={14} className={advanced ? 'is-open' : ''} />
          </button>
          {advanced && (
            <div className="ux-model-advanced">
              <div className="ux-model-advanced__row">
                <label>
                  <span>超时（秒）</span>
                  <input
                    className="field-input mono"
                    type="number"
                    min={5}
                    max={300}
                    value={timeoutS}
                    onChange={(e) => setTimeoutS(Number(e.target.value) || 60)}
                  />
                </label>
                <label>
                  <span>最大输出</span>
                  <input
                    className="field-input mono"
                    type="number"
                    min={1}
                    placeholder="默认"
                    value={maxTokens}
                    onChange={(e) => setMaxTokens(e.target.value)}
                  />
                </label>
                <label>
                  <span>温度</span>
                  <input
                    className="field-input mono"
                    type="number"
                    min={0}
                    max={2}
                    step={0.1}
                    value={temperature}
                    onChange={(e) => setTemperature(e.target.value)}
                  />
                </label>
              </div>
            </div>
          )}
        </div>

        {testResult && testResult.status === 'success' && (
          <div className="ux-test-result ux-test-result--success">
            <CheckCircle2 size={18} />
            <div>
              <strong>连接成功</strong>
              <p className="mono">
                {testResult.model} · {testResult.latency_ms} ms · {testResult.reply_preview || 'OK'}
              </p>
            </div>
          </div>
        )}

        {failMessage && (
          <div className="ux-test-result ux-test-result--danger">
            <XCircle size={18} />
            <div>
              <strong>{failMessage}</strong>
              {testResult?.error_message && (
                <details>
                  <summary>详情</summary>
                  <pre>
                    {testResult.error_code} · {testResult.error_message}
                  </pre>
                </details>
              )}
            </div>
          </div>
        )}

        {error && <div className="ux-callout ux-callout--danger">{error}</div>}

        <div className="ux-model-actions">
          <button
            type="button"
            className="btn-ghost"
            onClick={handleTest}
            disabled={testing || saving}
          >
            {testing ? <Loader2 size={15} className="animate-spin" /> : <ShieldCheck size={15} />}
            {testing ? '测试中…' : '测试连接'}
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={handleSave}
            disabled={saving || testing}
          >
            {saving ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}
            {saving ? '保存中…' : '保存提供商'}
          </button>
        </div>
      </div>
    </div>
  )
}
