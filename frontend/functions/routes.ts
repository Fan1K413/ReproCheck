// 站点业务入口：路由分发 + 冷启动幂等种子。平台模块由 Worker 注入（_qoder/）。
import { AppError, Router, makeHandler, one } from './core.ts';
import type { Deps } from './core.ts';
import { SEED } from './seed_data.ts';
import { register as registerIdentity } from './domain_identity.ts';
import { register as registerBenchmark } from './domain_benchmark.ts';
import { register as registerRules } from './domain_rules.ts';
import { register as registerIntegrations } from './domain_integrations.ts';
import { register as registerModels } from './domain_models.ts';

export function application(deps: Deps & { requireUser?: any; BackendError?: any }) {
  const { db } = deps;
  const router = new Router();
  registerIdentity(router, deps);
  registerBenchmark(router, deps);
  registerRules(router, deps);
  registerIntegrations(router, deps);
  registerModels(router);

  let seedState: Promise<void> | null = null;
  function ensureSeed(): Promise<void> {
    if (!seedState) {
      seedState = (async () => {
        const existing = one(await db.from('users').select('id').limit(1));
        if (existing) return;
        for (const [table, list] of Object.entries(SEED)) {
          if (!list.length) continue;
          const res = await db.from(table).insert(list);
          if (res?.error) {
            // 并发冷启动：退化为按主键幂等插入。
            for (const row of list) await db.from(table).insertIfAbsent(row, { onConflict: 'id' });
          }
        }
        const check = one(await db.from('users').select('id').limit(1));
        if (!check) throw new AppError('DB_SAVE_FAILED', '演示数据初始化失败，请稍后重试。');
      })().catch(err => { seedState = null; throw err; });
    }
    return seedState;
  }

  return makeHandler(router, deps, ensureSeed);
}