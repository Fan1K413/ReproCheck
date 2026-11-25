// 第十一阶段 · Site 版模型管理中心（Deno Edge Function）
// 与本地 FastAPI /api/v1/model-* 契约保持一致：同一 SPA 页面无需改动。
// 安全：API Key 只在服务端用 WebCrypto 加密后写入托管数据库；前端永不持有明文。
// 限制：Edge Function 无法做 DNS 解析级 SSRF 校验，只能拦截字面私网地址/元数据域名；
//       其余依赖平台出站网络策略。此限制在文档中明确声明，不冒充本地版安全能力。
import {
  AppError, type Router, type Call, newId, nowIso, rows, one, parseJson,
  encryptSecret, decryptSecret, currentUser, requirePermission, projectContext,
} from './core.ts';

const PROVIDERS = [
  { key: 'qwen', name: '阿里云百炼 / 通义千问', protocol: 'openai_compatible', default_base_url: 'https://dashscope.aliyuncs.com/compatible-mode/v1', capabilities: ['text', 'stream', 'json_schema', 'tools', 'model_list', 'health', 'long_context', 'multimodal'], default_models: ['qwen-plus', 'qwen-max'], docs_url: '', notes: '官方兼容模式', requires_custom_url: false, builtin: true, real_api_tested: false },
  { key: 'deepseek', name: 'DeepSeek', protocol: 'openai_compatible', default_base_url: 'https://api.deepseek.com', capabilities: ['text', 'stream', 'json_schema', 'tools', 'model_list', 'health', 'long_context'], default_models: ['deepseek-flash'], docs_url: 'https://api-docs.deepseek.com', notes: '', requires_custom_url: false, builtin: true, real_api_tested: false },
  { key: 'zhipu', name: '智谱 AI (GLM)', protocol: 'openai_compatible', default_base_url: 'https://open.bigmodel.cn/api/paas/v4', capabilities: ['text', 'stream', 'json_schema', 'tools', 'model_list', 'health', 'long_context'], default_models: ['glm-4-plus'], docs_url: '', notes: '', requires_custom_url: false, builtin: true, real_api_tested: false },
  { key: 'moonshot', name: '月之暗面 Kimi', protocol: 'openai_compatible', default_base_url: 'https://api.moonshot.cn/v1', capabilities: ['text', 'stream', 'json_schema', 'tools', 'model_list', 'health', 'long_context'], default_models: ['kimi-k3'], docs_url: '', notes: '', requires_custom_url: false, builtin: true, real_api_tested: false },
  { key: 'volcengine', name: '火山引擎 / 豆包', protocol: 'openai_compatible', default_base_url: 'https://ark.cn-beijing.volces.com/api/v3', capabilities: ['text', 'stream', 'json_schema', 'tools', 'model_list', 'health', 'long_context'], default_models: [], docs_url: '', notes: '', requires_custom_url: false, builtin: true, real_api_tested: false },
  { key: 'hunyuan', name: '腾讯混元', protocol: 'openai_compatible', default_base_url: 'https://api.hunyuan.cloud.tencent.com/v1', capabilities: ['text', 'stream', 'json_schema', 'tools', 'model_list', 'health', 'long_context'], default_models: ['hy4'], docs_url: '', notes: '', requires_custom_url: false, builtin: true, real_api_tested: false },
  { key: 'openai', name: 'OpenAI', protocol: 'openai_compatible', default_base_url: 'https://api.openai.com/v1', capabilities: ['text', 'stream', 'json_schema', 'tools', 'model_list', 'health', 'long_context'], default_models: ['gpt-4o-mini'], docs_url: '', notes: '', requires_custom_url: false, builtin: true, real_api_tested: false },
  { key: 'anthropic', name: 'Anthropic Claude', protocol: 'anthropic_messages', default_base_url: 'https://api.anthropic.com/v1', capabilities: ['text', 'stream', 'json_schema', 'tools', 'model_list', 'health', 'long_context'], default_models: ['claude-sonnet-4-5'], docs_url: '', notes: '原生 Messages API', requires_custom_url: false, builtin: true, real_api_tested: false },
  { key: 'gemini', name: 'Google Gemini', protocol: 'gemini_generate', default_base_url: 'https://generativelanguage.googleapis.com/v1beta', capabilities: ['text', 'stream', 'json_schema', 'tools', 'model_list', 'health', 'long_context', 'multimodal'], default_models: ['gemini-2.5-flash'], docs_url: '', notes: '原生 generateContent', requires_custom_url: false, builtin: true, real_api_tested: false },
  { key: 'openai_compatible', name: '自定义 OpenAI 兼容接口', protocol: 'openai_compatible', default_base_url: '', capabilities: ['text', 'stream', 'json_schema', 'tools', 'model_list', 'health', 'long_context'], default_models: [], docs_url: '', notes: '需要用户填写 Base URL', requires_custom_url: true, builtin: true, real_api_tested: false },
];
const TASK_KEYS = ['pdf_extraction', 'fact_extraction', 'diff_analysis', 'failure_diagnosis', 'rag_qa', 'report_generation', 'summary'];
const PROVIDER_MAP = new Map(PROVIDERS.map(p => [p.key, p]));

const modelKey = (c: Call): string => {
  const deno = (globalThis as any).Deno;
  const explicit = deno?.env?.get?.('APP_MODEL_KEY') || '';
  // 未配置独立密钥时回落到 APP_JWT_SECRET：仍是服务端密钥，不落浏览器；
  // 但安全隔离弱于独立密钥，文档必须说明并在生产自检中告警。
  return explicit || c.secret;
};

function assertSafeUrl(raw: string): string {
  const url = (raw || '').trim().replace(/\/+$/, '');
  if (!url) throw new AppError('SSRF_BLOCKED', '模型地址不能为空。');
  let parsed: URL;
  try { parsed = new URL(url); } catch { throw new AppError('SSRF_BLOCKED', '模型地址格式非法。'); }
  if (parsed.username || parsed.password) throw new AppError('SSRF_BLOCKED', '地址不允许携带用户名或密码。');
  if (parsed.protocol !== 'https:') throw new AppError('SSRF_BLOCKED', 'Site 版仅允许 HTTPS 模型地址。');
  const host = parsed.hostname.toLowerCase();
  if (['metadata', 'metadata.google.internal', '169.254.169.254', 'localhost', '127.0.0.1'].includes(host)
      || host.endsWith('.internal')) throw new AppError('SSRF_BLOCKED', '目标主机属于内部/元数据地址。');
  if (/^(10|127|169\.254|192\.168|172\.(1[6-9]|2\d|3[01]))\./.test(host)) {
    throw new AppError('SSRF_BLOCKED', '目标地址指向私网网段。');
  }
  if (parsed.pathname.includes('..') || parsed.pathname.includes('//')) {
    throw new AppError('SSRF_BLOCKED', '地址路径非法。');
  }
  return url;
}

const maskKey = (k: string) => k.length <= 8 ? '****' : `${k.slice(0, 4)}…${k.slice(-2)}`;

function credentialView(r: any) {
  return {
    id: r.id, provider_key: r.provider_key, name: r.name, key_hint: r.key_hint,
    base_url: r.base_url, status: r.status, last_error_code: r.last_error_code ?? null,
    last_tested_at: r.last_tested_at ?? null, created_at: r.created_at ?? null,
    has_key: !!r.key_ciphertext,
  };
}
function profileView(r: any) {
  return {
    id: r.id, provider_key: r.provider_key, credential_id: r.credential_id ?? null,
    model_id: r.model_id, display_name: r.display_name, params: parseJson(r.params_json, {}),
    timeout_s: Number(r.timeout_s ?? 60), max_retries: Number(r.max_retries ?? 1),
    max_tokens: r.max_tokens ?? null, enabled: !!r.enabled,
    is_default: !!r.is_default, is_fallback: !!r.is_fallback,
  };
}
function bindingView(r: any) {
  return {
    id: r.id, task_key: r.task_key, project_id: r.project_id ?? null,
    primary_profile_id: r.primary_profile_id ?? null, fallback_profile_id: r.fallback_profile_id ?? null,
    params: parseJson(r.params_json, {}), auto_route: !!r.auto_route,
    cost_preference: r.cost_preference ?? 'balanced', enabled: !!r.enabled,
  };
}

async function ownCredential(c: Call, id: string): Promise<any> {
  const row = one(await c.db.from('model_credentials').select('*').eq('id', id)
    .eq('owner_user_id', c.user!.id).limit(1));
  if (!row) throw new AppError('CREDENTIAL_NOT_FOUND', '未找到该凭据，或不属于当前用户。');
  return row;
}
async function ownProfile(c: Call, id: string): Promise<any> {
  const row = one(await c.db.from('model_profiles').select('*').eq('id', id)
    .eq('owner_user_id', c.user!.id).limit(1));
  if (!row) throw new AppError('NOT_FOUND', '未找到该模型配置，或不属于当前用户。');
  return row;
}

/** 真实调用目标 API 的连接测试（返回细分状态，不通过 Key 非空判定成功）。 */
async function realTest(providerKey: string, baseUrl: string, apiKey: string,
                        model: string, protocol: string): Promise<any> {
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25000);
  try {
    let url: string;
    let headers: Record<string, string>;
    let payload: any;
    if (protocol === 'anthropic_messages') {
      url = `${baseUrl}/messages`;
      headers = { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' };
      payload = { model, messages: [{ role: 'user', content: '请只回复：OK' }], max_tokens: 32 };
    } else if (protocol === 'gemini_generate') {
      url = `${baseUrl}/models/${model}:generateContent`;
      headers = { 'content-type': 'application/json', 'x-goog-api-key': apiKey };
      payload = { contents: [{ role: 'user', parts: [{ text: '请只回复：OK' }] }], generationConfig: { maxOutputTokens: 32 } };
    } else {
      url = `${baseUrl}/chat/completions`;
      headers = { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` };
      payload = { model, messages: [{ role: 'user', content: '请只回复：OK' }], max_tokens: 32, temperature: 0 };
    }
    const resp = await fetch(url, { method: 'POST', headers, body: JSON.stringify(payload),
                                    signal: controller.signal, redirect: 'error' });
    const text = await resp.text();
    if (resp.status === 401 || resp.status === 403) return testResult('auth_failed', providerKey, model, 'LLM_INVALID_KEY', started);
    if (resp.status === 429) return testResult('rate_limited', providerKey, model, 'LLM_RATE_LIMITED', started);
    if (resp.status >= 500) return testResult('provider_error', providerKey, model, 'LLM_PROVIDER_ERROR', started);
    if (!resp.ok) return testResult('provider_error', providerKey, model, 'LLM_PROVIDER_ERROR', started);
    let preview = '';
    try {
      const data = JSON.parse(text);
      preview = String(data?.choices?.[0]?.message?.content ?? data?.content?.[0]?.text ??
        data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '').slice(0, 120);
    } catch { return testResult('incompatible_format', providerKey, model, 'LLM_INVALID_FORMAT', started); }
    return { status: 'success', provider: providerKey, model, reply_preview: preview,
             latency_ms: Date.now() - started, checked_at: nowIso() };
  } catch (err: any) {
    const code = err?.name === 'AbortError' ? 'LLM_TIMEOUT' : 'LLM_NETWORK_ERROR';
    return testResult(code === 'LLM_TIMEOUT' ? 'timeout' : 'network_error', providerKey, model, code, started);
  } finally { clearTimeout(timer); }
}
function testResult(status: string, provider: string, model: string, errorCode: string, started: number) {
  return { status, provider, model, error_code: errorCode, latency_ms: Date.now() - started, checked_at: nowIso() };
}

export function register(router: Router) {
  router.get('/api/v1/model-providers', async () => PROVIDERS);
  router.get('/api/v1/model-capabilities', async () => ({
    capabilities: ['text', 'stream', 'json_schema', 'tools', 'multimodal', 'model_list', 'health', 'long_context']
      .map(key => ({ key, label: key })),
    task_keys: TASK_KEYS,
    note: 'Site 版 Edge Function 支持凭据管理与真实连接测试；本地执行/沙箱能力不可用。',
  }));

  router.get('/api/v1/model-credentials', async (c: Call) =>
    rows(await c.db.from('model_credentials').select('*').eq('owner_user_id', c.user!.id)
      .order('created_at', { ascending: false })).map(credentialView));

  router.post('/api/v1/model-credentials', async (c: Call) => {
    const p = PROVIDER_MAP.get(c.body?.provider_key);
    if (!p) throw new AppError('VALIDATION_ERROR', '未知的模型供应商。');
    const key = String(c.body?.api_key ?? '').trim();
    if (!key) throw new AppError('VALIDATION_ERROR', 'API Key 不能为空。');
    let baseUrl = String(c.body?.base_url ?? p.default_base_url ?? '').trim();
    if (c.body?.provider_key === 'openai_compatible') baseUrl = assertSafeUrl(baseUrl);
    const r = one(await c.db.from('model_credentials').insert({
      id: newId('mcred'), owner_user_id: c.user!.id, provider_key: p.key,
      name: String(c.body?.name ?? p.name).slice(0, 120),
      key_ciphertext: await encryptSecret(key, modelKey(c)), key_hint: maskKey(key),
      base_url: baseUrl, status: 'active', created_at: nowIso(),
    }).select('*'));
    return credentialView(r);
  });

  router.patch('/api/v1/model-credentials/:id', async (c: Call) => {
    const r = await ownCredential(c, c.params.id);
    const patch: any = {};
    if (c.body?.name !== undefined) patch.name = String(c.body.name).slice(0, 120);
    if (c.body?.api_key) {
      const key = String(c.body.api_key).trim();
      patch.key_ciphertext = await encryptSecret(key, modelKey(c));
      patch.key_hint = maskKey(key);
    }
    if (c.body?.base_url !== undefined) patch.base_url = assertSafeUrl(String(c.body.base_url));
    if (c.body?.status !== undefined) {
      if (!['active', 'revoked', 'disabled'].includes(c.body.status)) throw new AppError('VALIDATION_ERROR', '凭据状态非法。');
      patch.status = c.body.status;
    }
    const updated = one(await c.db.from('model_credentials').update(patch).eq('id', r.id).select('*'));
    return credentialView(updated);
  });
  router.delete('/api/v1/model-credentials/:id', async (c: Call) => {
    const r = await ownCredential(c, c.params.id);
    await c.db.from('model_credentials').update({ status: 'revoked' }).eq('id', r.id);
    return { revoked: true, id: r.id };
  });
  router.delete('/api/v1/model-credentials/:id/purge', async (c: Call) => {
    const r = await ownCredential(c, c.params.id);
    await c.db.from('model_credentials').delete().eq('id', r.id);
    return { deleted: true, id: r.id };
  });

  router.post('/api/v1/model-credentials/:id/test', async (c: Call) => {
    const cred = await ownCredential(c, c.params.id);
    const p = PROVIDER_MAP.get(cred.provider_key);
    if (!p) throw new AppError('NOT_FOUND', '供应商不存在。');
    let model = String(c.q.get('model_id') ?? '');
    if (!model) {
      const profile = one(await c.db.from('model_profiles').select('model_id')
        .eq('credential_id', cred.id).limit(1));
      model = profile?.model_id ?? p.default_models[0] ?? '';
    }
    if (!model) throw new AppError('VALIDATION_ERROR', '请提供要测试的模型名称。');
    const baseUrl = cred.base_url || p.default_base_url;
    if (cred.provider_key === 'openai_compatible') assertSafeUrl(baseUrl);
    const apiKey = await decryptSecret(cred.key_ciphertext, modelKey(c));
    const result = await realTest(cred.provider_key, baseUrl, apiKey, model, p.protocol);
    await c.db.from('model_credentials').update({
      last_tested_at: nowIso(), last_error_code: result.error_code ?? null,
    }).eq('id', cred.id);
    return result;
  });

  router.post('/api/v1/model-credentials/:id/models', async (c: Call) => {
    const cred = await ownCredential(c, c.params.id);
    const p = PROVIDER_MAP.get(cred.provider_key);
    if (!p) throw new AppError('NOT_FOUND', '供应商不存在。');
    const baseUrl = cred.base_url || p.default_base_url;
    if (cred.provider_key === 'openai_compatible') assertSafeUrl(baseUrl);
    const apiKey = await decryptSecret(cred.key_ciphertext, modelKey(c));
    const headers: Record<string, string> = p.protocol === 'gemini_generate'
      ? { 'x-goog-api-key': apiKey } : p.protocol === 'anthropic_messages'
        ? { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' }
        : { authorization: `Bearer ${apiKey}` };
    const resp = await fetch(`${baseUrl}/models`, { headers, redirect: 'error' });
    if (!resp.ok) throw new AppError('LLM_PROVIDER_ERROR', `模型列表拉取失败（HTTP ${resp.status}）。`);
    const data = await resp.json();
    const list = Array.isArray(data?.data) ? data.data : Array.isArray(data?.models) ? data.models : [];
    return { models: list.map((m: any) => ({ id: String(m.id ?? m.name ?? ''), owned_by: String(m.owned_by ?? '') })), count: list.length };
  });

  router.get('/api/v1/model-profiles', async (c: Call) =>
    rows(await c.db.from('model_profiles').select('*').eq('owner_user_id', c.user!.id)
      .order('created_at', { ascending: false })).map(profileView));

  router.post('/api/v1/model-profiles', async (c: Call) => {
    if (!PROVIDER_MAP.has(c.body?.provider_key)) throw new AppError('VALIDATION_ERROR', '未知的模型供应商。');
    const modelId = String(c.body?.model_id ?? '').trim();
    if (!modelId) throw new AppError('VALIDATION_ERROR', '模型名称不能为空。');
    if (c.body?.credential_id) await ownCredential(c, c.body.credential_id);
    if (c.body?.is_default) {
      const all = rows(await c.db.from('model_profiles').select('id').eq('owner_user_id', c.user!.id));
      for (const r of all) await c.db.from('model_profiles').update({ is_default: false }).eq('id', r.id);
    }
    if (c.body?.is_fallback) {
      const all = rows(await c.db.from('model_profiles').select('id').eq('owner_user_id', c.user!.id));
      for (const r of all) await c.db.from('model_profiles').update({ is_fallback: false }).eq('id', r.id);
    }
    const r = one(await c.db.from('model_profiles').insert({
      id: newId('mprof'), owner_user_id: c.user!.id, provider_key: c.body.provider_key,
      credential_id: c.body.credential_id ?? null, model_id: modelId,
      display_name: String(c.body.display_name ?? modelId),
      params_json: JSON.stringify(c.body.params ?? {}), timeout_s: Number(c.body.timeout_s ?? 60),
      max_retries: Number(c.body.max_retries ?? 1), max_tokens: c.body.max_tokens ?? null,
      enabled: c.body.enabled !== false, is_default: !!c.body.is_default,
      is_fallback: !!c.body.is_fallback, created_at: nowIso(),
    }).select('*'));
    return profileView(r);
  });

  router.patch('/api/v1/model-profiles/:id', async (c: Call) => {
    const old = await ownProfile(c, c.params.id);
    const patch: any = {};
    for (const key of ['display_name', 'credential_id', 'timeout_s', 'max_retries', 'max_tokens',
      'enabled', 'is_default', 'is_fallback']) {
      if (c.body?.[key] !== undefined) patch[key] = c.body[key];
    }
    if (c.body?.params !== undefined) patch.params_json = JSON.stringify(c.body.params);
    if (patch.credential_id) await ownCredential(c, patch.credential_id);
    const updated = one(await c.db.from('model_profiles').update(patch).eq('id', old.id).select('*'));
    return profileView(updated);
  });
  router.delete('/api/v1/model-profiles/:id', async (c: Call) => {
    const r = await ownProfile(c, c.params.id);
    await c.db.from('model_profiles').delete().eq('id', r.id);
    return { deleted: true, id: r.id };
  });
  router.post('/api/v1/model-profiles/:id/test', async (c: Call) => {
    const profile = await ownProfile(c, c.params.id);
    if (!profile.credential_id) throw new AppError('NOT_FOUND', '该模型未关联 API 凭据。');
    const cred = await ownCredential(c, profile.credential_id);
    const p = PROVIDER_MAP.get(profile.provider_key);
    if (!p) throw new AppError('NOT_FOUND', '供应商不存在。');
    const apiKey = await decryptSecret(cred.key_ciphertext, modelKey(c));
    const baseUrl = cred.base_url || p.default_base_url;
    if (profile.provider_key === 'openai_compatible') assertSafeUrl(baseUrl);
    return await realTest(profile.provider_key, baseUrl, apiKey, profile.model_id, p.protocol);
  });

  router.get('/api/v1/task-model-bindings', async (c: Call) => {
    const projectId = c.q.get('project_id');
    let q = c.db.from('task_model_bindings').select('*').eq('owner_user_id', c.user!.id);
    q = projectId ? q.eq('project_id', projectId) : q.is('project_id', null);
    return rows(await q).map(bindingView);
  });
  router.put('/api/v1/task-model-bindings', async (c: Call) => {
    const taskKey = String(c.body?.task_key ?? '');
    if (!TASK_KEYS.includes(taskKey)) throw new AppError('VALIDATION_ERROR', '未知的任务类型。');
    for (const id of [c.body?.primary_profile_id, c.body?.fallback_profile_id]) {
      if (id) await ownProfile(c, id);
    }
    const projectId = c.body?.project_id ?? null;
    let q = c.db.from('task_model_bindings').select('*').eq('owner_user_id', c.user!.id).eq('task_key', taskKey);
    q = projectId ? q.eq('project_id', projectId) : q.is('project_id', null);
    const existing = one(await q.limit(1));
    const payload = {
      task_key: taskKey, project_id: projectId,
      primary_profile_id: c.body?.primary_profile_id ?? null,
      fallback_profile_id: c.body?.fallback_profile_id ?? null,
      params_json: JSON.stringify(c.body?.params ?? {}),
      auto_route: !!c.body?.auto_route, cost_preference: c.body?.cost_preference ?? 'balanced',
      enabled: c.body?.enabled !== false,
    };
    const r = existing
      ? one(await c.db.from('task_model_bindings').update(payload).eq('id', existing.id).select('*'))
      : one(await c.db.from('task_model_bindings').insert({ id: newId('tbind'), owner_user_id: c.user!.id, ...payload }).select('*'));
    return bindingView(r);
  });
  router.delete('/api/v1/task-model-bindings/:id', async (c: Call) => {
    const row = one(await c.db.from('task_model_bindings').select('id').eq('id', c.params.id)
      .eq('owner_user_id', c.user!.id).limit(1));
    if (!row) throw new AppError('NOT_FOUND', '未找到该绑定。');
    await c.db.from('task_model_bindings').delete().eq('id', row.id);
    return { deleted: true, id: row.id };
  });

  router.get('/api/v1/model-call-logs', async (c: Call) => {
    const limit = Math.min(Number(c.q.get('limit') ?? 50), 500);
    let q = c.db.from('model_call_logs').select('*').eq('owner_user_id', c.user!.id)
      .order('created_at', { ascending: false }).limit(limit);
    const taskKey = c.q.get('task_key');
    if (taskKey) q = q.eq('task_key', taskKey);
    return rows(await q).map(r => ({
      id: r.id, request_id: r.request_id, task_key: r.task_key, provider_key: r.provider_key,
      model_id: r.model_id, success: !!r.success, error_code: r.error_code ?? null,
      prompt_tokens: Number(r.prompt_tokens ?? 0), completion_tokens: Number(r.completion_tokens ?? 0),
      duration_ms: Number(r.duration_ms ?? 0), fallback_reason: r.fallback_reason ?? null,
      cost_estimate: r.cost_estimate ?? 'unavailable', created_at: r.created_at ?? null,
    }));
  });
  router.get('/api/v1/model-stats', async (c: Call) => {
    const all = rows(await c.db.from('model_call_logs').select('*').eq('owner_user_id', c.user!.id));
    const durations = all.map((r: any) => Number(r.duration_ms ?? 0)).sort((a: number, b: number) => a - b);
    const group = (key: string) => {
      const out: Record<string, any> = {};
      for (const r of all) {
        const k = String(r[key] ?? 'unknown');
        const g = out[k] ?? { calls: 0, success: 0, prompt_tokens: 0, completion_tokens: 0 };
        g.calls += 1; g.success += r.success ? 1 : 0;
        g.prompt_tokens += Number(r.prompt_tokens ?? 0); g.completion_tokens += Number(r.completion_tokens ?? 0);
        out[k] = g;
      }
      return out;
    };
    const success = all.filter((r: any) => !!r.success).length;
    return {
      total_calls: all.length, success_calls: success, failed_calls: all.length - success,
      prompt_tokens: all.reduce((s: number, r: any) => s + Number(r.prompt_tokens ?? 0), 0),
      completion_tokens: all.reduce((s: number, r: any) => s + Number(r.completion_tokens ?? 0), 0),
      avg_duration_ms: all.length ? Math.trunc(durations.reduce((a: number, b: number) => a + b, 0) / all.length) : 0,
      p95_duration_ms: durations.length ? durations[Math.min(durations.length - 1, Math.floor(durations.length * 0.95))] : 0,
      by_provider: group('provider_key'), by_model: group('model_id'), by_task: group('task_key'),
      cost_note: '供应商未提供真实费用数据；cost_estimate=unavailable，不编造费用。',
    };
  });
  router.get('/api/v1/model-health', async () => []);
  router.get('/api/v1/model-routes', async (c: Call) =>
    rows(await c.db.from('model_routes').select('*').eq('owner_user_id', c.user!.id)
      .order('created_at', { ascending: false }).limit(50)).map((r: any) => ({
      id: r.id, task_key: r.task_key, chosen_profile_id: r.chosen_profile_id,
      reason: parseJson(r.reason_json, {}), auto_route: !!r.auto_route, created_at: r.created_at,
    })));
}
