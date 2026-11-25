import { useEffect, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowLeft, ArrowRight, Check, CheckCircle2, ChevronDown, ExternalLink,
  KeyRound, Loader2, LockKeyhole, Server, Settings2, ShieldCheck, Sparkles, XCircle,
} from 'lucide-react'
import { Link } from 'react-router-dom'
import { ApiError } from '../services/api'
import { modelApi } from '../services/modelApi'
import type { ModelProvider, TestResult } from '../types/model'
import { toast } from '../stores/toastStore'

const FAIL_COPY: Record<string, { title: string; hint: string }> = {
  auth_failed: { title: '密钥没有通过验证', hint: '重新复制 API 密钥，确认没有多余空格，并检查它是否已开通所选模型。' },
  rate_limited: { title: '请求太频繁或额度用完了', hint: '稍后再试，或到服务商控制台检查额度与限流设置。' },
  timeout: { title: '服务商响应太慢', hint: '检查网络；如果服务在境外，可在高级设置里适当调大超时时间。' },
  network_error: { title: '连不上服务商', hint: '检查网络和代理设置。若是自建服务，再确认服务地址是否可访问。' },
  incompatible_format: { title: '服务商返回格式不兼容', hint: '可能选错了协议或接口地址。确认服务商类型，或换用官方兼容接口。' },
  model_not_found: { title: '找不到这个模型', hint: '检查模型名称，或到服务商控制台确认这个模型已对你开放。' },
  capability_unsupported: { title: '这个模型不支持当前能力', hint: '换一个支持对话/文本的模型；能力限制来自服务商，不是前端假报。' },
  ssrf_blocked: { title: '服务地址被安全策略拦截', hint: '自定义地址必须是公网 http/https 地址，不能指向内网、本机或文件地址。' },
  provider_error: { title: '服务商返回了错误', hint: '先看下面的技术详情；多数是密钥权限、服务欠费或接口临时故障。' },
}

function humanError(error: unknown): string {
  if (error instanceof ApiError) {
    if (/MODEL_CREDENTIAL_KEY|加密密钥/.test(error.message)) {
      return '服务器还没有配置模型凭据加密密钥（MODEL_CREDENTIAL_KEY），暂时不能安全保存 API 密钥。请联系管理员配置后再试；你的密钥没有被发送或写入数据库。'
    }
    return error.message
  }
  const message = error instanceof Error ? error.message : String(error)
  if (/Failed to fetch|network/i.test(message)) return '连接不上 ReproCheck 后端，请确认服务已启动。'
  return message || '操作没有完成，请稍后重试。'
}

/**
 * 真实五步向导：选择服务商 → 输入密钥 → 选择模型 → 测试连接 → 保存。
 * 每一步只做一个决定，高级参数默认折叠；测试和保存都调用真实后端。
 */
export default function GuidedModelSetup({ onDone }: { onDone?: () => void }) {
  const qc = useQueryClient()
  const providersQ = useQuery({ queryKey: ['model-providers'], queryFn: modelApi.providers })
  const profilesQ = useQuery({ queryKey: ['model-profiles'], queryFn: modelApi.profiles })
  const [stage, setStage] = useState<0 | 1 | 2 | 3 | 4 | 5>(0)
  const [providerKey, setProviderKey] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [modelId, setModelId] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [timeoutS, setTimeoutS] = useState(60)
  const [maxTokens, setMaxTokens] = useState('')
  const [temperature, setTemperature] = useState('0')
  const [advanced, setAdvanced] = useState(false)
  const [testing, setTesting] = useState(false)
  const [saving, setSaving] = useState(false)
  const [testResult, setTestResult] = useState<TestResult | null>(null)
  const [error, setError] = useState('')
  const [savedName, setSavedName] = useState('')

  const provider = useMemo(
    () => providersQ.data?.find((item: ModelProvider) => item.key === providerKey) ?? null,
    [providerKey, providersQ.data],
  )
  const models = provider?.default_models ?? []
  const fail = testResult && testResult.status !== 'success' ? FAIL_COPY[testResult.status] ?? FAIL_COPY.provider_error : null

  useEffect(() => {
    if (provider && !modelId && provider.default_models.length) setModelId(provider.default_models[0])
  }, [provider, modelId])

  const resetTest = () => { setTestResult(null); setError('') }

  const chooseProvider = (item: ModelProvider) => {
    setProviderKey(item.key)
    setModelId(item.default_models[0] ?? '')
    setBaseUrl('')
    setAdvanced(false)
    resetTest()
    setStage(1)
  }

  const goModelStep = () => {
    if (!apiKey.trim()) {
      setError('请先粘贴 API 密钥。它通常是一串以 sk- 或其他前缀开头的长字符。')
      return
    }
    setError('')
    setStage(2)
  }

  const goTestStep = () => {
    if (!modelId.trim()) {
      setError('请选择一个常用模型，或在下面手动填写模型名称。')
      return
    }
    setError('')
    setStage(3)
  }

  const test = async () => {
    if (!provider) return
    if (!apiKey.trim()) return setError('请先粘贴 API 密钥。')
    if (!modelId.trim()) return setError('请选择或填写模型名称。')
    setTesting(true); setError(''); setTestResult(null)
    try {
      const result = await modelApi.testDraft({
        provider_key: provider.key, api_key: apiKey.trim(), model_id: modelId.trim(),
        base_url: baseUrl.trim() || undefined,
      })
      setTestResult(result)
      if (result.status === 'success') {
        setStage(4)
        toast.success('连接测试通过，可以保存')
      } else {
        toast.error('连接没有通过，请按提示修改')
      }
    } catch (err) {
      setError(humanError(err))
    } finally {
      setTesting(false)
    }
  }

  const save = async () => {
    if (!provider || testResult?.status !== 'success') return
    setSaving(true); setError('')
    try {
      const result = await modelApi.createGuidedSetup({
        provider_key: provider.key, api_key: apiKey.trim(), model_id: modelId.trim(),
        display_name: modelId.trim(), name: provider.name,
        base_url: baseUrl.trim() || undefined,
        timeout_s: timeoutS,
        max_tokens: maxTokens.trim() ? Number(maxTokens) : null,
        temperature: temperature.trim() === '' ? null : Number(temperature),
        is_default: true,
      })
      setSavedName(result.profile.display_name || result.profile.model_id)
      setStage(5)
      setApiKey('')
      await qc.invalidateQueries()
      toast.success('AI 助手已连接')
      onDone?.()
    } catch (err) {
      setError(humanError(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="ux-model-wizard">
      <header className="ux-model-wizard__head">
        <div>
          <span className="ux-eyebrow"><Sparkles size={14} /> AI 连接向导</span>
          <h2>把 AI 助手接进来，只需要五步</h2>
          <p>每一步只回答一个问题。测试时密钥只临时用于这一次真实调用；保存时才加密写入后端。浏览器不存明文，页面也不会再次显示完整密钥。</p>
        </div>
        <span className="ux-chip ux-chip--neutral"><LockKeyhole size={13} />密钥不回显</span>
      </header>

      <ol className="ux-model-progress" aria-label="API 配置步骤">
        {['选择服务商', '输入密钥', '选择模型', '测试连接', '保存'].map((label, index) => {
          const active = stage === index
          const done = stage > index
          return <li key={label} className={`${active ? 'is-active' : ''}${done ? ' is-done' : ''}`}><span>{done ? <Check size={12} /> : index + 1}</span>{label}</li>
        })}
      </ol>

      {profilesQ.data?.length && stage === 0 ? (
        <div className="ux-callout ux-callout--success">
          <CheckCircle2 size={16} />你已经连接了 {profilesQ.data.length} 个模型。仍可在这里重新配置一个默认模型。
        </div>
      ) : null}

      {stage === 0 && (
        <section className="ux-model-panel">
          <div className="ux-model-panel__title">
            <span><Server size={18} /></span>
            <div><h3>第 1 步：你用的是哪家 AI 服务？</h3><p>列表由当前后端真实适配器生成，不是前端编的“已支持”。</p></div>
          </div>
          {providersQ.isLoading ? <div className="ux-guided-loading"><Loader2 size={16} />正在读取服务商…</div> : null}
          {providersQ.isError ? <div className="ux-callout ux-callout--danger">读取服务商失败：{humanError(providersQ.error)}</div> : null}
          <div className="ux-provider-grid">
            {providersQ.data?.map((item: ModelProvider) => (
              <button type="button" key={item.key} className="ux-provider-card" onClick={() => chooseProvider(item)}>
                <span className="ux-provider-card__mark">{item.name.slice(0, 1)}</span>
                <span className="ux-provider-card__copy">
                  <strong>{item.name}</strong>
                  <small>{item.default_models.length ? `${item.default_models.length} 个常用模型` : '需要手动填写模型'}{item.requires_custom_url ? ' · 自填地址' : ''}</small>
                </span>
                <ArrowRight size={15} />
              </button>
            ))}
          </div>
          <p className="ux-form-note">“未真实联调”表示后端没有厂商的真实密钥样本；只有你用自己密钥完成测试，才算真正验证通过。</p>
        </section>
      )}

      {stage === 1 && provider && (
        <section className="ux-model-panel">
          <div className="ux-model-panel__title">
            <span><KeyRound size={18} /></span>
            <div><h3>第 2 步：粘贴 {provider.name} 的 API 密钥</h3><p>不知道去哪里拿？打开服务商控制台，创建 API Key 后复制粘贴。</p></div>
            {provider.docs_url && <a href={provider.docs_url} target="_blank" rel="noreferrer" className="ux-text-link">官方文档<ExternalLink size={13} /></a>}
          </div>
          <label className="ux-model-field">
            <span>API 密钥 <b>必填</b><small>只提交给后端，浏览器不保存</small></span>
            <div className="ux-input-with-icon">
              <LockKeyhole size={16} />
              <input className="field-input" type="password" autoComplete="off" spellCheck={false} value={apiKey}
                onChange={(e) => { setApiKey(e.target.value); resetTest() }}
                placeholder={provider.key === 'openai_compatible' ? '粘贴服务商提供的密钥' : '粘贴 API Key'} />
            </div>
          </label>
          {provider.requires_custom_url && (
            <label className="ux-model-field">
              <span>服务地址 <b>必填</b><small>OpenAI 兼容服务需要自建或自填地址</small></span>
              <input className="field-input" value={baseUrl} onChange={(e) => { setBaseUrl(e.target.value); resetTest() }} placeholder={provider.default_base_url || 'https://.../v1'} />
            </label>
          )}
          {error && <div className="ux-callout ux-callout--danger">{error}</div>}
          <div className="ux-model-actions">
            <button type="button" className="ux-text-link" onClick={() => { resetTest(); setStage(0) }}><ArrowLeft size={14} />换服务商</button>
            <button type="button" className="ux-onboard-primary" onClick={goModelStep}>下一步：选择模型<ArrowRight size={16} /></button>
          </div>
        </section>
      )}

      {stage === 2 && provider && (
        <section className="ux-model-panel">
          <div className="ux-model-panel__title">
            <span><Server size={18} /></span>
            <div><h3>第 3 步：使用哪个模型？</h3><p>先用服务商提供的常用模型，最不容易出错；也可以手动填写模型名称。</p></div>
          </div>
          <div className="ux-model-field">
            <span>常用模型 <b>必填</b><small>这些都是后端返回的服务商默认模型</small></span>
            {models.length > 0 ? (
              <div className="ux-model-options">
                {models.map((model) => (
                  <button type="button" key={model} className={`ux-model-option${modelId === model ? ' is-selected' : ''}`}
                    onClick={() => { setModelId(model); resetTest() }}>
                    <span>{modelId === model ? <Check size={13} /> : <span />}</span>
                    <strong>{model}</strong>
                  </button>
                ))}
              </div>
            ) : <div className="ux-callout ux-callout--neutral">这家服务商需要你手动填写模型名称。</div>}
            <label className="ux-model-custom">
              <span>模型名称（可自定义）</span>
              <input className="field-input" value={modelId} onChange={(e) => { setModelId(e.target.value); resetTest() }} placeholder="例如：gpt-4o-mini / deepseek-chat" />
            </label>
          </div>

          {!provider.requires_custom_url && (
            <>
              <button type="button" className="ux-model-advanced-toggle" onClick={() => setAdvanced((v) => !v)} aria-expanded={advanced}>
                <Settings2 size={15} />高级设置（通常不用改）<ChevronDown size={15} className={advanced ? 'is-open' : ''} />
              </button>
              {advanced && (
                <div className="ux-model-advanced">
                  <label><span>服务地址 <small>通常留空，使用默认地址</small></span><input className="field-input" value={baseUrl} onChange={(e) => { setBaseUrl(e.target.value); resetTest() }} placeholder={provider.default_base_url || 'https://.../v1'} /></label>
                  <div className="ux-model-advanced__row">
                    <label><span>请求超时（秒）</span><input className="field-input" type="number" min={5} max={300} value={timeoutS} onChange={(e) => setTimeoutS(Number(e.target.value) || 60)} /></label>
                    <label><span>最大输出长度</span><input className="field-input" type="number" min={1} placeholder="留空由服务商决定" value={maxTokens} onChange={(e) => setMaxTokens(e.target.value)} /></label>
                    <label><span>温度（0 最稳定）</span><input className="field-input" type="number" min={0} max={2} step={0.1} value={temperature} onChange={(e) => setTemperature(e.target.value)} /></label>
                  </div>
                  <p className="ux-form-note">只呈现后端实际支持的高级项，不会显示填了也无效的假参数。</p>
                </div>
              )}
            </>
          )}

          {error && <div className="ux-callout ux-callout--danger">{error}</div>}
          <div className="ux-model-actions">
            <button type="button" className="ux-text-link" onClick={() => { resetTest(); setStage(1) }}><ArrowLeft size={14} />修改密钥</button>
            <button type="button" className="ux-onboard-primary" onClick={goTestStep}>下一步：测试连接<ArrowRight size={16} /></button>
          </div>
        </section>
      )}

      {stage >= 3 && stage <= 4 && provider && (
        <section className="ux-model-panel">
          <div className="ux-model-panel__title">
            <span><ShieldCheck size={18} /></span>
            <div><h3>{stage === 3 ? '第 4 步：真实测试连接' : '第 5 步：保存这条连接'}</h3><p>{stage === 3 ? '点击下面的按钮，ReproCheck 会用你填的信息真实调用一次服务商。' : '测试已通过；保存后它会成为默认 AI 助手。'}</p></div>
          </div>
          <div className="ux-model-summary">
            <div><span>服务商</span><strong>{provider.name}</strong></div>
            <div><span>模型</span><strong>{modelId}</strong></div>
            <div><span>地址</span><strong>{baseUrl || provider.default_base_url || '由服务商默认地址处理'}</strong></div>
            <div><span>密钥</span><strong><LockKeyhole size={13} />已填写，不会回显</strong></div>
          </div>

          {stage === 3 && (
            <>
              {testResult && testResult.status === 'success' ? (
                <div className="ux-test-result ux-test-result--success">
                  <CheckCircle2 size={22} />
                  <div><strong>连接成功，已真实调用服务商</strong><p>{testResult.model} · {testResult.latency_ms} ms · 返回：“{testResult.reply_preview || 'OK'}”</p></div>
                </div>
              ) : fail ? (
                <div className="ux-test-result ux-test-result--danger">
                  <XCircle size={22} />
                  <div>
                    <strong>{fail.title}</strong>
                    <p>{fail.hint}</p>
                    <details><summary>技术详情（给需要排错的人）</summary><pre>{testResult?.error_code} · {testResult?.error_message}</pre></details>
                  </div>
                </div>
              ) : (
                <div className="ux-callout ux-callout--neutral">点击下面的按钮后会发起一次真实网络请求；不会写入数据库，也不保存这条临时凭据。</div>
              )}
              {error && <div className="ux-callout ux-callout--danger">{error}</div>}
              <div className="ux-model-actions">
                <button type="button" className="ux-text-link" onClick={() => { resetTest(); setStage(2) }}><ArrowLeft size={14} />修改模型</button>
                <button type="button" className="ux-onboard-primary" onClick={test} disabled={testing}>
                  {testing ? <Loader2 size={16} className="ux-spin" /> : <ShieldCheck size={16} />}
                  {testing ? '正在真实调用服务商…' : fail ? '重新测试连接' : '开始真实测试'}
                </button>
              </div>
            </>
          )}

          {stage === 4 && (
            <>
              <div className="ux-test-result ux-test-result--success">
                <CheckCircle2 size={22} />
                <div><strong>连接成功，已真实调用服务商</strong><p>{testResult?.model} · {testResult?.latency_ms} ms · 返回：“{testResult?.reply_preview || 'OK'}”</p><small>保存前不会写入数据库；保存失败会整体回滚，不会留下半条配置。</small></div>
              </div>
              {error && <div className="ux-callout ux-callout--danger">{error}</div>}
              <div className="ux-model-actions">
                <button type="button" className="ux-text-link" onClick={() => { resetTest(); setStage(3) }}><ArrowLeft size={14} />重新测试</button>
                <button type="button" className="ux-onboard-primary" onClick={save} disabled={saving}>
                  {saving ? <Loader2 size={16} className="ux-spin" /> : <Check size={16} />}{saving ? '正在保存…' : '保存为默认 AI 助手'}
                </button>
              </div>
              <p className="ux-security-note"><ShieldCheck size={14} />密钥会在后端加密保存；列表只显示脱敏提示。</p>
            </>
          )}
        </section>
      )}

      {stage === 5 && (
        <section className="ux-model-panel ux-model-panel--done">
          <div className="ux-model-done"><span><CheckCircle2 size={30} /></span><div><h3>AI 助手已经连接</h3><p>{savedName} 已保存为默认模型。以后论文信息整理、诊断等 AI 功能会使用它。</p></div></div>
          <div className="ux-model-actions">
            <Link to="/projects" className="ux-onboard-primary">去项目里试一次<ArrowRight size={16} /></Link>
            <button type="button" className="ux-text-link" onClick={() => { setStage(0); setProviderKey(''); setApiKey(''); setTestResult(null); setSavedName('') }}>再配置一个</button>
            <Link to="/manual#api" className="ux-text-link">阅读 API 配置说明</Link>
          </div>
          <p className="ux-security-note"><ShieldCheck size={14} />密钥保存在后端并加密，列表只显示脱敏提示；请不要把密钥写进论文、代码仓库或聊天截图。</p>
        </section>
      )}
    </div>
  )
}
