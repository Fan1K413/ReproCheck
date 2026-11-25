// 基准案例 + 遗留材料/事实 + 第四阶段复现域（镜像 backend/app/api/v1 与 services/reproduction）。
// 演示站点策略：无模型密钥 / 无 PDF 解析器 / 无沙箱运行时 —— 依赖这些运行时的写操作
// 明确抛 DEMO_LIMIT 或 LLM_KEY_NOT_CONFIGURED，绝不伪造结果；所有只读与纯 DB 变更忠实移植。
import {
  AppError, newId, nowIso, num, parseJson, rows, one, intParam, nextIntId,
  orgRole, projectRole, projectContext, requirePermission,
} from "./core.ts";
import type { Router, Deps, Call, Db, UserRow } from "./core.ts";

// ============================ 通用助手 ============================

const clean = (v: any): string => String(v || "").trim().replace(/\s+/g, " ");
const taskKey = (v: any): string => {
  let s = String(v || "").trim().toLowerCase();
  s = s.replace(/[\s\-–—/]+/g, "_");
  s = s.replace(/[^\p{L}\p{N}_\u4e00-\u9fff]+/gu, "");
  return s.replace(/_+/g, "_").replace(/^_+|_+$/g, "");
};
const asBool = (v: any): boolean => {
  if (typeof v === "boolean") return v;
  return ["1", "true", "yes", "on"].includes(String(v).trim().toLowerCase());
};
const loads = (v: any): any => parseJson(v, null);
const dumps = (v: any): string => JSON.stringify(v);
const id14 = (prefix: string): string =>
  `${prefix}-${crypto.randomUUID().replace(/-/g, "").slice(0, 14)}`;
const round4 = (x: number): number => Math.round(x * 10000) / 10000;
const cmpStr = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const tsSec = (iso: any): number => {
  const t = Date.parse(String(iso || ""));
  return Number.isFinite(t) ? t / 1000 : 0;
};
// Python f-string 风格标量渲染（报告/检索 basis 与后端逐字一致）
const pyStr = (v: any): string => {
  if (v === null || v === undefined) return "None";
  if (typeof v === "boolean") return v ? "True" : "False";
  return String(v);
};
const pyFloat = (v: any): string => {
  if (v === null || v === undefined) return "None";
  const n = Number(v);
  if (!Number.isFinite(n)) return String(v);
  if (Number.isInteger(n) && Math.abs(n) < 1e16) return n.toFixed(1);
  return String(n);
};
const pyList = (arr: string[]): string => `[${arr.map(s => `'${s}'`).join(", ")}]`;
const htmlEscape = (s: string): string =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#x27;");

// parse_tasks / evidence_items / fact_revisions 读取容错为空（历史种子可能缺行）；
// 写入必须严格成功，修订留痕不允许静默丢失。
async function softRows(p: Promise<any>): Promise<any[]> {
  try { return rows(await p); } catch { return []; }
}
async function softOne(p: Promise<any>): Promise<any | null> {
  const list = await softRows(p);
  return list.length ? list[0] : null;
}

// ---- 镜像 FastAPI/Pydantic 校验层（main.py validation_error_handler） ----
// 统一 422「请求参数校验失败。」+ details=[{loc,msg}]（最多 10 条）。
function validationError(details: { loc: (string | number)[]; msg: string }[]): never {
  throw new AppError("VALIDATION_ERROR", "请求参数校验失败。", details.slice(0, 10));
}
const TRUE_STRS = new Set(["true", "yes", "on", "1", "t", "y"]);
const FALSE_STRS = new Set(["false", "no", "off", "0", "f", "n"]);
function coerceBool(v: any): boolean | null {
  if (typeof v === "boolean") return v;
  if (typeof v === "number" && (v === 0 || v === 1)) return v === 1;
  if (typeof v === "string") {
    const low = v.trim().toLowerCase();
    if (TRUE_STRS.has(low)) return true;
    if (FALSE_STRS.has(low)) return false;
  }
  return null;
}
function coerceFloat(v: any): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v.trim());
    return Number.isFinite(n) ? n : null;
  }
  return null;
}
function coerceInt(v: any): number | null {
  if (typeof v === "number") return Number.isInteger(v) ? v : null;
  if (typeof v === "string" && /^\s*[+-]?\d+\s*$/.test(v)) return Number(v.trim());
  return null;
}
const isPlainObject = (v: any): boolean => !!v && typeof v === "object" && !Array.isArray(v);

// 未迁移到 validateBody 的处理器沿用这两个助手（语义与 extra="forbid" 模型一致）。
function bodyObj(c: Call): Record<string, any> {
  if (c.body === null || c.body === undefined) return {};
  if (!isPlainObject(c.body)) validationError([{ loc: ["body"], msg: "Input should be a valid dictionary" }]);
  return c.body;
}
function forbidExtra(body: Record<string, any>, allowed: string[]): void {
  const extra = Object.keys(body).filter(k => !allowed.includes(k));
  if (extra.length) validationError(extra.map(k => ({ loc: ["body", k], msg: "Extra inputs are not permitted" })));
}
// 镜像 benchmark_service.int_param：非法整数报错，合法值夹取到 [min, max]。
function intParamLocal(v: any, def: number, min: number, max: number): number {
  if (v === null || v === undefined || v === "") return def;
  const n = typeof v === "number" ? Math.trunc(v)
    : (/^\s*[+-]?\d+\s*$/.test(String(v)) ? Number(String(v).trim()) : NaN);
  if (!Number.isFinite(n)) throw new AppError("VALIDATION_ERROR", "limit/offset/top_k 须为整数。");
  return Math.max(min, Math.min(n, max));
}

type FieldSpecModel = {
  type: "str" | "bool" | "int" | "float" | "dict" | "list" | "dict_or_str";
  required?: boolean; nullable?: boolean; def?: any;
  minLen?: number; maxLen?: number; item?: "str";
};
// extra="forbid" 请求模型校验 + lax 强制转换；返回带默认值的规范化数据。
function validateBody(c: Call, spec: Record<string, FieldSpecModel>, bodyOptional = false): Record<string, any> {
  const raw = c.body;
  if (raw === null || raw === undefined) {
    if (bodyOptional) return applyDefaults({}, spec);
    validationError([{ loc: ["body"], msg: "Field required" }]);
  }
  if (!isPlainObject(raw)) {
    validationError([{ loc: ["body"], msg: "Input should be a valid dictionary" }]);
  }
  const details: { loc: (string | number)[]; msg: string }[] = [];
  const out: Record<string, any> = {};
  for (const key of Object.keys(raw)) {
    if (!(key in spec)) details.push({ loc: ["body", key], msg: "Extra inputs are not permitted" });
  }
  for (const [name, fspec] of Object.entries(spec)) {
    if (!(name in raw) || raw[name] === undefined) {
      if (fspec.required) details.push({ loc: ["body", name], msg: "Field required" });
      else out[name] = fspec.def !== undefined ? fspec.def : (fspec.nullable ? null : defaultFor(fspec));
      continue;
    }
    const v = raw[name];
    const loc = ["body", name];
    if (v === null) {
      if (fspec.nullable || fspec.type === "dict_or_str") { out[name] = null; continue; }
      details.push({ loc, msg: typeMsg(fspec.type) });
      continue;
    }
    switch (fspec.type) {
      case "str": {
        if (typeof v !== "string") { details.push({ loc, msg: "Input should be a valid string" }); break; }
        if (fspec.minLen !== undefined && v.length < fspec.minLen) {
          details.push({ loc, msg: `String should have at least ${fspec.minLen} character${fspec.minLen === 1 ? "" : "s"}` });
        }
        if (fspec.maxLen !== undefined && v.length > fspec.maxLen) {
          details.push({ loc, msg: `String should have at most ${fspec.maxLen} characters` });
        }
        out[name] = v;
        break;
      }
      case "bool": {
        const b = coerceBool(v);
        if (b === null) details.push({ loc, msg: "Input should be a valid boolean" });
        else out[name] = b;
        break;
      }
      case "int": {
        const n = coerceInt(v);
        if (n === null) details.push({ loc, msg: "Input should be a valid integer" });
        else out[name] = n;
        break;
      }
      case "float": {
        const n = coerceFloat(v);
        if (n === null) details.push({ loc, msg: "Input should be a valid number" });
        else out[name] = n;
        break;
      }
      case "dict": {
        if (!isPlainObject(v)) details.push({ loc, msg: "Input should be a valid dictionary" });
        else out[name] = v;
        break;
      }
      case "dict_or_str": {
        if (!isPlainObject(v) && typeof v !== "string") {
          details.push({ loc, msg: "Input should be a valid dictionary or instance of str" });
        } else out[name] = v;
        break;
      }
      case "list": {
        if (!Array.isArray(v)) { details.push({ loc, msg: "Input should be a valid list" }); break; }
        if (fspec.item === "str") {
          const bad = v.findIndex(x => typeof x !== "string");
          if (bad >= 0) { details.push({ loc: [...loc, bad], msg: "Input should be a valid string" }); break; }
        }
        out[name] = v;
        break;
      }
    }
  }
  if (details.length) validationError(details);
  return out;
}
function defaultFor(fspec: FieldSpecModel): any {
  switch (fspec.type) {
    case "str": return "";
    case "bool": return false;
    case "int": return 0;
    case "float": return 0;
    case "dict": return {};
    case "list": return [];
    default: return null;
  }
}
function applyDefaults(data: Record<string, any>, spec: Record<string, FieldSpecModel>): Record<string, any> {
  const out = { ...data };
  for (const [name, fspec] of Object.entries(spec)) {
    if (!(name in out)) out[name] = fspec.def !== undefined ? fspec.def : (fspec.nullable ? null : defaultFor(fspec));
  }
  return out;
}
function typeMsg(t: string): string {
  if (t === "str") return "Input should be a valid string";
  if (t === "bool") return "Input should be a valid boolean";
  if (t === "int") return "Input should be a valid integer";
  if (t === "float") return "Input should be a valid number";
  if (t === "list") return "Input should be a valid list";
  return "Input should be a valid dictionary";
}
// FastAPI 查询参数校验（int ge/le、bool、pattern、必填）
function queryInt(q: URLSearchParams, name: string, def: number, min?: number, max?: number): number {
  const raw = q.get(name);
  if (raw === null) return def;
  const n = coerceInt(raw);
  if (n === null) validationError([{ loc: ["query", name], msg: "Input should be a valid integer, unable to parse string as an integer" }]);
  if (min !== undefined && n < min) validationError([{ loc: ["query", name], msg: `Input should be greater than or equal to ${min}` }]);
  if (max !== undefined && n > max) validationError([{ loc: ["query", name], msg: `Input should be less than or equal to ${max}` }]);
  return n;
}
function queryBool(q: URLSearchParams, name: string): boolean | null {
  const raw = q.get(name);
  if (raw === null) return null;
  const b = coerceBool(raw);
  if (b === null) validationError([{ loc: ["query", name], msg: "Input should be a valid boolean, unable to interpret input" }]);
  return b;
}
function requireQuery(q: URLSearchParams, name: string): string {
  const v = q.get(name);
  if (v === null) validationError([{ loc: ["query", name], msg: "Field required" }]);
  return v;
}
// Python f-string 中 dict/list 的 repr 渲染（match_basis 筛选项展示）
function pyReprValue(v: any): string {
  if (v === null || v === undefined) return "None";
  if (typeof v === "boolean") return v ? "True" : "False";
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  if (Array.isArray(v)) return `[${v.map(pyReprInner).join(", ")}]`;
  if (typeof v === "object") {
    return `{${Object.entries(v).map(([k, val]) => `${pyReprInner(k)}: ${pyReprInner(val)}`).join(", ")}}`;
  }
  return String(v);
}
function pyReprInner(v: any): string {
  if (typeof v === "string") return `'${v.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
  return pyReprValue(v);
}

// 镜像 api/deps.py user_has_permission + core/rbac.py 静态角色权限表
const ROLE_PERMS: Record<string, string[]> = {
  org_admin: [
    "org.manage", "member.manage", "project.create", "project.manage", "material.upload",
    "material.delete", "audit.run", "fact.revise", "finding.review", "comment.write",
    "review.decide", "report.generate", "case.manage", "rule.manage", "integration.manage",
    "api.manage", "data.export", "data.manage",
  ],
  project_lead: [
    "project.manage", "material.upload", "material.delete", "audit.run", "fact.revise",
    "finding.review", "comment.write", "review.decide", "report.generate", "case.manage", "data.export",
  ],
  researcher: [
    "material.upload", "audit.run", "fact.revise", "comment.write", "report.generate",
    "case.manage", "data.export",
  ],
  reviewer: ["finding.review", "comment.write", "review.decide", "report.generate"],
  viewer: [],
  member: ["project.create"],
};
async function userHasPermission(
  db: Db, user: UserRow, perm: string,
  orgId: string | null = null, projectId: string | null = null,
): Promise<boolean> {
  if (user.is_platform_admin) return true;
  if (projectId && !orgId) {
    const proj = one(await db.from("projects").select("org_id").eq("id", projectId).limit(1));
    orgId = proj?.org_id ?? null;
  }
  if (orgId) {
    const orole = await orgRole(db, orgId, user.id);
    if (orole === "org_admin") return true;
    if (orole && (ROLE_PERMS[orole] ?? []).includes(perm)) return true;
  }
  if (projectId) {
    const prole = await projectRole(db, projectId, user.id);
    if (prole && (ROLE_PERMS[prole] ?? []).includes(perm)) return true;
  }
  return false;
}

// 镜像 services/trail_service.record_trail
async function recordTrail(db: Db, entry: {
  action: string; actor_user_id?: string | null; org_id?: string | null; project_id?: string | null;
  target_type?: string; target_id?: string; before?: any; after?: any; summary?: string; request_id?: string;
}): Promise<void> {
  const dump = (v: any): string | null => {
    if (v === null || v === undefined) return null;
    if (typeof v === "string") return v;
    return dumps(v);
  };
  rows(await db.from("audit_trail").insert({
    id: newId("trail"),
    org_id: entry.org_id ?? null,
    project_id: entry.project_id ?? null,
    actor_user_id: entry.actor_user_id ?? null,
    action: entry.action,
    target_type: entry.target_type ?? "",
    target_id: entry.target_id ?? "",
    before_json: dump(entry.before),
    after_json: dump(entry.after),
    summary: entry.summary ?? "",
    request_id: entry.request_id ?? "",
    created_at: nowIso(),
  }).select("*"));
}

// ============================ fact_schema（字段目录与归一化） ============================

const SCHEMA_VERSION = "stage6-b1";
const CATEGORIES: Record<string, string> = {
  training_parameter: "训练参数",
  environment: "运行环境",
  dataset: "数据集",
  metric: "评价指标",
};
const VALUE_TYPES: Record<string, string> = {
  float: "连续数值", int: "整数", ratio: "比例（0~1）",
  version: "版本号", enum: "受控取值", string: "文本",
};
type FieldSpec = {
  label: string; label_en: string; category: string; unit: string;
  aliases: string[]; value_type: string;
};
const f = (label: string, label_en: string, category: string, unit: string,
  aliases: string[], value_type: string): FieldSpec =>
  ({ label, label_en, category, unit, aliases, value_type });

const STANDARD_FIELDS: Record<string, FieldSpec> = {
  // ---- 训练参数 ----
  learning_rate: f("学习率", "Learning Rate", "training_parameter", "", [
    "lr", "learning rate", "learningrate", "init_lr", "initial_learning_rate",
    "base_lr", "peak_lr", "学习率", "初始学习率"], "float"),
  batch_size: f("批大小", "Batch Size", "training_parameter", "samples", [
    "batch size", "batchsize", "batch", "bs", "train_batch_size", "per_device_batch_size",
    "批大小", "批量大小", "批次大小"], "int"),
  epochs: f("训练轮数", "Epochs", "training_parameter", "epoch", [
    "epoch", "num_epochs", "num_train_epochs", "training_epochs", "max_epochs",
    "训练轮数", "轮数", "迭代轮数"], "int"),
  optimizer: f("优化器", "Optimizer", "training_parameter", "", [
    "optim", "optimizer_name", "optimiser", "优化器", "优化算法"], "enum"),
  weight_decay: f("权重衰减", "Weight Decay", "training_parameter", "", [
    "wd", "weight decay", "l2", "l2_regularization", "l2_penalty",
    "权重衰减", "正则化系数"], "float"),
  random_seed: f("随机种子", "Random Seed", "training_parameter", "", [
    "seed", "random seed", "rng_seed", "global_seed", "随机种子", "种子"], "int"),
  momentum: f("动量", "Momentum", "training_parameter", "", [
    "sgd_momentum", "momentum_coefficient", "动量"], "float"),
  lr_scheduler: f("学习率调度", "LR Scheduler", "training_parameter", "", [
    "scheduler", "lr_schedule", "learning_rate_scheduler", "lr_decay",
    "学习率调度", "调度策略", "学习率衰减"], "string"),
  loss_function: f("损失函数", "Loss Function", "training_parameter", "", [
    "loss", "loss_fn", "criterion", "objective", "损失函数", "目标函数"], "string"),
  dropout: f("Dropout 比例", "Dropout", "training_parameter", "ratio", [
    "drop_rate", "dropout_rate", "drop_path_rate", "丢弃率", "随机失活"], "ratio"),
  mixed_precision: f("混合精度", "Mixed Precision", "training_parameter", "", [
    "amp", "fp16", "bf16", "mixed precision", "precision_mode", "混合精度"], "enum"),
  num_workers: f("数据加载线程数", "Data Loader Workers", "training_parameter", "threads", [
    "workers", "dataloader_workers", "num_worker", "加载线程数", "数据线程数"], "int"),
  gradient_accumulation_steps: f("梯度累积步数", "Gradient Accumulation Steps", "training_parameter", "steps", [
    "grad_accum", "accumulation_steps", "gradient_accumulation", "梯度累积", "梯度累积步数"], "int"),
  warmup_epochs: f("预热轮数", "Warmup Epochs", "training_parameter", "epoch", [
    "warmup", "warmup_steps", "warmup_ratio", "预热轮数", "预热步数"], "float"),
  // ---- 运行环境 ----
  python_version: f("Python 版本", "Python Version", "environment", "", [
    "python", "python_ver", "py_version", "python版本"], "version"),
  pytorch_version: f("PyTorch 版本", "PyTorch Version", "environment", "", [
    "torch", "torch_version", "pytorch", "pytorch_ver", "torch版本"], "version"),
  cuda_version: f("CUDA 版本", "CUDA Version", "environment", "", [
    "cuda", "cuda_ver", "cuda_toolkit", "cuda版本"], "version"),
  gpu: f("GPU 型号", "GPU", "environment", "", [
    "gpu_model", "gpu_name", "graphics_card", "accelerator", "hardware",
    "显卡", "显卡型号", "gpu型号", "加速卡"], "string"),
  operating_system: f("操作系统", "Operating System", "environment", "", [
    "os", "os_version", "system", "platform", "操作系统", "系统版本"], "string"),
  cpu: f("CPU 型号", "CPU", "environment", "", [
    "processor", "cpu_model", "cpu_name", "处理器", "cpu型号"], "string"),
  memory: f("内存容量", "Memory", "environment", "GB", [
    "ram", "system_memory", "gpu_memory", "vram", "内存", "显存"], "float"),
  driver_version: f("驱动版本", "Driver Version", "environment", "", [
    "nvidia_driver", "driver", "gpu_driver", "显卡驱动", "驱动版本"], "version"),
  framework: f("深度学习框架", "Framework", "environment", "", [
    "dl_framework", "library", "toolkit", "框架", "深度学习框架"], "string"),
  code_commit: f("代码提交号", "Code Commit", "environment", "", [
    "commit", "git_commit", "commit_sha", "revision", "代码版本", "提交哈希"], "string"),
  docker_image: f("容器镜像", "Docker Image", "environment", "", [
    "container_image", "docker", "container", "镜像", "容器镜像"], "string"),
  // ---- 数据集 ----
  dataset_name: f("数据集名称", "Dataset Name", "dataset", "", [
    "dataset", "data", "data_name", "corpus", "数据集", "数据集名", "数据集名称"], "string"),
  dataset_version: f("数据集版本", "Dataset Version", "dataset", "", [
    "data_version", "dataset_ver", "dataset_release", "数据集版本"], "version"),
  train_split: f("训练集划分", "Train Split", "dataset", "", [
    "train", "training_split", "train_size", "train_set", "训练集", "训练集划分"], "string"),
  validation_split: f("验证集划分", "Validation Split", "dataset", "", [
    "val", "valid", "val_split", "validation", "dev", "dev_split", "validation_size",
    "验证集", "验证集划分", "开发集"], "string"),
  test_split: f("测试集划分", "Test Split", "dataset", "", [
    "test", "test_split", "test_size", "testing_split", "eval_split",
    "测试集", "测试集划分"], "string"),
  preprocessing_method: f("预处理方法", "Preprocessing Method", "dataset", "", [
    "preprocessing", "preprocess", "data_augmentation", "augmentation", "normalization",
    "预处理", "预处理方法", "数据增强", "归一化方法"], "string"),
  num_classes: f("类别数", "Number of Classes", "dataset", "classes", [
    "classes", "n_classes", "num_class", "class_count", "类别数", "分类数"], "int"),
  image_size: f("输入图像尺寸", "Image Size", "dataset", "px", [
    "input_size", "img_size", "resolution", "image_resolution", "crop_size",
    "输入尺寸", "图像尺寸", "分辨率"], "string"),
  input_shape: f("输入张量形状", "Input Shape", "dataset", "", [
    "input_dim", "input_dims", "shape", "tensor_shape", "输入形状", "输入维度"], "string"),
  dataset_size: f("数据集规模", "Dataset Size", "dataset", "samples", [
    "num_samples", "total_samples", "sample_count", "样本数", "数据量", "数据集规模"], "int"),
  // ---- 评价指标 ----
  accuracy: f("准确率", "Accuracy", "metric", "ratio", [
    "acc", "top1", "top-1", "top1_accuracy", "acc@1", "accuracy_rate", "准确率"], "ratio"),
  precision: f("精确率", "Precision", "metric", "ratio", [
    "precision_score", "positive_predictive_value", "精确率", "查准率"], "ratio"),
  recall: f("召回率", "Recall", "metric", "ratio", [
    "recall_score", "sensitivity", "tpr", "true_positive_rate", "召回率", "查全率"], "ratio"),
  f1: f("F1 分数", "F1 Score", "metric", "ratio", [
    "f1_score", "f1-score", "fmeasure", "f1值", "f1 值"], "ratio"),
  auc: f("AUC", "AUC", "metric", "ratio", [
    "roc_auc", "auroc", "auc_roc", "area_under_roc", "曲线下面积"], "ratio"),
  rmse: f("均方根误差", "RMSE", "metric", "", [
    "root_mean_squared_error", "rms_error", "rmsd", "均方根误差"], "float"),
  mae: f("平均绝对误差", "MAE", "metric", "", [
    "mean_absolute_error", "mad", "平均绝对误差"], "float"),
  top5_accuracy: f("Top-5 准确率", "Top-5 Accuracy", "metric", "ratio", [
    "top5", "top-5", "acc@5", "top5_acc", "top_5_accuracy"], "ratio"),
  perplexity: f("困惑度", "Perplexity", "metric", "", ["ppl", "困惑度"], "float"),
  bleu: f("BLEU 分数", "BLEU", "metric", "", ["bleu_score", "bleu-4", "bleu4"], "float"),
  psnr: f("峰值信噪比", "PSNR", "metric", "dB", ["peak_signal_noise_ratio", "峰值信噪比"], "float"),
  ssim: f("结构相似性", "SSIM", "metric", "ratio", ["structural_similarity", "结构相似性"], "ratio"),
  training_time: f("训练耗时", "Training Time", "metric", "hours", [
    "train_time", "training_duration", "wall_time", "训练时间", "训练耗时"], "float"),
  parameter_count: f("参数量", "Parameter Count", "metric", "params", [
    "params", "num_parameters", "model_size", "n_params", "参数量", "模型参数数"], "int"),
  inference_latency: f("推理延迟", "Inference Latency", "metric", "ms", [
    "latency", "inference_time", "infer_time", "推理延迟", "推理耗时"], "float"),
};

// 第二层程序化比对别名口径（services/__init__.py FIELD_ALIASES / NUMERIC_FIELDS）
const FIELD_ALIASES: Record<string, [string, string]> = {
  batch_size: ["batch_size", "Batch Size"], batchsize: ["batch_size", "Batch Size"],
  "batch size": ["batch_size", "Batch Size"], "批大小": ["batch_size", "Batch Size"],
  learning_rate: ["learning_rate", "Learning Rate"], learningrate: ["learning_rate", "Learning Rate"],
  "learning rate": ["learning_rate", "Learning Rate"], lr: ["learning_rate", "Learning Rate"],
  "学习率": ["learning_rate", "Learning Rate"],
  epochs: ["epochs", "Epochs"], epoch: ["epochs", "Epochs"], num_epochs: ["epochs", "Epochs"],
  training_epochs: ["epochs", "Epochs"], "训练轮数": ["epochs", "Epochs"],
  optimizer: ["optimizer", "Optimizer"], optim: ["optimizer", "Optimizer"], "优化器": ["optimizer", "Optimizer"],
};
const NUMERIC_FIELDS = new Set(["batch_size", "learning_rate", "epochs"]);
const NUMERIC_FIELD_KEYS = new Set<string>([
  ...Object.entries(STANDARD_FIELDS)
    .filter(([, v]) => ["float", "int", "ratio"].includes(v.value_type)).map(([k]) => k),
  ...NUMERIC_FIELDS,
]);

const OPTIMIZERS: Record<string, string> = {
  sgd: "SGD", adam: "Adam", adamw: "AdamW", adamax: "Adamax",
  adagrad: "Adagrad", adadelta: "Adadelta", rmsprop: "RMSprop",
  rms_prop: "RMSprop", nadam: "Nadam", radam: "RAdam",
  lbfgs: "L-BFGS", "l-bfgs": "L-BFGS", lion: "Lion", lamb: "LAMB",
  adafactor: "Adafactor", shampoo: "Shampoo", sparseadam: "SparseAdam",
};
const PRECISION: Record<string, string> = {
  fp16: "fp16", float16: "fp16", half: "fp16", amp: "fp16", true: "fp16",
  yes: "fp16", on: "fp16", "1": "fp16",
  bf16: "bf16", bfloat16: "bf16",
  fp32: "fp32", float32: "fp32", full: "fp32", no: "fp32", none: "fp32",
  false: "fp32", off: "fp32", "0": "fp32",
  fp64: "fp64", float64: "fp64", double: "fp64",
};
const OS_MAP: Record<string, string> = {
  ubuntu: "Ubuntu", debian: "Debian", centos: "CentOS", rhel: "RHEL",
  fedora: "Fedora", arch: "Arch Linux", windows: "Windows", win: "Windows",
  macos: "macOS", "mac os": "macOS", osx: "macOS", darwin: "macOS",
  linux: "Linux", unix: "Unix",
};
const DATASETS: Record<string, string> = {
  cifar10: "CIFAR-10", "cifar-10": "CIFAR-10", "cifar 10": "CIFAR-10",
  cifar100: "CIFAR-100", "cifar-100": "CIFAR-100", "cifar 100": "CIFAR-100",
  imagenet: "ImageNet", imagenet1k: "ImageNet", "imagenet-1k": "ImageNet",
  ilsvrc2012: "ImageNet", "ilsvrc-2012": "ImageNet",
  mnist: "MNIST", fashionmnist: "Fashion-MNIST", "fashion-mnist": "Fashion-MNIST",
  kmnist: "KMNIST", emnist: "EMNIST", svhn: "SVHN", stl10: "STL-10", "stl-10": "STL-10",
  coco: "COCO", mscoco: "COCO", "ms coco": "COCO", coco2017: "COCO",
  voc: "PASCAL VOC", pascalvoc: "PASCAL VOC", "pascal voc": "PASCAL VOC",
  cityscapes: "Cityscapes", ade20k: "ADE20K", kitti: "KITTI",
  nuscenes: "nuScenes", modelnet40: "ModelNet40", modelnet: "ModelNet40",
  shapenet: "ShapeNet", scannet: "ScanNet", s3dis: "S3DIS",
  kinetics: "Kinetics-400", kinetics400: "Kinetics-400", k400: "Kinetics-400",
  ucf101: "UCF101", hmdb51: "HMDB51", audioset: "AudioSet",
  esc50: "ESC-50", urbansound8k: "UrbanSound8K", librispeech: "LibriSpeech",
  commonvoice: "Common Voice", "common voice": "Common Voice",
  squad: "SQuAD", "squad1.1": "SQuAD", squad2: "SQuAD 2.0", "squad2.0": "SQuAD 2.0",
  glue: "GLUE", superglue: "SuperGLUE", sst2: "SST-2", "sst-2": "SST-2",
  mrpc: "MRPC", qnli: "QNLI", cola: "CoLA", rte: "RTE", boolq: "BoolQ",
  multirc: "MultiRC", wikitext103: "WikiText-103", "wikitext-103": "WikiText-103",
  wikitext2: "WikiText-2", "wikitext-2": "WikiText-2",
  imdb: "IMDB", agnews: "AG News", "ag news": "AG News", dbpedia: "DBpedia",
  yelp: "Yelp", "cnn/dailymail": "CNN/DailyMail", cnndailymail: "CNN/DailyMail",
  xsum: "XSum", wmt14: "WMT14", "wmt-14": "WMT14",
  gsm8k: "GSM8K", humaneval: "HumanEval", mbpp: "MBPP", mmlu: "MMLU",
  hellaswag: "HellaSwag", winogrande: "WinoGrande", truthfulqa: "TruthfulQA",
  "arc-challenge": "ARC-Challenge", bigbench: "BIG-bench",
  cora: "Cora", citeseer: "CiteSeer", pubmed: "PubMed", qm9: "QM9",
  "ogbg-molhiv": "OGBG-MOLHIV", mimiciii: "MIMIC-III", "mimic-iii": "MIMIC-III",
  mimic: "MIMIC-III", chestxray14: "ChestX-ray14", "chest x-ray14": "ChestX-ray14",
  isic: "ISIC", tcga: "TCGA", celeba: "CelebA", ffhq: "FFHQ",
};
const TO_HOURS: Record<string, number> = {
  h: 1, hr: 1, hrs: 1, hour: 1, hours: 1,
  min: 1 / 60, mins: 1 / 60, minute: 1 / 60, minutes: 1 / 60,
  s: 1 / 3600, sec: 1 / 3600, secs: 1 / 3600, second: 1 / 3600, seconds: 1 / 3600,
  ms: 1 / 3600000, d: 24, day: 24, days: 24,
};
const TO_MS: Record<string, number> = {
  ms: 1, millisecond: 1, milliseconds: 1, s: 1000, sec: 1000, second: 1000,
  seconds: 1000, us: 0.001, "µs": 0.001, "μs": 0.001, min: 60000, minute: 60000,
};
const TO_GB: Record<string, number> = {
  gb: 1, g: 1, gib: 1, tb: 1024, t: 1024,
  mb: 1 / 1024, m: 1 / 1024, mib: 1 / 1024, kb: 1 / 1024 ** 2,
};
const COUNT_SUFFIX: Record<string, number> = {
  k: 1e3, thousand: 1e3, m: 1e6, million: 1e6, b: 1e9, billion: 1e9,
};
const SUPERSCRIPT: Record<string, string> = {
  "⁰": "0", "¹": "1", "²": "2", "³": "3", "⁴": "4", "⁵": "5", "⁶": "6",
  "⁷": "7", "⁸": "8", "⁹": "9", "⁻": "-", "⁺": "+",
};
const translateSup = (s: string): string => s.replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹⁻⁺]/g, ch => SUPERSCRIPT[ch]);
const NUM_RE = /^([<>~≈=≤≥]?\s*[-+]?(?:\d[\d,]*(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?)\s*(.*)$/;
const VERSION_RE = /\d+(?:\.\d+)*(?:[-+][A-Za-z0-9._]+)?/;
const SCIENTIFIC_RE = /(\d+(?:\.\d+)?)\s*[x×*]\s*10\s*\^?\s*([-+]?\d+)/g;
const THOUSANDS_RE = /^[-+]?\d{1,3}(,\d{3})+(\.\d+)?$/;

function slug(raw: string): string {
  let s = (raw || "").trim().toLowerCase();
  s = translateSup(s);
  s = s.replace(/[\s\-–—/.]+/g, "_");
  s = s.replace(/[：:=（）()\[\]{}'"`]+/g, "");
  return s.replace(/_+/g, "_").replace(/^_+|_+$/g, "");
}
const ALIAS_INDEX: Record<string, string> = (() => {
  const index: Record<string, string> = {};
  const setDefault = (k: string, v: string) => { if (!(k in index)) index[k] = v; };
  for (const [key, spec] of Object.entries(STANDARD_FIELDS)) {
    index[slug(key)] = key;
    index[slug(spec.label)] = key;
    index[slug(spec.label_en)] = key;
    for (const alias of spec.aliases) setDefault(slug(alias), key);
  }
  for (const [alias, [key]] of Object.entries(FIELD_ALIASES)) {
    if (key in STANDARD_FIELDS) setDefault(slug(alias), key);
  }
  delete index[""];
  return index;
})();

function normalizeField(rawField: string): string {
  const text = (rawField || "").trim();
  if (!text) return "";
  const key = slug(text);
  if (key in ALIAS_INDEX) return ALIAS_INDEX[key];
  const withoutParen = text.replace(/[（(][^）)]*[）)]/g, "").trim();
  const key2 = slug(withoutParen);
  if (key2 && key2 in ALIAS_INDEX) return ALIAS_INDEX[key2];
  const key3 = (key2 || key).replace(/[_\s]*(%|percent|ratio|hours?|hrs?|ms|samples?|epochs?)$/, "");
  if (key3 && key3 in ALIAS_INDEX) return ALIAS_INDEX[key3];
  return key || key2 || slug(text);
}
const fieldSpec = (key: string): FieldSpec | null => STANDARD_FIELDS[key] ?? null;
const fieldLabel = (key: string): string => STANDARD_FIELDS[key]?.label ?? key;

const cleanText = (v: string): string => (v || "").trim().replace(/\s+/g, " ");

// 镜像 Python f"{x:.10g}"（10 位有效数字，去尾零）
function g10(x: number): string {
  if (x === 0) return "0";
  const e = Math.floor(Math.log10(Math.abs(x)));
  if (e < -4 || e >= 10) {
    let s = x.toExponential(9);
    s = s.replace(/(\.\d*?)0+e/, "$1e").replace(/\.e/, "e");
    s = s.replace(/e([+-])(\d)$/, (_m, sign: string, d: string) => `e${sign}0${d}`);
    return s;
  }
  let s = x.toFixed(Math.max(0, 9 - e));
  if (s.includes(".")) s = s.replace(/0+$/, "").replace(/\.$/, "");
  return s;
}
function fmtNumber(x: number, asInt = false): string {
  if (!Number.isFinite(x)) return Number.isNaN(x) ? "nan" : (x > 0 ? "inf" : "-inf");
  if (asInt && Number.isInteger(x)) return String(Math.trunc(x));
  if (x === 0) return "0";
  if (Math.abs(x) < 1e-4) {
    const s = x.toFixed(12).replace(/0+$/, "").replace(/\.$/, "");
    return s || "0";
  }
  if (Math.abs(x) >= 1e15) return g10(x);
  let s = g10(x);
  if (s.includes("e") || s.includes("E")) {
    s = x.toFixed(12).replace(/0+$/, "").replace(/\.$/, "");
  }
  return s;
}
function parseNumber(raw: string): [number | null, string] {
  let s = translateSup(cleanText(raw));
  s = s.replace(SCIENTIFIC_RE, (_m, a: string, b: string) => `${a}e${b}`);
  if (THOUSANDS_RE.test(s)) s = s.replace(/,/g, "");
  const m = s.match(NUM_RE);
  if (!m) return [null, s];
  const numPart = m[1].replace(/^[<>~≈=≤≥]\s*/, "").trim();
  // Python float() 拒绝残留千分位逗号；parseFloat 会静默截断，需显式拒绝
  if (numPart.includes(",") || !/^[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?$/.test(numPart)) {
    return [null, s];
  }
  const n = Number(numPart);
  if (!Number.isFinite(n)) return [null, s];
  return [n, cleanText(m[2])];
}
const normalizeVersion = (raw: string): string => {
  const s = cleanText(raw);
  const m = s.match(VERSION_RE);
  return m ? m[0] : s;
};
const GPU_FIX: Record<string, string> = {
  nvidia: "NVIDIA", geforce: "GeForce", rtx: "RTX", gtx: "GTX",
  tesla: "Tesla", quadro: "Quadro", a100: "A100", a6000: "A6000",
  v100: "V100", h100: "H100", h800: "H800", a800: "A800",
  t4: "T4", p100: "P100", p40: "P40", k80: "K80",
  cpu: "CPU", gpu: "GPU", ti: "Ti", super: "SUPER",
  amd: "AMD", radeon: "Radeon", instinct: "Instinct", mi250: "MI250",
  apple: "Apple", m1: "M1", m2: "M2", m3: "M3", mps: "MPS",
};
const normalizeGpu = (raw: string): string => {
  const s = cleanText(raw);
  return s.split(" ").map(tok => {
    const low = tok.toLowerCase().replace(/^[,;]+|[,;]+$/g, "");
    return GPU_FIX[low] ?? tok;
  }).join(" ");
};
const normalizeOs = (raw: string): string => {
  const s = cleanText(raw);
  const low = s.toLowerCase();
  for (const [prefix, canonical] of Object.entries(OS_MAP)) {
    if (low === prefix || low.startsWith(prefix + " ")) {
      const rest = s.slice(prefix.length).trim();
      return `${canonical} ${rest}`.trim();
    }
  }
  return s;
};
const normalizeDataset = (raw: string): string => {
  const s = cleanText(raw);
  const key = s.toLowerCase().replace(/_/g, "-").trim();
  if (key in DATASETS) return DATASETS[key];
  const compact = key.replace(/-/g, "").replace(/ /g, "");
  for (const [alias, canonical] of Object.entries(DATASETS)) {
    if (alias.replace(/-/g, "").replace(/ /g, "") === compact) return canonical;
  }
  return s;
};
const normalizeRatio = (x: number, hadPercent: boolean): number => {
  if (hadPercent) return x / 100;
  if (x > 1 && x <= 100) return x / 100;
  return x;
};

function normalizeValue(fieldKey: string, rawValue: any): [string, string] {
  if (rawValue === null || rawValue === undefined) return ["", ""];
  if (typeof rawValue === "boolean") rawValue = rawValue ? "true" : "false";
  const text = cleanText(String(rawValue));
  const spec = STANDARD_FIELDS[fieldKey] ?? null;
  if (!text) return ["", spec ? spec.unit : ""];
  if (spec === null) return [text, ""];
  const unit = spec.unit;
  const vtype = spec.value_type;

  if (vtype === "version") return [normalizeVersion(text), unit];
  if (vtype === "enum") {
    const low = text.toLowerCase();
    if (fieldKey === "optimizer") {
      return [OPTIMIZERS[low.replace(/-/g, "").replace(/_/g, "")] ?? cleanText(text), unit];
    }
    if (fieldKey === "mixed_precision") return [PRECISION[low] ?? low, unit];
    return [text, unit];
  }
  if (vtype === "string") {
    if (fieldKey === "dataset_name") return [normalizeDataset(text), unit];
    if (fieldKey === "gpu") return [normalizeGpu(text), unit];
    if (fieldKey === "operating_system") return [normalizeOs(text), unit];
    if (["train_split", "validation_split", "test_split"].includes(fieldKey)) {
      const [n, rest] = parseNumber(text);
      if (n !== null) {
        if (rest === "%" || (!rest && n > 0 && n <= 100 && text.includes("."))) {
          return [fmtNumber(n / 100), "ratio"];
        }
        if (!rest) return [fmtNumber(n, true), "samples"];
      }
      return [text, unit];
    }
    return [text, unit];
  }

  // 数值型（float / int / ratio）
  const [parsed, rest] = parseNumber(text);
  if (parsed === null) return [text, unit];
  let n = parsed;
  const hadPercent = rest.startsWith("%") || ["percent", "pct"].includes(rest.toLowerCase());
  if (["parameter_count", "dataset_size"].includes(fieldKey) && rest.toLowerCase() in COUNT_SUFFIX) {
    return [fmtNumber(n * COUNT_SUFFIX[rest.toLowerCase()], true), unit];
  }
  if (rest && !hadPercent) {
    const low = rest.toLowerCase().replace(/\.$/, "");
    if (unit === "hours" && low in TO_HOURS) n *= TO_HOURS[low];
    else if (unit === "ms" && low in TO_MS) n *= TO_MS[low];
    else if (unit === "GB" && low in TO_GB) n *= TO_GB[low];
    else if (unit === "ratio" && ["ratio", "fraction"].includes(low)) { /* 同义单位 */ }
    else if (["samples", "sample", "images", "epochs", "epoch", "steps", "step",
      "classes", "threads", "params", "px", "db"].includes(low)) { /* 同义单位 */ }
    else return [text, unit];
  }
  if (vtype === "ratio" || unit === "ratio") return [fmtNumber(normalizeRatio(n, hadPercent)), "ratio"];
  return [fmtNumber(n, vtype === "int"), unit];
}

function factSchemaView(): Record<string, any> {
  const fields = Object.entries(STANDARD_FIELDS).map(([key, spec]) => ({
    field_key: key,
    label: spec.label,
    label_en: spec.label_en,
    category: spec.category,
    category_label: CATEGORIES[spec.category],
    unit: spec.unit,
    value_type: spec.value_type,
    value_type_label: VALUE_TYPES[spec.value_type],
    aliases: [...spec.aliases],
    is_numeric: NUMERIC_FIELD_KEYS.has(key),
  }));
  const categories = Object.entries(CATEGORIES).map(([k, v]) => ({
    key: k, label: v, field_count: fields.filter(fl => fl.category === k).length,
  }));
  return {
    version: SCHEMA_VERSION,
    total: fields.length,
    categories,
    fields,
    normalization_rules: [
      "字段名大小写/空格/连字符不敏感，别名与中文名统一映射到标准 field_key。",
      "原始 raw_field/raw_value 永久保留，normalized_value 仅用于比对与检索。",
      "数值支持科学计数法（1e-3）、千分位（1,024）与 ×10^n 写法。",
      "比例型指标（accuracy/precision/recall/f1/auc/dropout/ssim）统一折算到 0~1，unit=ratio。",
      "时间/内存按规范单位换算（training_time→hours，inference_latency→ms，memory→GB）。",
      "版本字段抽取版本号主体；dataset_name/gpu/operating_system 归一到规范写法。",
      "未收录字段降级为 snake_case key 并保留原文，is_standard=false，不丢弃信息。",
    ],
  };
}

// ============================ benchmark_service（案例/事实/验证/质量） ============================

const RULE_VERSION = "stage6-b1";
const QUALITY_LADDER = [
  { key: "unverified", label: "未验证", requirement: "无任何验证记录，或现有验证均未通过（fail/partial）。" },
  { key: "partially_verified", label: "部分验证", requirement: "存在人工复核通过（review pass），或执行通过但未声明运行环境。" },
  { key: "execution_verified", label: "执行验证", requirement: "存在执行复现通过（execution pass）且 conditions 声明了运行环境。" },
  { key: "independently_reviewed", label: "独立复核", requirement: "在 execution_verified 基础上，另有独立人工复核通过（复核人 ≠ 执行人且 ≠ 案例创建者）。" },
];
const QUALITY_RANK: Record<string, number> = Object.fromEntries(QUALITY_LADDER.map((it, i) => [it.key, i]));
const QUALITY_LABELS: Record<string, string> = Object.fromEntries(QUALITY_LADDER.map(it => [it.key, it.label]));
const VERIFICATION_TYPES = ["execution", "review"];
const VERIFICATION_RESULTS = ["fail", "partial", "pass"];
const SOURCE_TYPES = ["code", "config", "dataset_card", "execution", "log", "manual", "other", "paper", "review"];
const ENVIRONMENT_KEYS = new Set([
  "environment", "env", "hardware", "gpu", "gpu_model", "gpu_count", "num_gpus",
  "cpu", "memory", "ram", "python_version", "pytorch_version", "torch_version",
  "cuda_version", "cudnn_version", "operating_system", "os", "driver_version",
  "docker_image", "container_image", "framework", "library_versions", "dependencies",
  "code_commit", "commit", "commit_sha", "mixed_precision", "precision",
]);
const CASE_SORTS = ["recent", "updated", "quality", "title"];
const SERVER_OWNED_CASE_FIELDS = ["quality_level", "quality_evidence_json", "quality_evidence", "created_by", "id"];

async function userOrgIds(db: Db, user: UserRow): Promise<string[]> {
  const list = rows(await db.from("org_members").select("org_id").eq("user_id", user.id).limit(1000));
  return [...new Set(list.map(r => r.org_id))];
}

function traceabilityView(c: any): Record<string, any> {
  const hasSource = !!((c.doi || "").trim() || (c.source_url || "").trim());
  const hasCode = !!((c.code_repo_url || "").trim());
  const hasLicense = !!((c.license || "").trim());
  const hasCommit = !!((c.code_commit || "").trim());
  const warnings: string[] = [];
  if (!hasSource) warnings.push("缺少论文来源（doi 或 source_url），无法追溯原始文献。");
  if (!hasLicense) warnings.push("缺少 license 声明，引用该案例前需确认原文与代码的许可条款。");
  if (hasCode && !hasCommit) warnings.push("缺少 code_commit，代码版本不可复现定位。");
  return {
    has_source: hasSource, has_code: hasCode, has_code_commit: hasCommit, has_license: hasLicense,
    complete: hasSource && hasLicense && (!hasCode || hasCommit),
    redistribution: "metadata_only",
    warnings,
  };
}

function caseView(c: any, opts: {
  fact_count?: number | null; verification_count?: number | null;
  verifications?: any[] | null; created_by_name?: string | null;
} = {}): Record<string, any> {
  const level = c.quality_level || "unverified";
  const data: Record<string, any> = {
    id: c.id,
    title: c.title,
    doi: c.doi || "",
    source_url: c.source_url || "",
    domain: c.domain || "",
    research_task: c.research_task || "",
    model_architecture: c.model_architecture || "",
    dataset_name: c.dataset_name || "",
    code_repo_url: c.code_repo_url || "",
    code_commit: c.code_commit || "",
    license: c.license || "",
    quality_level: level,
    quality_label: QUALITY_LABELS[level] ?? "未验证",
    quality_evidence: loads(c.quality_evidence_json) || {},
    version: c.version,
    org_id: c.org_id,
    is_public: !!c.is_public,
    created_by: c.created_by,
    summary: c.summary || "",
    traceability: traceabilityView(c),
    created_at: c.created_at || "",
    updated_at: c.updated_at || "",
  };
  if (opts.fact_count !== null && opts.fact_count !== undefined) data.fact_count = opts.fact_count;
  if (opts.verification_count !== null && opts.verification_count !== undefined) data.verification_count = opts.verification_count;
  if (opts.verifications !== null && opts.verifications !== undefined) data.verifications = opts.verifications;
  if (opts.created_by_name !== null && opts.created_by_name !== undefined) data.created_by_name = opts.created_by_name;
  return data;
}

function caseFactView(fact: any): Record<string, any> {
  const spec = fieldSpec(fact.field_key);
  return {
    id: fact.id,
    case_id: fact.case_id,
    field_key: fact.field_key,
    label: spec ? spec.label : fact.field_key,
    label_en: spec ? spec.label_en : fact.field_key,
    category: spec ? spec.category : "other",
    category_label: spec ? (CATEGORIES[spec.category] ?? "其他") : "其他",
    is_standard: spec !== null,
    raw_field: fact.raw_field || "",
    raw_value: fact.raw_value || "",
    normalized_value: fact.normalized_value || "",
    unit: fact.unit || "",
    source_type: fact.source_type || "",
    source_ref: fact.source_ref || "",
    context: fact.context || "",
    applicable_experiment: fact.applicable_experiment || "",
    confidence: num(fact.confidence),
    created_at: fact.created_at || "",
  };
}

function verificationView(row: any, verifierName = ""): Record<string, any> {
  const parsed = loads(row.conditions_json);
  return {
    id: row.id,
    case_id: row.case_id,
    verification_type: row.verification_type,
    result: row.result,
    verifier_user_id: row.verifier_user_id,
    verifier_name: verifierName,
    conditions: parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {},
    conditions_json: row.conditions_json || "",
    notes: row.notes || "",
    created_at: row.created_at || "",
  };
}

function qualityStandardView(): Record<string, any> {
  return {
    rule_version: RULE_VERSION,
    levels: QUALITY_LADDER,
    verification_types: [...VERIFICATION_TYPES].sort(),
    results: [...VERIFICATION_RESULTS].sort(),
    environment_keys: [...ENVIRONMENT_KEYS].sort(),
    principles: [
      "等级由 evaluate_quality 依据验证记录确定性计算，AI/客户端不可直接设置。",
      "recompute 默认只升不降；降级须显式 confirm_downgrade=true 人工确认。",
      "独立复核要求复核人不同于执行人且不同于案例创建者。",
      "每次等级变更写入 audit_trail，并保存 quality_evidence_json 证据清单。",
    ],
  };
}

function hasEnvironmentConditions(conditions: any): boolean {
  if (!conditions || typeof conditions !== "object" || Array.isArray(conditions)) return false;
  if (!Object.keys(conditions).length) return false;
  for (const [key, value] of Object.entries(conditions)) {
    if (!ENVIRONMENT_KEYS.has(String(key).trim().toLowerCase())) continue;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      if (Object.values(value).some(v => v !== null && v !== undefined && String(v).trim())) return true;
    } else if (Array.isArray(value)) {
      if (value.some(v => v !== null && v !== undefined && String(v).trim())) return true;
    } else if (value !== null && value !== undefined && String(value).trim()) {
      return true;
    }
  }
  return false;
}
function extractEnvironment(conditions: any): Record<string, any> {
  if (!conditions || typeof conditions !== "object" || Array.isArray(conditions)) return {};
  const out: Record<string, any> = {};
  for (const [key, value] of Object.entries(conditions)) {
    const low = String(key).trim().toLowerCase();
    if (["environment", "env"].includes(low) && value && typeof value === "object" && !Array.isArray(value)) {
      for (const [k, v] of Object.entries(value)) out[String(k)] = v;
    } else if (ENVIRONMENT_KEYS.has(low) && value !== null && value !== undefined && value !== ""
      && !(typeof value === "object" && Object.keys(value as object).length === 0)) {
      out[low] = value;
    }
  }
  return out;
}
const basisItem = (row: any, reason: string): Record<string, any> => ({
  verification_id: row.id ?? "",
  verification_type: row.verification_type ?? "",
  result: row.result ?? "",
  verifier_user_id: row.verifier_user_id ?? null,
  created_at: row.created_at ?? "",
  reason,
});

function evaluateQuality(createdBy: string | null, verifications: any[]): [string, Record<string, any>] {
  const sorted = [...verifications].sort((a, b) => cmpStr(String(a.created_at || ""), String(b.created_at || "")));
  const execPass = sorted.filter(v => v.verification_type === "execution" && v.result === "pass");
  const execPassEnv = execPass.filter(v => hasEnvironmentConditions(v.conditions));
  const execPassNoenv = execPass.filter(v => !hasEnvironmentConditions(v.conditions));
  const reviewPass = sorted.filter(v => v.verification_type === "review" && v.result === "pass");
  const fails = sorted.filter(v => v.result === "fail");
  const partials = sorted.filter(v => v.result === "partial");

  const basis: any[] = [];
  const supporting: any[] = [];
  const notes: string[] = [];
  let environment: Record<string, any> = {};
  let independent: any = null;
  let level = "unverified";

  if (execPassEnv.length) {
    const execution = execPassEnv[execPassEnv.length - 1];
    level = "execution_verified";
    environment = extractEnvironment(execution.conditions);
    basis.push(basisItem(execution, "执行复现通过，且 conditions 声明了运行环境"));
    for (const review of reviewPass) {
      const reviewer = review.verifier_user_id;
      if (reviewer && reviewer !== execution.verifier_user_id && reviewer !== createdBy) {
        independent = review;
        break;
      }
      supporting.push(basisItem(review, "人工复核通过，但复核人与执行人/创建者相同，不构成独立复核"));
    }
    if (independent !== null) {
      level = "independently_reviewed";
      basis.push(basisItem(independent, "独立人工复核通过（复核人 ≠ 执行人且 ≠ 案例创建者）"));
    } else {
      notes.push("尚无独立人工复核：升级为 independently_reviewed 需由不同于执行人与案例创建者的用户提交 review pass。");
    }
    for (const extra of execPassEnv.slice(0, -1)) {
      supporting.push(basisItem(extra, "历史执行复现通过记录"));
    }
  } else if (reviewPass.length) {
    level = "partially_verified";
    basis.push(basisItem(reviewPass[reviewPass.length - 1], "人工复核通过（材料与结论审阅）"));
    for (const extra of reviewPass.slice(0, -1)) {
      supporting.push(basisItem(extra, "历史人工复核通过记录"));
    }
    notes.push("缺少声明运行环境的 execution pass，无法升级为 execution_verified。");
  } else if (execPassNoenv.length) {
    level = "partially_verified";
    basis.push(basisItem(execPassNoenv[execPassNoenv.length - 1], "执行复现通过但未声明运行环境条件，按部分验证计"));
    notes.push("执行验证的 conditions 需包含环境键（如 gpu/python_version/pytorch_version/cuda_version/operating_system）才计入 execution_verified。");
  } else if (!sorted.length) {
    notes.push("尚无任何验证记录，案例保持 unverified。");
  } else {
    notes.push("现有验证均为 fail/partial，不足以支撑任何验证等级。");
  }
  if (fails.length) notes.push(`存在 ${fails.length} 条 fail 验证，引用该案例前须阅读失败原因。`);
  if (partials.length) notes.push(`存在 ${partials.length} 条 partial 验证，结论仅部分成立。`);

  const evidence: Record<string, any> = {
    level,
    rule_version: RULE_VERSION,
    computed_at: nowIso(),
    basis,
    supporting,
    environment,
    independent_reviewer_user_id: independent ? independent.verifier_user_id : null,
    counts: {
      total: sorted.length,
      execution_pass: execPass.length,
      execution_pass_with_environment: execPassEnv.length,
      review_pass: reviewPass.length,
      fail: fails.length,
      partial: partials.length,
    },
    notes,
  };
  return [level, evidence];
}

// 可见性 + 结构化筛选（list/search 共用；有界取数后 JS 过滤）
async function visibleCases(db: Db, user: UserRow, filters: Record<string, any>): Promise<any[]> {
  const orgIds = await userOrgIds(db, user);
  const all = rows(await db.from("benchmark_cases").select("*").order("created_at", { ascending: false }).limit(1000));
  let list = all;
  if (!user.is_platform_admin) {
    list = list.filter(c => !!c.is_public || c.created_by === user.id || (c.org_id && orgIds.includes(c.org_id)));
  }
  const domain = taskKey(filters.domain);
  if (domain) list = list.filter(c => c.domain === domain);
  const task = taskKey(filters.research_task);
  if (task) list = list.filter(c => c.research_task === task);
  const dataset = clean(filters.dataset || filters.dataset_name);
  if (dataset) {
    const [canonical] = normalizeValue("dataset_name", dataset);
    list = list.filter(c => {
      const dn = String(c.dataset_name || "").toLowerCase();
      return dn === canonical.toLowerCase() || dn.includes(dataset.toLowerCase());
    });
  }
  const quality = clean(filters.quality_level);
  if (quality) {
    if (!(quality in QUALITY_RANK)) {
      throw new AppError("VALIDATION_ERROR", `quality_level 须为 ${pyList(Object.keys(QUALITY_RANK))}。`);
    }
    list = list.filter(c => c.quality_level === quality);
  }
  const orgId = clean(filters.org_id);
  if (orgId) list = list.filter(c => c.org_id === orgId);
  if (filters.is_public !== null && filters.is_public !== undefined && clean(filters.is_public) !== "") {
    const want = asBool(filters.is_public);
    list = list.filter(c => !!c.is_public === want);
  }
  const q = clean(filters.q);
  if (q) {
    const like = q.toLowerCase();
    list = list.filter(c => ["title", "summary", "research_task", "model_architecture", "dataset_name", "domain"]
      .some(k => String(c[k] || "").toLowerCase().includes(like)));
  }
  return list;
}

async function getVisibleCase(db: Db, user: UserRow, caseId: string): Promise<any> {
  const c = one(await db.from("benchmark_cases").select("*").eq("id", caseId).limit(1));
  const notFound = () => new AppError("NOT_FOUND", "案例不存在或无权访问。");
  if (!c) throw notFound();
  if (user.is_platform_admin) return c;
  if (c.is_public || c.created_by === user.id) return c;
  if (c.org_id && (await userOrgIds(db, user)).includes(c.org_id)) return c;
  throw notFound();
}
async function canManageCase(db: Db, user: UserRow, c: any): Promise<boolean> {
  if (c.created_by === user.id) return true;
  return userHasPermission(db, user, "case.manage", c.org_id);
}
async function canVerifyCase(db: Db, user: UserRow, c: any, projectId: string | null = null): Promise<boolean> {
  for (const perm of ["finding.review", "case.manage"]) {
    if (await userHasPermission(db, user, perm, c.org_id, projectId)) return true;
  }
  return false;
}
async function verificationRows(db: Db, caseId: string): Promise<any[]> {
  return rows(await db.from("case_verifications").select("*").eq("case_id", caseId)
    .order("created_at", { ascending: true }).order("id", { ascending: true }).limit(1000));
}
async function verificationDicts(db: Db, list: any[]): Promise<any[]> {
  const ids = [...new Set(list.map(r => r.verifier_user_id).filter(Boolean))];
  const names: Record<string, string> = {};
  if (ids.length) {
    const users = rows(await db.from("users").select("id,display_name").in("id", ids).limit(1000));
    for (const u of users) names[u.id] = u.display_name || "";
  }
  return list.map(r => verificationView(r, names[r.verifier_user_id || ""] ?? ""));
}

const CASE_CREATE_SPEC: Record<string, FieldSpecModel> = {
  title: { type: "str", required: true, minLen: 1, maxLen: 300 },
  doi: { type: "str", def: "" }, source_url: { type: "str", def: "" },
  domain: { type: "str", def: "" }, research_task: { type: "str", def: "" },
  model_architecture: { type: "str", def: "" }, dataset_name: { type: "str", def: "" },
  code_repo_url: { type: "str", def: "" }, code_commit: { type: "str", def: "" },
  license: { type: "str", def: "" }, summary: { type: "str", def: "" },
  org_id: { type: "str", nullable: true, def: null },
  is_public: { type: "bool", def: false },
};
async function createCase(c: Call): Promise<Record<string, any>> {
  const { db, user, rid } = c;
  // extra="forbid"：quality_level/quality_evidence/created_by/id 等系统字段提交即 422
  const data = validateBody(c, CASE_CREATE_SPEC);
  const title = clean(data.title);
  if (!title) throw new AppError("VALIDATION_ERROR", "案例标题不能为空。");
  if (title.length > 300) throw new AppError("VALIDATION_ERROR", "案例标题不得超过 300 字符。");

  const orgIds = await userOrgIds(db, user!);
  let orgId: string | null = clean(data.org_id) || null;
  if (orgId === null) orgId = orgIds.length ? orgIds[0] : null;
  else if (!orgIds.includes(orgId) && !user!.is_platform_admin) {
    throw new AppError("NOT_FOUND", "组织不存在或无权访问。");
  }
  if (!(await userHasPermission(db, user!, "case.manage", orgId))) {
    throw new AppError("FORBIDDEN", "创建基准案例需要 case.manage 权限（researcher 及以上）。");
  }
  const isPublic = asBool(data.is_public ?? false);
  if (isPublic && !(await userHasPermission(db, user!, "org.manage", orgId))) {
    throw new AppError("FORBIDDEN", "发布公共案例需要组织管理员（org_admin）权限。");
  }
  const datasetRaw = clean(data.dataset_name);
  const datasetName = datasetRaw ? normalizeValue("dataset_name", datasetRaw)[0] : "";
  const limits: Record<string, number> = {
    doi: 200, source_url: 500, code_repo_url: 500, code_commit: 80,
    license: 120, model_architecture: 200, domain: 120, research_task: 200,
  };
  const values: Record<string, string> = {};
  for (const [key, maxLen] of Object.entries(limits)) {
    const value = clean(data[key]);
    if (value.length > maxLen) throw new AppError("VALIDATION_ERROR", `${key} 不得超过 ${maxLen} 字符。`);
    values[key] = value;
  }
  const now = nowIso();
  const caseRow = {
    id: newId("case"),
    title,
    doi: values.doi,
    source_url: values.source_url,
    domain: taskKey(data.domain),
    research_task: taskKey(data.research_task),
    model_architecture: values.model_architecture,
    dataset_name: datasetName,
    code_repo_url: values.code_repo_url,
    code_commit: values.code_commit,
    license: values.license,
    quality_level: "unverified",
    quality_evidence_json: dumps({
      level: "unverified", rule_version: RULE_VERSION, computed_at: now,
      basis: [], supporting: [], environment: {}, counts: { total: 0 },
      notes: ["案例创建，尚无任何验证记录；等级只能由系统按验证证据计算。"],
    }),
    version: 1,
    org_id: orgId,
    is_public: isPublic,
    created_by: user!.id,
    summary: String(data.summary || "").trim(),
    created_at: now,
    updated_at: now,
  };
  rows(await db.from("benchmark_cases").insert(caseRow).select("*"));
  await recordTrail(db, {
    action: "case.create", actor_user_id: user!.id, org_id: orgId,
    target_type: "benchmark_case", target_id: caseRow.id,
    after: {
      title, quality_level: "unverified", is_public: isPublic,
      domain: caseRow.domain, research_task: caseRow.research_task, dataset_name: datasetName,
    },
    summary: "创建基准案例", request_id: rid,
  });
  return caseView(caseRow, { fact_count: 0, verification_count: 0, verifications: [], created_by_name: user!.display_name || "" });
}

async function listCases(c: Call): Promise<Record<string, any>> {
  const { db, user, q } = c;
  const limit = intParam(q, "limit", 20, 1, 100);
  const offset = intParam(q, "offset", 0, 0, 1000000);
  const sort = clean(q.get("sort")) || "recent";
  if (!CASE_SORTS.includes(sort)) {
    throw new AppError("VALIDATION_ERROR", `sort 须为 ${pyList([...CASE_SORTS].sort())}。`);
  }
  const filters = {
    domain: q.get("domain"), research_task: q.get("research_task"), dataset: q.get("dataset"),
    quality_level: q.get("quality_level"), q: q.get("q"), org_id: q.get("org_id"),
    is_public: q.get("is_public"),
  };
  const visible = await visibleCases(db, user!, filters);
  const total = visible.length;
  let page: any[];
  if (sort === "quality") {
    const sorted = [...visible].sort((a, b) =>
      (QUALITY_RANK[b.quality_level || "unverified"] ?? 0) - (QUALITY_RANK[a.quality_level || "unverified"] ?? 0)
      || tsSec(b.created_at) - tsSec(a.created_at));
    page = sorted.slice(offset, offset + limit);
  } else {
    const sorted = [...visible].sort((a, b) => {
      if (sort === "recent") return cmpStr(b.created_at || "", a.created_at || "") || cmpStr(b.id, a.id);
      if (sort === "updated") return cmpStr(b.updated_at || "", a.updated_at || "") || cmpStr(b.id, a.id);
      return cmpStr(a.title || "", b.title || "") || cmpStr(a.id, b.id);
    });
    page = sorted.slice(offset, offset + limit);
  }
  const counts: Record<string, number> = {};
  if (page.length) {
    const facts = rows(await db.from("case_facts").select("case_id").in("case_id", page.map(x => x.id)).limit(1000));
    for (const fr of facts) counts[fr.case_id] = (counts[fr.case_id] ?? 0) + 1;
  }
  const creatorIds = [...new Set(page.map(x => x.created_by).filter(Boolean))];
  const creators: Record<string, string> = {};
  if (creatorIds.length) {
    const users = rows(await db.from("users").select("id,display_name").in("id", creatorIds).limit(1000));
    for (const u of users) creators[u.id] = u.display_name;
  }
  const items = page.map(x => caseView(x, {
    fact_count: counts[x.id] ?? 0,
    created_by_name: creators[x.created_by] ?? null,
  }));
  return { items, total, limit, offset, sort };
}

async function getCase(c: Call): Promise<Record<string, any>> {
  const { db, user, params } = c;
  const caseRow = await getVisibleCase(db, user!, params.case_id);
  const facts = rows(await db.from("case_facts").select("id").eq("case_id", caseRow.id).limit(1000));
  const vrows = await verificationRows(db, caseRow.id);
  const verifications = await verificationDicts(db, vrows);
  let creatorName = "";
  if (caseRow.created_by) {
    const u = one(await db.from("users").select("display_name").eq("id", caseRow.created_by).limit(1));
    creatorName = u ? u.display_name : "";
  }
  const data = caseView(caseRow, {
    fact_count: facts.length, verification_count: vrows.length,
    verifications, created_by_name: creatorName,
  });
  data.quality_standard = qualityStandardView();
  return data;
}

async function addCaseFact(c: Call): Promise<Record<string, any>> {
  const { db, user, params, rid } = c;
  const caseRow = await getVisibleCase(db, user!, params.case_id);
  if (!(await canManageCase(db, user!, caseRow))) {
    throw new AppError("FORBIDDEN", "新增案例事实需要案例创建者或 case.manage 权限。");
  }
  const data = bodyObj(c);
  forbidExtra(data, ["raw_field", "field_key", "raw_value", "value", "unit", "source_type",
    "source_ref", "context", "applicable_experiment", "confidence"]);
  const rawField = clean(data.raw_field || data.field_key || data.field);
  if (!rawField) throw new AppError("VALIDATION_ERROR", "字段名（raw_field/field_key）不能为空。");
  if (rawField.length > 120) throw new AppError("VALIDATION_ERROR", "字段名不得超过 120 字符。");
  let rawValue = data.raw_value;
  if (rawValue === null || rawValue === undefined) rawValue = data.value;
  rawValue = rawValue === null || rawValue === undefined ? "" : String(rawValue).trim();
  if (!rawValue) throw new AppError("VALIDATION_ERROR", "字段值（raw_value/value）不能为空。");

  const fk = normalizeField(rawField);
  if (!fk) throw new AppError("VALIDATION_ERROR", "字段名无法归一化，请使用有意义的字段名（如 learning_rate）。");
  if (fk.length > 80) throw new AppError("VALIDATION_ERROR", "归一化后的 field_key 不得超过 80 字符。");
  const [normalizedValue, parsedUnit] = normalizeValue(fk, rawValue);
  let unit = parsedUnit;
  const overrideUnit = clean(data.unit);
  if (overrideUnit) {
    if (overrideUnit.length > 40) throw new AppError("VALIDATION_ERROR", "unit 不得超过 40 字符。");
    unit = overrideUnit;
  }
  const sourceType = clean(data.source_type) || "manual";
  if (!SOURCE_TYPES.includes(sourceType)) {
    throw new AppError("VALIDATION_ERROR", `source_type 须为 ${pyList(SOURCE_TYPES)}。`);
  }
  const sourceRef = clean(data.source_ref);
  const applicableExperiment = clean(data.applicable_experiment);
  if (sourceRef.length > 300) throw new AppError("VALIDATION_ERROR", "source_ref 不得超过 300 字符。");
  if (applicableExperiment.length > 200) throw new AppError("VALIDATION_ERROR", "applicable_experiment 不得超过 200 字符。");
  const context = String(data.context || "").trim();
  const confRaw = data.confidence === null || data.confidence === undefined ? 0.0 : data.confidence;
  const confidence = Number(confRaw);
  if (!Number.isFinite(confidence)) throw new AppError("VALIDATION_ERROR", "confidence 须为 0~1 的数值。");
  if (!(confidence >= 0 && confidence <= 1)) throw new AppError("VALIDATION_ERROR", "confidence 须在 0~1 之间。");

  const duplicate = one(await db.from("case_facts").select("*")
    .eq("case_id", caseRow.id).eq("field_key", fk).eq("normalized_value", normalizedValue)
    .eq("applicable_experiment", applicableExperiment).eq("source_ref", sourceRef).limit(1));
  if (duplicate) throw new AppError("CONFLICT", "相同事实已存在（字段/归一值/适用实验/来源均一致）。");

  const factRow = {
    id: newId("cf"), case_id: caseRow.id, field_key: fk,
    raw_field: rawField, raw_value: rawValue, normalized_value: normalizedValue,
    unit, source_type: sourceType, source_ref: sourceRef, context,
    applicable_experiment: applicableExperiment, confidence: String(confidence),
    created_at: nowIso(),
  };
  rows(await db.from("case_facts").insert(factRow).select("*"));
  rows(await db.from("benchmark_cases").update({
    version: (caseRow.version || 1) + 1, updated_at: nowIso(),
  }).eq("id", caseRow.id).select("*"));
  await recordTrail(db, {
    action: "case.fact_add", actor_user_id: user!.id, org_id: caseRow.org_id,
    target_type: "case_fact", target_id: factRow.id,
    after: {
      case_id: caseRow.id, field_key: fk, raw_value: rawValue,
      normalized_value: normalizedValue, unit, source_type: sourceType, source_ref: sourceRef,
    },
    summary: `新增案例事实：${fieldLabel(fk)}`, request_id: rid,
  });
  return caseFactView(factRow);
}

async function listCaseFacts(c: Call): Promise<Record<string, any>> {
  const { db, user, params, q } = c;
  const caseRow = await getVisibleCase(db, user!, params.case_id);
  let builder = db.from("case_facts").select("*").eq("case_id", caseRow.id);
  const fieldKey = q.get("field_key");
  if (fieldKey) builder = builder.eq("field_key", normalizeField(fieldKey));
  const list = rows(await builder.order("created_at", { ascending: true }).order("id", { ascending: true }).limit(1000));
  let views = list.map(caseFactView);
  const category = q.get("category");
  if (category) {
    if (!(category in CATEGORIES) && category !== "other") {
      throw new AppError("VALIDATION_ERROR", `category 须为 ${pyList([...Object.keys(CATEGORIES), "other"])}。`);
    }
    views = views.filter(v => v.category === category);
  }
  const order: Record<string, number> = Object.fromEntries(Object.keys(CATEGORIES).map((k, i) => [k, i]));
  views.sort((a, b) => (order[a.category] ?? 99) - (order[b.category] ?? 99)
    || cmpStr(a.field_key, b.field_key) || cmpStr(a.created_at, b.created_at));
  return { items: views, total: views.length };
}

async function applyQuality(db: Db, user: UserRow, caseRow: any, rid: string,
  confirmDowngrade: boolean, action: string): Promise<Record<string, any>> {
  const vrows = await verificationRows(db, caseRow.id);
  const verifications = vrows.map(r => verificationView(r));
  const [computed, evidence] = evaluateQuality(caseRow.created_by, verifications);
  const current = caseRow.quality_level || "unverified";
  let changed = false;
  let blocked = false;
  if ((QUALITY_RANK[computed] ?? 0) > (QUALITY_RANK[current] ?? 0)) {
    caseRow.quality_level = computed;
    changed = true;
  } else if ((QUALITY_RANK[computed] ?? 0) < (QUALITY_RANK[current] ?? 0)) {
    if (confirmDowngrade) {
      caseRow.quality_level = computed;
      changed = true;
    } else {
      blocked = true;
      evidence.notes.push(`计算等级 ${computed} 低于当前等级 ${current}；未确认降级，保持 ${current}。`);
    }
  }
  evidence.level = caseRow.quality_level;
  evidence.computed_level = computed;
  evidence.previous_level = current;
  evidence.downgrade_blocked = blocked;
  evidence.confirm_downgrade = !!confirmDowngrade;
  caseRow.quality_evidence_json = dumps(evidence);
  rows(await db.from("benchmark_cases").update({
    quality_level: caseRow.quality_level,
    quality_evidence_json: caseRow.quality_evidence_json,
    updated_at: nowIso(),
  }).eq("id", caseRow.id).select("*"));
  if (changed) {
    await recordTrail(db, {
      action, actor_user_id: user.id, org_id: caseRow.org_id,
      target_type: "benchmark_case", target_id: caseRow.id,
      before: { quality_level: current },
      after: {
        quality_level: caseRow.quality_level,
        basis: evidence.basis.map((b: any) => b.verification_id),
        rule_version: RULE_VERSION,
      },
      summary: `案例质量等级 ${current} → ${caseRow.quality_level}`, request_id: rid,
    });
  }
  return {
    case_id: caseRow.id,
    quality_level: caseRow.quality_level,
    quality_label: QUALITY_LABELS[caseRow.quality_level] ?? "未验证",
    computed_level: computed,
    previous_level: current,
    changed,
    downgrade_blocked: blocked,
    quality_evidence: evidence,
    verification_count: vrows.length,
  };
}

async function addVerification(c: Call): Promise<Record<string, any>> {
  const { db, user, params, rid } = c;
  const data = bodyObj(c);
  forbidExtra(data, ["verification_type", "result", "conditions_json", "notes", "project_id"]);
  const caseRow = await getVisibleCase(db, user!, params.case_id);
  const projectId = data.project_id ?? null;
  if (!(await canVerifyCase(db, user!, caseRow, projectId))) {
    throw new AppError("FORBIDDEN", "提交验证需要 finding.review 或 case.manage 权限（reviewer 及以上）。");
  }
  const vtype = clean(data.verification_type).toLowerCase();
  if (!VERIFICATION_TYPES.includes(vtype)) {
    throw new AppError("VALIDATION_ERROR", `verification_type 须为 ${pyList([...VERIFICATION_TYPES].sort())}。`);
  }
  const vresult = clean(data.result ?? "pass").toLowerCase();
  if (!VERIFICATION_RESULTS.includes(vresult)) {
    throw new AppError("VALIDATION_ERROR", `result 须为 ${pyList([...VERIFICATION_RESULTS].sort())}。`);
  }
  let conditions: Record<string, any> = {};
  const cj = data.conditions_json;
  if (cj && typeof cj === "object" && !Array.isArray(cj)) {
    conditions = cj;
  } else if (typeof cj === "string" && cj.trim()) {
    const parsed = loads(cj);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new AppError("VALIDATION_ERROR", "conditions_json 须为 JSON 对象字符串。");
    }
    conditions = parsed;
  } else if (cj !== null && cj !== undefined && cj !== "") {
    throw new AppError("VALIDATION_ERROR", "conditions_json 须为 JSON 对象。");
  }
  const row = {
    id: newId("cv"), case_id: caseRow.id, verifier_user_id: user!.id,
    verification_type: vtype,
    conditions_json: Object.keys(conditions).length ? dumps(conditions) : null,
    result: vresult, notes: String(data.notes || "").trim(),
    created_at: nowIso(),
  };
  rows(await db.from("case_verifications").insert(row).select("*"));
  await recordTrail(db, {
    action: "case.verification", actor_user_id: user!.id, org_id: caseRow.org_id,
    target_type: "case_verification", target_id: row.id,
    after: {
      case_id: caseRow.id, verification_type: vtype, result: vresult,
      conditions, notes: row.notes,
    },
    summary: `提交案例验证：${vtype}/${vresult}`, request_id: rid,
  });
  const quality = await applyQuality(db, user!, caseRow, rid, false, "case.quality_change");
  return { verification: verificationView(row, user!.display_name || ""), ...quality };
}

async function listVerifications(c: Call): Promise<Record<string, any>> {
  const { db, user, params } = c;
  const caseRow = await getVisibleCase(db, user!, params.case_id);
  const items = await verificationDicts(db, await verificationRows(db, caseRow.id));
  return { items, total: items.length };
}

async function recomputeQuality(c: Call): Promise<Record<string, any>> {
  const { db, user, params, rid } = c;
  const data = bodyObj(c);
  forbidExtra(data, ["confirm_downgrade"]);
  const caseRow = await getVisibleCase(db, user!, params.case_id);
  if (!(await canVerifyCase(db, user!, caseRow))) {
    throw new AppError("FORBIDDEN", "重算质量等级需要 finding.review 或 case.manage 权限。");
  }
  return applyQuality(db, user!, caseRow, rid, !!data.confirm_downgrade, "case.quality_recompute");
}

// ============================ case_search（结构化筛选 + 加权 TF-IDF） ============================

const PROVENANCE_CLASS = "historical_case";
const DISCLAIMER = "检索结果为历史基准案例，仅供参考比对；不得作为当前论文事实，"
  + "也不得覆盖当前论文证据（provenance_class=historical_case）。";
const SEARCH_FIELDS: Record<string, number> = {
  title: 2.0, research_task: 1.6, dataset_name: 1.5, model_architecture: 1.4, summary: 1.0,
};
const SEARCH_FIELD_LABELS: Record<string, string> = {
  title: "标题", summary: "摘要", research_task: "研究任务", model_architecture: "模型架构", dataset_name: "数据集",
};
const STOPWORDS = new Set([
  "the", "a", "an", "of", "for", "and", "or", "to", "in", "on", "with", "by", "is",
  "are", "was", "were", "we", "our", "this", "that", "these", "those", "as", "at",
  "from", "it", "its", "be", "been", "using", "use", "via", "which", "their", "can",
  "also", "than", "then", "so", "such", "both", "each", "per", "when", "while",
  "after", "before", "between", "within", "without", "up", "down", "out", "over",
  "under", "again", "more", "most", "other", "some", "any", "all", "not", "no",
  "paper", "study", "approach", "results", "result", "et", "al",
  "的", "了", "和", "与", "及", "在", "是", "对", "为", "以", "并", "或", "等",
  "中", "上", "下", "我们", "本文", "该", "此", "其", "以及", "通过", "进行",
  "使用", "采用", "基于", "一种", "一个", "论文", "研究", "方法", "实验",
]);
const ASCII_RE = /[a-z0-9][a-z0-9._+\-]*/g;
const CJK_RE = /[\u4e00-\u9fff]+/g;
const SPLIT_RE = /[-_.+/]/;

function tokenize(text: string): string[] {
  const s = (text || "").toLowerCase();
  const tokens: string[] = [];
  for (const match of s.matchAll(ASCII_RE)) {
    const tok = match[0].replace(/^[._+-]+|[._+-]+$/g, "");
    if (!tok || STOPWORDS.has(tok)) continue;
    if (tok.length > 1 || /^\d+$/.test(tok)) tokens.push(tok);
    for (const part of tok.split(SPLIT_RE)) {
      const p = part.trim();
      if (p.length > 1 && !STOPWORDS.has(p) && p !== tok) tokens.push(p);
    }
  }
  for (const run of s.matchAll(CJK_RE)) {
    const r = run[0];
    if (r.length === 1) {
      if (!STOPWORDS.has(r)) tokens.push(r);
      continue;
    }
    for (let i = 0; i < r.length - 1; i++) {
      const gram = r.slice(i, i + 2);
      if (!STOPWORDS.has(gram)) tokens.push(gram);
    }
  }
  return tokens;
}
const compactText = (text: string): string => (text || "").toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, "");

function weightedTf(caseRow: any): Map<string, number> {
  const tf = new Map<string, number>();
  for (const [field, weight] of Object.entries(SEARCH_FIELDS)) {
    for (const tok of tokenize(String(caseRow[field] || ""))) {
      tf.set(tok, (tf.get(tok) ?? 0) + weight);
    }
  }
  return tf;
}
function cosineSim(queryVec: Map<string, number>, docVec: Map<string, number>): number {
  if (!queryVec.size || !docVec.size) return 0;
  let dot = 0;
  for (const [tok, w] of queryVec) dot += w * (docVec.get(tok) ?? 0);
  let qn = 0;
  for (const w of queryVec.values()) qn += w * w;
  let dn = 0;
  for (const w of docVec.values()) dn += w * w;
  qn = Math.sqrt(qn); dn = Math.sqrt(dn);
  if (qn === 0 || dn === 0) return 0;
  return dot / (qn * dn);
}
const toVec = (tf: Map<string, number>, idf: Map<string, number>): Map<string, number> => {
  const out = new Map<string, number>();
  const def = Math.log(2) + 1;
  for (const [tok, weight] of tf) out.set(tok, weight * (idf.get(tok) ?? def));
  return out;
};

function structuredHits(caseRow: any, queryTokens: Set<string>, queryCompact: string): [string, string][] {
  const hits: [string, string][] = [];
  const covers = (value: string): boolean => {
    if (!value.trim()) return false;
    const toks = new Set(tokenize(value));
    if (toks.size && [...toks].every(t => queryTokens.has(t))) return true;
    const compact = compactText(value);
    return !!compact && compact.length >= 3 && queryCompact.includes(compact);
  };
  if (covers(String(caseRow.research_task || ""))) hits.push(["research_task", `research_task 匹配: ${caseRow.research_task}`]);
  if (covers(String(caseRow.dataset_name || ""))) hits.push(["dataset", `dataset 相同: ${caseRow.dataset_name}`]);
  if (covers(String(caseRow.domain || ""))) hits.push(["domain", `domain 匹配: ${caseRow.domain}`]);
  if (covers(String(caseRow.model_architecture || ""))) hits.push(["model_architecture", `模型架构相似: ${caseRow.model_architecture}`]);
  return hits;
}
function textBasis(queryTokens: string[], docTokens: Set<string>, idf: Map<string, number>): string | null {
  const shared = queryTokens.filter(t => docTokens.has(t));
  if (!shared.length) return null;
  const phrases: string[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < queryTokens.length - 1; i++) {
    const a = queryTokens[i], b = queryTokens[i + 1];
    if (docTokens.has(a) && docTokens.has(b) && /^[a-z]+$/.test(a) && /^[a-z]+$/.test(b)) {
      const phrase = `${a} ${b}`;
      if (!seen.has(phrase)) { seen.add(phrase); phrases.push(phrase); }
    }
    if (phrases.length >= 3) break;
  }
  if (phrases.length) return "文本相似项: " + phrases.join(", ");
  const ranked = [...new Set(shared)].sort((a, b) => (idf.get(b) ?? 0) - (idf.get(a) ?? 0)).slice(0, 4);
  return "文本相似项: " + ranked.join(", ");
}

async function searchCases(c: Call): Promise<Record<string, any>> {
  const { db, user } = c;
  const data = bodyObj(c);
  forbidExtra(data, ["query", "filters", "top_k"]);
  const filtersIn = data.filters ?? {};
  if (typeof filtersIn !== "object" || Array.isArray(filtersIn)) {
    throw new AppError("VALIDATION_ERROR", "filters 须为 JSON 对象。");
  }
  const filters: Record<string, any> = { ...filtersIn };
  const topK = intParamLocal(data.top_k ?? 10, 10, 1, 50);
  const queryText = String(data.query || "").trim();
  const minQuality = String(filters.min_quality ?? "").trim();
  delete filters.min_quality;
  if (minQuality && !(minQuality in QUALITY_RANK)) {
    throw new AppError("VALIDATION_ERROR", `min_quality 须为 ${pyList(Object.keys(QUALITY_RANK))}。`);
  }
  const minScoreRaw = filters.min_score;
  delete filters.min_score;
  let minScore: number | null = null;
  if (minScoreRaw !== null && minScoreRaw !== undefined && minScoreRaw !== "") {
    minScore = Number(minScoreRaw);
    if (!Number.isFinite(minScore)) throw new AppError("VALIDATION_ERROR", "min_score 须为数值。");
  }

  let cases = await visibleCases(db, user!, filters);
  if (minQuality) {
    const floor = QUALITY_RANK[minQuality];
    cases = cases.filter(x => (QUALITY_RANK[x.quality_level || "unverified"] ?? 0) >= floor);
  }
  const queryTokens = tokenize(queryText);
  const queryTokenSet = new Set(queryTokens);
  const queryCompact = compactText(queryText);
  const queryTf = new Map<string, number>();
  for (const t of queryTokens) queryTf.set(t, (queryTf.get(t) ?? 0) + 1);

  const docTfs = new Map<string, Map<string, number>>();
  const docFreq = new Map<string, number>();
  for (const x of cases) {
    const tf = weightedTf(x);
    docTfs.set(x.id, tf);
    for (const tok of tf.keys()) docFreq.set(tok, (docFreq.get(tok) ?? 0) + 1);
  }
  const idf = new Map<string, number>();
  for (const [tok, df] of docFreq) idf.set(tok, Math.log((1 + cases.length) / (1 + df)) + 1);
  const queryVec = queryTf.size ? toVec(queryTf, idf) : new Map<string, number>();

  const activeFilterKeys = ["domain", "research_task", "dataset", "dataset_name", "quality_level", "org_id", "is_public", "q"];
  const activeFilters: Record<string, any> = {};
  for (const [k, v] of Object.entries(filters)) {
    if (!activeFilterKeys.includes(k)) continue;
    if (v === null || v === undefined || v === "" || (Array.isArray(v) && v.length === 0)) continue;
    activeFilters[k] = v;
  }

  const results: any[] = [];
  for (const x of cases) {
    const tf = docTfs.get(x.id)!;
    const docTokens = new Set(tf.keys());
    const cosine = queryVec.size ? cosineSim(queryVec, toVec(tf, idf)) : 0;
    const hits = queryText ? structuredHits(x, queryTokenSet, queryCompact) : [];
    const hitTypes = new Set(hits.map(([kind]) => kind));

    let score = 0.60 * cosine;
    if (hitTypes.has("research_task")) score += 0.18;
    if (hitTypes.has("dataset")) score += 0.12;
    if (hitTypes.has("domain")) score += 0.05;
    if (hitTypes.has("model_architecture")) score += 0.05;

    const basis: string[] = hits.map(([, text]) => text);
    const titleLower = String(x.title || "").toLowerCase();
    if (queryText && queryText.length >= 4 && titleLower.includes(queryText.toLowerCase())) {
      score += 0.10;
      basis.unshift(`标题包含查询短语: ${queryText}`);
    }
    const tb = queryText ? textBasis(queryTokens, docTokens, idf) : null;
    if (tb) basis.push(tb);
    for (const [key, value] of Object.entries(activeFilters)) {
      basis.push(`筛选条件命中: ${key}=${pyStr(value)}`);
    }
    if (minQuality) basis.push(`质量等级不低于 ${minQuality}`);
    const level = x.quality_level || "unverified";
    basis.push(`质量等级: ${level}（${QUALITY_LABELS[level] ?? "未验证"}）`);
    if (!queryText) basis.unshift("未提供查询词：按质量等级与更新时间排序的参考列表");
    else if (!hits.length && cosine <= 0) basis.push("仅结构化筛选命中，文本无相似项");

    score = round4(Math.min(1, score));
    if (queryText && score <= 0 && !Object.keys(activeFilters).length) continue;
    if (minScore !== null && score < minScore) continue;
    const matched = new Set<string>(hitTypes);
    if (cosine > 0) matched.add("text");
    results.push({
      case: caseView(x),
      score,
      match_basis: basis,
      matched_fields: [...matched].sort(),
      text_similarity: round4(cosine),
      provenance_class: PROVENANCE_CLASS,
      usage_note: "历史案例参考，不得作为当前论文事实。",
    });
  }
  results.sort((a, b) => (b.score - a.score)
    || (QUALITY_RANK[b.case.quality_level] ?? 0) - (QUALITY_RANK[a.case.quality_level] ?? 0)
    || tsSec(b.case.updated_at) - tsSec(a.case.updated_at));
  const items = results.slice(0, topK);
  return {
    items,
    query: queryText,
    total: items.length,
    top_k: topK,
    provenance_class: PROVENANCE_CLASS,
    disclaimer: DISCLAIMER,
    algorithm: "structured_filters + weighted_tfidf_cosine (pure python, no vector db)",
    score_weights: {
      text_cosine: 0.60, research_task: 0.18, dataset: 0.12,
      domain: 0.05, model_architecture: 0.05, title_phrase: 0.10,
    },
    search_fields: Object.fromEntries(Object.entries(SEARCH_FIELDS)
      .map(([k, w]) => [k, { weight: w, label: SEARCH_FIELD_LABELS[k] }])),
  };
}

// ============================ 遗留事实（extracted_facts / evidence / revisions） ============================

function evidenceView(ev: any): Record<string, any> {
  return {
    evidence_id: ev.evidence_id, chunk_id: ev.chunk_id,
    quote: ev.quote, source_name: ev.source_name,
    source_locator: ev.source_locator ? loads(ev.source_locator) : null,
    verification_status: ev.verification_status,
    original_text: ev.original_text,
  };
}
function legacyFactView(fact: any, evidence: any[], revisions: number): Record<string, any> {
  return {
    fact_id: fact.fact_id || String(fact.id), project_id: fact.project_id,
    material_id: fact.material_id, fact_type: fact.fact_type,
    field_key: fact.field_key, field_label: fact.field_label || fact.field_key,
    raw_value: fact.raw_value, normalized_value: fact.normalized_value,
    unit: fact.unit, assertion_type: fact.assertion_type,
    extraction_status: fact.extraction_status, parser_source: fact.parser_source,
    extraction_run_id: fact.extraction_run_id, confidence: num(fact.confidence),
    source_name: fact.source_name, evidence: evidence.map(evidenceView),
    revision_count: revisions,
    created_at: fact.created_at || "",
  };
}
const loadEvidence = (db: Db, factId: string): Promise<any[]> =>
  softRows(db.from("evidence_items").select("*").eq("fact_id", factId).limit(1000));

async function listFacts(c: Call): Promise<Record<string, any>> {
  const { db, user, q } = c;
  const projectId = requireQuery(q, "project_id");
  await projectContext(db, projectId, user!);
  let builder = db.from("extracted_facts").select("*").eq("project_id", projectId);
  const materialId = q.get("material_id");
  if (materialId) builder = builder.eq("material_id", materialId);
  const list = rows(await builder.order("created_at", { ascending: false }).limit(500));
  const items: any[] = [];
  for (const fact of list) {
    const fid = fact.fact_id || String(fact.id);
    const ev = await loadEvidence(db, fid);
    const rc = await softRows(db.from("fact_revisions").select("revision_id").eq("fact_id", fid).limit(1000));
    items.push(legacyFactView(fact, ev, rc.length));
  }
  return { items, total: items.length };
}

async function factByPublicId(db: Db, id: string) {
  const row = one(await db.from("extracted_facts").select("*").eq("fact_id", id).limit(1));
  if (row || !/^(0|[1-9]\d{0,9})$/.test(id) || Number(id) > 2147483647) return row;
  const legacy = one(await db.from("extracted_facts").select("*").eq("id", Number(id)).limit(1));
  return legacy && !legacy.fact_id ? legacy : null;
}

async function patchFact(c: Call): Promise<Record<string, any>> {
  const { db, user, params } = c;
  const data = bodyObj(c);
  forbidExtra(data, ["field_key", "field_label", "raw_value", "normalized_value", "note"]);
  const fact = await factByPublicId(db, params.fact_id);
  if (!fact) throw new AppError("NOT_FOUND", "事实不存在。");
  const { role } = await projectContext(db, fact.project_id, user!);
  await requirePermission(db, role, "fact.revise");
  const changes: [string, any, any][] = [];
  const patch: Record<string, any> = {};
  for (const field of ["field_key", "field_label", "raw_value", "normalized_value"]) {
    const nv = data[field];
    if (nv === null || nv === undefined) continue;
    if (fact[field] !== nv) {
      changes.push([field, fact[field], nv]);
      patch[field] = nv;
    }
  }
  if (changes.length) {
    // 首次人工修订保留修改前的模型取值。
    if (fact.parser_source === "model") {
      patch.ai_original_json = dumps({
        field_key: fact.field_key, field_label: fact.field_label,
        raw_value: fact.raw_value, normalized_value: fact.normalized_value,
      });
      fact.ai_original_json = patch.ai_original_json;
    }
    patch.parser_source = "human";
    fact.parser_source = "human";
    patch.revision_count = (fact.revision_count || 0) + 1;
    fact.revision_count = patch.revision_count;
    for (const [field, oldValue, newValue] of changes) {
      rows(await db.from("fact_revisions").insert({
        id: await nextIntId(db, "fact_revisions"), revision_id: id14("rev"), fact_id: params.fact_id,
        field_key: field, old_value: oldValue, new_value: newValue,
        revision_source: "human", note: data.note ?? "",
        created_at: nowIso(),
      }).select("*"));
    }
    rows(await db.from("extracted_facts").update(patch).eq("id", fact.id).select("*"));
    Object.assign(fact, patch);
  }
  const ev = await loadEvidence(db, params.fact_id);
  return legacyFactView(fact, ev, fact.revision_count || 0);
}

async function factRevisions(c: Call): Promise<Record<string, any>> {
  const { db, user, params } = c;
  const fact = await factByPublicId(db, params.fact_id);
  if (!fact) throw new AppError("NOT_FOUND", "事实不存在。");
  await projectContext(db, fact.project_id, user!);
  const list = await softRows(db.from("fact_revisions").select("*").eq("fact_id", params.fact_id)
    .order("created_at", { ascending: true }).limit(1000));
  const items = list.map(r => ({
    revision_id: r.revision_id, fact_id: r.fact_id, field_key: r.field_key,
    old_value: r.old_value, new_value: r.new_value,
    revision_source: r.revision_source, note: r.note,
    created_at: r.created_at || "",
  }));
  return { items, total: items.length };
}

async function factsSummary(c: Call): Promise<Record<string, any>> {
  const { db, user, q } = c;
  const projectId = requireQuery(q, "project_id");
  await projectContext(db, projectId, user!);
  const list = rows(await db.from("extracted_facts").select("*").eq("project_id", projectId).limit(1000));
  const byAssertion: Record<string, number> = { explicit: 0, inferred: 0, ambiguous: 0, not_found: 0 };
  const byStatus: Record<string, number> = { supported: 0, unsupported: 0, needs_review: 0 };
  const byType: Record<string, number> = {};
  let withEvidence = 0;
  let human = 0;
  for (const fact of list) {
    if (fact.assertion_type in byAssertion) byAssertion[fact.assertion_type] += 1;
    if (fact.extraction_status in byStatus) byStatus[fact.extraction_status] += 1;
    byType[fact.fact_type] = (byType[fact.fact_type] ?? 0) + 1;
    if (fact.parser_source === "human") human += 1;
    const fid = fact.fact_id || String(fact.id);
    const ev = await softRows(db.from("evidence_items").select("id").eq("fact_id", fid).limit(1));
    if (ev.length) withEvidence += 1;
  }
  return {
    total: list.length, by_assertion: byAssertion, by_status: byStatus,
    with_evidence: withEvidence, human_confirmed: human, by_type: byType,
  };
}

// ============================ 材料 / 解析任务 / 概览 ============================

function materialView(m: any, chunkCount = 0, factCount = 0): Record<string, any> {
  return {
    material_id: m.id, project_id: m.project_id,
    filename: m.source_name, material_type: m.material_type,
    size_bytes: m.file_size_bytes, parse_status: m.parse_status,
    sha256: m.sha256, chunk_count: chunkCount, fact_count: factCount,
    created_at: m.created_at || "",
    error_message: m.parse_error_message,
  };
}
async function getMaterialRow(db: Db, materialId: string): Promise<any> {
  const m = one(await db.from("materials").select("*").eq("id", materialId).limit(1));
  if (!m) throw new AppError("NOT_FOUND", "材料不存在。");
  return m;
}
const countBy = async (db: Db, table: string, col: string, val: string): Promise<number> =>
  rows(await db.from(table).select("id").eq(col, val).limit(1000)).length;

async function listMaterials(c: Call): Promise<Record<string, any>> {
  const { db, user, q } = c;
  const projectId = requireQuery(q, "project_id");
  await projectContext(db, projectId, user!);
  const list = rows(await db.from("materials").select("*").eq("project_id", projectId)
    .order("created_at", { ascending: false }).limit(1000));
  const items: any[] = [];
  for (const m of list) {
    const cc = await countBy(db, "source_chunks", "material_id", m.id);
    const fc = await countBy(db, "extracted_facts", "material_id", m.id);
    items.push(materialView(m, cc, fc));
  }
  return { items, total: items.length };
}

async function getMaterial(c: Call): Promise<Record<string, any>> {
  const { db, user, params } = c;
  const m = await getMaterialRow(db, params.material_id);
  await projectContext(db, m.project_id, user!);
  const cc = await countBy(db, "source_chunks", "material_id", m.id);
  const fc = await countBy(db, "extracted_facts", "material_id", m.id);
  const view = materialView(m, cc, fc);
  const metadata = m.parse_metadata_json ? (loads(m.parse_metadata_json) ?? {}) : {};
  const warnings = m.warnings_json ? (loads(m.warnings_json) ?? []) : [];
  const chunks = rows(await db.from("source_chunks").select("*").eq("material_id", m.id)
    .order("chunk_index", { ascending: true }).limit(30));
  const preview = chunks.map(x => x.original_text).join("\n\n").slice(0, 8000);
  return {
    ...view,
    metadata, warnings,
    raw_preview: preview, can_preview: chunks.length > 0,
    page_count: m.page_count, needs_ocr: m.needs_ocr,
    parse_duration_ms: m.parse_duration_ms,
    parse_error_code: m.parse_error_code,
  };
}

async function downloadMaterial(c: Call): Promise<Response> {
  const { db, params } = c;
  const m = await getMaterialRow(db, params.material_id);
  if (!m.stored_path) throw new AppError("NOT_FOUND", "材料文件未存储。");
  // 站点无文件系统：仅当原始文本已落库时提供下载，否则诚实声明演示限制
  if (m.raw_text) {
    return new Response(new TextEncoder().encode(m.raw_text), {
      headers: {
        "content-type": m.mime_type || "application/octet-stream",
        "content-disposition": `attachment; filename="${m.source_name}"`,
      },
    });
  }
  throw new AppError("DEMO_LIMIT", "演示站点未存储该材料的原始文件，无法下载。", null, 501);
}

async function deleteMaterial(c: Call): Promise<Record<string, any>> {
  const { db, user, params } = c;
  const m = await getMaterialRow(db, params.material_id);
  await projectContext(db, m.project_id, user!);
  const chunks = await countBy(db, "source_chunks", "material_id", m.id);
  const facts = await countBy(db, "extracted_facts", "material_id", m.id);
  const evs = (await softRows(db.from("evidence_items").select("id").eq("material_id", m.id).limit(1000))).length;
  await softRows(db.from("evidence_items").delete().eq("material_id", m.id).select("*"));
  rows(await db.from("source_chunks").delete().eq("material_id", m.id).select("*"));
  rows(await db.from("extracted_facts").delete().eq("material_id", m.id).select("*"));
  rows(await db.from("materials").delete().eq("id", m.id).select("*"));
  return { deleted: true, cascaded: { chunks, facts, evidence: evs } };
}

const STAGE_LABELS: Record<string, string> = {
  uploaded: "已上传", queued: "排队中", parsing: "解析材料中",
  extracting: "AI 抽取事实中", completed: "已完成",
  partially_completed: "部分完成", failed: "失败", unsupported: "不支持",
};
function parseTaskView(t: any, materialName = ""): Record<string, any> {
  return {
    task_id: t.id, material_id: t.material_id,
    material_name: materialName, project_id: t.project_id,
    status: t.status, stage: t.stage,
    stage_message: t.stage_message || STAGE_LABELS[t.stage] || t.stage,
    started_at: t.started_at || null,
    completed_at: t.completed_at || null,
    error_code: t.error_code, error_message: t.error_message,
    model: t.model, prompt_version: t.prompt_version,
    model_calls: t.model_calls, total_tokens: t.total_tokens,
    prompt_tokens: t.prompt_tokens, completion_tokens: t.completion_tokens,
    duration_ms: t.duration_ms, facts_count: t.facts_count,
    created_at: t.created_at || "",
  };
}
async function materialName(db: Db, materialId: string): Promise<string> {
  const m = one(await db.from("materials").select("source_name").eq("id", materialId).limit(1));
  return m ? m.source_name : "";
}
async function getParseTaskRow(db: Db, taskId: string): Promise<any> {
  const t = await softOne(db.from("parse_tasks").select("*").eq("id", taskId).limit(1));
  if (!t) throw new AppError("NOT_FOUND", "任务不存在。");
  return t;
}

async function listParseTasks(c: Call): Promise<Record<string, any>> {
  const { db, user, q } = c;
  const projectId = requireQuery(q, "project_id");
  await projectContext(db, projectId, user!);
  const list = await softRows(db.from("parse_tasks").select("*").eq("project_id", projectId)
    .order("created_at", { ascending: false }).limit(1000));
  const items: any[] = [];
  for (const t of list) items.push(parseTaskView(t, await materialName(db, t.material_id)));
  return { items, total: items.length };
}
async function getParseTask(c: Call): Promise<Record<string, any>> {
  const { db, user, params } = c;
  const t = await getParseTaskRow(db, params.task_id);
  await projectContext(db, t.project_id, user!);
  return parseTaskView(t, await materialName(db, t.material_id));
}
async function cancelParseTask(c: Call): Promise<Record<string, any>> {
  const { db, user, params } = c;
  const t = await getParseTaskRow(db, params.task_id);
  await projectContext(db, t.project_id, user!);
  if (["completed", "failed"].includes(t.status)) return { cancelled: false, reason: "任务已结束" };
  rows(await db.from("parse_tasks").update({
    cancel_requested: true, status: "failed", error_code: "CANCELLED",
    stage: "failed", stage_message: "用户取消",
  }).eq("id", t.id).select("*"));
  return { cancelled: true, note: "已标记取消；同步执行中的任务在下一阶段边界停止" };
}

async function parseOverview(c: Call): Promise<Record<string, any>> {
  const { db, user, params } = c;
  const { project } = await projectContext(db, params.project_id, user!);
  const projectId = project.id;
  const materials = rows(await db.from("materials").select("*").eq("project_id", projectId).limit(1000));
  const matCounts: Record<string, number> = { total: 0, completed: 0, partially_completed: 0, failed: 0, pending: 0 };
  const byType: Record<string, number> = {};
  for (const m of materials) {
    matCounts.total += 1;
    const st = m.parse_status || "uploaded";
    if (st === "completed") matCounts.completed += 1;
    else if (st === "partially_completed") matCounts.partially_completed += 1;
    else if (st === "failed") matCounts.failed += 1;
    else matCounts.pending += 1;
    byType[m.material_type] = (byType[m.material_type] ?? 0) + 1;
  }
  const facts = rows(await db.from("extracted_facts").select("*").eq("project_id", projectId).limit(1000));
  const factIds = facts.map(f => f.fact_id || String(f.id));
  let withEvidence = 0;
  if (factIds.length) {
    const evs = await softRows(db.from("evidence_items").select("fact_id").in("fact_id", factIds).limit(1000));
    withEvidence = new Set(evs.map(e => e.fact_id)).size;
  }
  const needsReview = facts.filter(f => f.extraction_status === "needs_review").length;
  const humanRevised = facts.filter(f => f.parser_source === "human").length;
  const runs = rows(await db.from("ai_runs").select("calls,total_tokens")
    .eq("project_id", projectId).eq("run_type", "material_extraction").limit(1000));
  const totalCalls = runs.reduce((s, r) => s + (r.calls || 0), 0);
  const totalTokens = runs.reduce((s, r) => s + (r.total_tokens || 0), 0);
  const tasks = await softRows(db.from("parse_tasks").select("status").eq("project_id", projectId).limit(1000));
  const taskCounts: Record<string, number> = {};
  for (const t of tasks) taskCounts[t.status] = (taskCounts[t.status] ?? 0) + 1;
  return {
    project_id: projectId,
    materials: matCounts,
    facts: { total: facts.length, with_evidence: withEvidence, needs_review: needsReview, human_revised: humanRevised },
    llm: { total_calls: totalCalls, total_tokens: totalTokens },
    tasks: taskCounts,
    by_type: byType,
  };
}

// ============================ 第四阶段：复现域 ============================

function planView(p: any): Record<string, any> {
  const summary = loads(p.feasibility_summary_json) ?? {};
  const taskCount = summary && typeof summary === "object"
    ? Object.values(summary).reduce((s: number, v: any) => s + (Number(v) || 0), 0) : 0;
  return {
    plan_id: p.id, project_id: p.project_id, title: p.title,
    status: p.status, source: p.source, ai_available: p.ai_available,
    prompt_version: p.prompt_version || "", model: p.model || "",
    feasibility_summary: summary, task_count: taskCount,
    created_at: p.created_at || "",
  };
}
function reproTaskView(t: any): Record<string, any> {
  return {
    task_id: t.id, plan_id: t.plan_id, task_key: t.task_key,
    title: t.title, description: t.description,
    depends_on: loads(t.depends_on_json) ?? [],
    required_materials: loads(t.required_materials_json) ?? [],
    action: t.action, expected_result: t.expected_result,
    acceptance_criteria: t.acceptance_criteria,
    evidence_refs: loads(t.evidence_refs_json) ?? [],
    risk: t.risk, feasibility: t.feasibility,
    feasibility_reason: t.feasibility_reason,
    needs_human_confirm: t.needs_human_confirm, status: t.status,
    created_at: t.created_at || "",
  };
}
function runView(r: any): Record<string, any> {
  return {
    run_id: r.id, plan_id: r.plan_id, project_id: r.project_id,
    status: r.status, execution_enabled: r.execution_enabled,
    security_check: loads(r.security_check_json) ?? {},
    environment_id: r.environment_id,
    task_ids: loads(r.task_ids_json) ?? [],
    started_at: r.started_at || null,
    finished_at: r.finished_at || null,
    duration_ms: r.duration_ms,
    resource_usage: { cpu_seconds: num(r.cpu_seconds), memory_mb: num(r.memory_mb) },
    error_message: r.error_message,
    created_at: r.created_at || "",
  };
}
function envView(e: any): Record<string, any> {
  return {
    environment_id: e.id, project_id: e.project_id, material_id: e.material_id || "",
    python_version: e.python_version,
    frameworks: loads(e.frameworks_json) ?? {},
    dependencies: loads(e.dependencies_json) ?? [],
    hardware_requirements: loads(e.hardware_json) ?? {},
    entrypoints: loads(e.entrypoints_json) ?? [],
    missing: loads(e.missing_json) ?? [],
    warnings: loads(e.warnings_json) ?? [],
    created_at: e.created_at || "",
  };
}
const checkProjectParam = (row: any, projectId: string | null): void => {
  if (projectId && row.project_id !== projectId) {
    throw new AppError("FORBIDDEN", "无权访问其他项目的记录。");
  }
};
async function getPlanRow(db: Db, planId: string): Promise<any> {
  const p = one(await db.from("reproduction_plans").select("*").eq("id", planId).limit(1));
  if (!p) throw new AppError("NOT_FOUND", "复现规划不存在。");
  return p;
}
async function getReproTaskRow(db: Db, taskId: string): Promise<any> {
  const t = one(await db.from("reproduction_tasks").select("*").eq("id", taskId).limit(1));
  if (!t) throw new AppError("NOT_FOUND", "复现任务不存在。");
  return t;
}
async function getRunRow(db: Db, runId: string): Promise<any> {
  const r = one(await db.from("reproduction_runs").select("*").eq("id", runId).limit(1));
  if (!r) throw new AppError("NOT_FOUND", "运行记录不存在。");
  return r;
}

async function listPlans(c: Call): Promise<Record<string, any>> {
  const { db, user, q } = c;
  const projectId = requireQuery(q, "project_id");
  await projectContext(db, projectId, user!);
  const list = rows(await db.from("reproduction_plans").select("*").eq("project_id", projectId)
    .order("created_at", { ascending: false }).limit(1000));
  const tasks = rows(await db.from("reproduction_tasks").select("*").eq("project_id", projectId)
    .order("task_key", { ascending: true }).limit(5000));
  const byPlan = new Map<string, ReturnType<typeof reproTaskView>[]>();
  for (const task of tasks) {
    const match = byPlan.get(task.plan_id) ?? [];
    match.push(reproTaskView(task));
    byPlan.set(task.plan_id, match);
  }
  const items = list.map(plan => ({ ...planView(plan), tasks: byPlan.get(plan.id) ?? [] }));
  return { items, total: items.length };
}
async function createPlan(c: Call): Promise<Record<string, any>> {
  const { db, user } = c;
  const data = bodyObj(c);
  forbidExtra(data, ["project_id", "title"]);
  const projectId = data.project_id;
  if (typeof projectId !== "string" || !projectId) {
    throw new AppError("VALIDATION_ERROR", "字段 project_id 必填且长度不超过 500。");
  }
  await projectContext(db, projectId, user!);
  // 镜像后端：无真实密钥绝不生成假规划
  throw new AppError("LLM_KEY_NOT_CONFIGURED", "AI 复现规划不可用：尚未配置真实 API Key，未生成任何规划。");
}
async function getPlan(c: Call): Promise<Record<string, any>> {
  const { db, user, params } = c;
  const plan = await getPlanRow(db, params.plan_id);
  await projectContext(db, plan.project_id, user!);
  const tasks = rows(await db.from("reproduction_tasks").select("*").eq("plan_id", plan.id)
    .order("task_key", { ascending: true }).limit(1000));
  const views = tasks.map(reproTaskView);
  const keyByTaskId = new Map(views.map(t => [t.task_id, t.task_key]));
  const edges = views.flatMap(t => t.depends_on.map((d: string) => ({ from: keyByTaskId.get(d) ?? d, to: t.task_key })));
  return {
    ...planView(plan),
    tasks: views,
    dag: {
      nodes: views.map(t => ({ id: t.task_key, label: t.title, status: t.status, feasibility: t.feasibility })),
      edges,
    },
  };
}
async function addManualTask(c: Call): Promise<Record<string, any>> {
  const { db, user, params } = c;
  const data = bodyObj(c);
  forbidExtra(data, ["title", "description", "depends_on", "required_materials", "action",
    "expected_result", "acceptance_criteria", "risk", "evidence_refs", "needs_human_confirm"]);
  if (typeof data.title !== "string") throw new AppError("VALIDATION_ERROR", "字段 title 必填且须为字符串。");
  const plan = await getPlanRow(db, params.plan_id);
  await projectContext(db, plan.project_id, user!);
  const exists = rows(await db.from("reproduction_tasks").select("*").eq("plan_id", plan.id).limit(1000));
  const taskKey = `T${String(exists.length + 1).padStart(2, "0")}`;
  if (exists.some(t => t.task_key === taskKey)) throw new AppError("VALIDATION_ERROR", "任务 key 已存在。");
  const deps = data.depends_on ?? [];
  if (!Array.isArray(deps)) throw new AppError("VALIDATION_ERROR", "depends_on 须为字符串数组。");
  const known = new Set(exists.map(t => t.task_key));
  if (deps.some((d: string) => !known.has(d))) throw new AppError("DAG_INVALID", "任务依赖了不存在的任务。");
  const arr = (v: any, name: string): any[] => {
    if (v === null || v === undefined) return [];
    if (!Array.isArray(v)) throw new AppError("VALIDATION_ERROR", `${name} 须为字符串数组。`);
    return v;
  };
  const row = {
    id: newId("rtask"), plan_id: plan.id, project_id: plan.project_id, task_key: taskKey,
    title: data.title, description: data.description ?? "",
    depends_on_json: dumps(deps),
    required_materials_json: dumps(arr(data.required_materials, "required_materials")),
    action: data.action ?? "", expected_result: data.expected_result ?? "",
    acceptance_criteria: data.acceptance_criteria ?? "",
    evidence_refs_json: dumps(arr(data.evidence_refs, "evidence_refs")),
    risk: data.risk ?? "", feasibility: "needs_human_review",
    feasibility_reason: "人工新增任务，需确认",
    needs_human_confirm: data.needs_human_confirm ?? true,
    status: "pending",
    created_at: nowIso(),
  };
  rows(await db.from("reproduction_tasks").insert(row).select("*"));
  return reproTaskView(row);
}
async function getReproTask(c: Call): Promise<Record<string, any>> {
  const { db, user, params } = c;
  const t = await getReproTaskRow(db, params.task_id);
  await projectContext(db, t.project_id, user!);
  return reproTaskView(t);
}
async function confirmReproTask(c: Call): Promise<Record<string, any>> {
  const { db, user, params } = c;
  const t = await getReproTaskRow(db, params.task_id);
  await projectContext(db, t.project_id, user!);
  rows(await db.from("reproduction_tasks").update({ status: "confirmed" }).eq("id", t.id).select("*"));
  return { confirmed: true, status: "confirmed" };
}

async function createRun(c: Call): Promise<Record<string, any>> {
  const { db, user } = c;
  const data = bodyObj(c);
  forbidExtra(data, ["plan_id", "task_ids", "requested_by"]);
  const plan = await getPlanRow(db, data.plan_id);
  await projectContext(db, plan.project_id, user!);
  throw new AppError("DEMO_LIMIT", "演示站点未部署沙箱执行运行时，无法发起真实复现运行。", null, 501);
}
async function listRuns(c: Call): Promise<Record<string, any>> {
  const { db, user, q } = c;
  const projectId = requireQuery(q, "project_id");
  await projectContext(db, projectId, user!);
  const list = rows(await db.from("reproduction_runs").select("*").eq("project_id", projectId)
    .order("created_at", { ascending: false }).limit(1000));
  const items = list.map(runView);
  return { items, total: items.length };
}
async function getRun(c: Call): Promise<Record<string, any>> {
  const { db, user, params, q } = c;
  const r = await getRunRow(db, params.run_id);
  await projectContext(db, r.project_id, user!);
  checkProjectParam(r, q.get("project_id"));
  return runView(r);
}
async function cancelRun(c: Call): Promise<Record<string, any>> {
  const { db, user, params } = c;
  const r = await getRunRow(db, params.run_id);
  await projectContext(db, r.project_id, user!);
  if (["completed", "failed", "cancelled", "blocked_no_sandbox", "blocked_security"].includes(r.status)) {
    return { cancelled: false, status: r.status, reason: "任务未在运行中或已终态" };
  }
  rows(await db.from("reproduction_runs").update({
    cancel_requested: true, status: "cancelled", finished_at: nowIso(),
  }).eq("id", r.id).select("*"));
  return { cancelled: true, status: "cancelled", note: "已记录取消；无执行进程需要终止" };
}
// 运行附属资源：先按运行归属做项目隔离（运行不存在时镜像后端返回空集合）
async function runScoped(c: Call): Promise<any | null> {
  const { db, user, params, q } = c;
  const r = one(await db.from("reproduction_runs").select("*").eq("id", params.run_id).limit(1));
  if (!r) return null;
  await projectContext(db, r.project_id, user!);
  checkProjectParam(r, q.get("project_id"));
  return r;
}
async function runLogs(c: Call): Promise<Record<string, any>> {
  const { db, params } = c;
  await runScoped(c);
  const list = rows(await db.from("execution_logs").select("*").eq("run_id", params.run_id)
    .order("created_at", { ascending: true }).limit(1000));
  const items = list.map(r => ({ log_id: r.log_id, stream: r.stream, content: r.content, created_at: r.created_at || "" }));
  return { items, total: items.length };
}
async function runArtifacts(c: Call): Promise<Record<string, any>> {
  const { db, params } = c;
  await runScoped(c);
  const list = rows(await db.from("execution_artifacts").select("*").eq("run_id", params.run_id).limit(1000));
  const items = list.map(r => ({
    artifact_id: r.artifact_id, name: r.name, path: r.path,
    size_bytes: r.size_bytes, hash: r.hash, created_at: r.created_at || "",
  }));
  return { items, total: items.length };
}
async function runMetrics(c: Call): Promise<Record<string, any>> {
  const { db, params } = c;
  await runScoped(c);
  const list = rows(await db.from("reproduction_metrics").select("*").eq("run_id", params.run_id).limit(1000));
  const items = list.map(r => ({
    metric_name: r.metric_name, metric_value: num(r.metric_value), unit: r.unit,
    source: r.source, extraction_method: r.extraction_method,
    run_id: r.run_id, confidence: num(r.confidence),
    needs_manual_review: r.needs_manual_review, created_at: r.created_at || "",
  }));
  return { items, total: items.length };
}
async function projectMetrics(c: Call): Promise<Record<string, any>> {
  const { db, user, q } = c;
  const projectId = requireQuery(q, "project_id");
  await projectContext(db, projectId, user!);
  const list = rows(await db.from("reproduction_metrics").select("*").eq("project_id", projectId).limit(1000));
  const items = list.map(r => ({
    metric_name: r.metric_name, metric_value: num(r.metric_value),
    unit: r.unit, source: r.source, run_id: r.run_id,
  }));
  return { items, total: items.length };
}
async function listEnvironments(c: Call): Promise<Record<string, any>> {
  const { db, user, q } = c;
  const projectId = requireQuery(q, "project_id");
  await projectContext(db, projectId, user!);
  const list = rows(await db.from("execution_environments").select("*").eq("project_id", projectId)
    .order("created_at", { ascending: false }).limit(1000));
  const items = list.map(envView);
  return { items, total: items.length };
}
async function listComparisons(c: Call): Promise<Record<string, any>> {
  const { db, user, q } = c;
  const projectId = requireQuery(q, "project_id");
  await projectContext(db, projectId, user!);
  const list = rows(await db.from("metric_comparisons").select("*").eq("project_id", projectId)
    .order("created_at", { ascending: false }).limit(1000));
  const items = list.map(r => ({
    comparison_id: r.id, metric_name: r.metric_name,
    paper_value: num(r.paper_value), reproduced_value: num(r.reproduced_value),
    unit: r.unit, diff_absolute: num(r.diff_absolute), diff_relative: num(r.diff_relative),
    verdict: r.verdict, rule: r.rule, tolerance_basis: r.tolerance_basis,
    conditions_check: loads(r.conditions_json) ?? {},
    created_at: r.created_at || "",
  }));
  return { items, total: items.length };
}

// ---- QualityEvaluator（七维度，纯 DB 聚合） ----
const QUALITY_DIMENSIONS: [string, string, number][] = [
  ["material_completeness", "材料完整性", 0.15],
  ["environment_consistency", "环境一致性", 0.15],
  ["parameter_consistency", "参数一致性", 0.15],
  ["code_executability", "代码可执行性", 0.15],
  ["run_success", "运行成功情况", 0.15],
  ["result_comparability", "结果可比性", 0.15],
  ["evidence_completeness", "证据完整性", 0.10],
];
const QUALITY_SCOPE_NOTE = "本评分仅表示 ReproCheck 平台定义的复现验证覆盖程度，"
  + "不代表学术质量、论文真实性或研究结论正确性的权威判定。";
const ratioScore = (n: number, d: number): number => (d ? round4(n / d) : 0);
function qualityBasis(key: string, facts: any[], evidenceCount: number, runs: any[]): string {
  if (key === "material_completeness") return `基于已抽取事实数 ${facts.length}（目标 20 条）线性计算`;
  if (key === "evidence_completeness") return `基于证据条目数 ${evidenceCount}（目标 20 条）线性计算`;
  if (key === "code_executability") return "当前环境无安全隔离执行后端，仅静态分析，按 0.3 计入";
  if (key === "run_success") return `基于运行记录 ${runs.length} 条中 completed 状态占比`;
  return "基于对应维度存在性/一致性的程序化规则计算";
}
function qualityMissing(key: string, envMissing: string[], runs: any[]): string[] {
  if (key === "environment_consistency") return [...envMissing];
  if (key === "run_success" && !runs.length) return ["无运行记录"];
  return [];
}
function evaluateReproQuality(facts: any[], evidenceCount: number, runs: any[],
  comparisons: any[], envMissing: string[]): Record<string, any> {
  const materialScore = ratioScore(Math.min(facts.length, 20), 20);
  const envScore = ratioScore(envMissing.length ? Math.max(0, 3 - envMissing.length) : 1, 3);
  const paramGroups = new Map<string, Set<string>>();
  for (const fact of facts) {
    if (fact.fact_type === "training_parameter") {
      if (!paramGroups.has(fact.field_key)) paramGroups.set(fact.field_key, new Set());
      paramGroups.get(fact.field_key)!.add(String(fact.normalized_value || fact.raw_value));
    }
  }
  const single = [...paramGroups.values()].filter(v => v.size === 1).length;
  const paramScore = ratioScore(single, Math.max(paramGroups.size, 1));
  const executable = runs.some(r => r.execution_enabled);
  const codeScore = executable ? 0.3 : 0;
  const runScore = ratioScore(runs.filter(r => r.status === "completed").length, Math.max(runs.length, 1));
  const comparable = comparisons.filter(x => !["insufficient_data", "not_comparable"].includes(x.verdict)).length;
  const compareScore = ratioScore(comparable, Math.max(comparisons.length, 1));
  const evidenceScore = ratioScore(Math.min(evidenceCount, 20), 20);
  const raw: Record<string, number> = {
    material_completeness: materialScore,
    environment_consistency: envScore,
    parameter_consistency: paramScore,
    code_executability: codeScore,
    run_success: runScore,
    result_comparability: compareScore,
    evidence_completeness: evidenceScore,
  };
  const dimensions = QUALITY_DIMENSIONS.map(([key, label, weight]) => ({
    key, label, score: raw[key], max: 1.0, weight,
    basis: qualityBasis(key, facts, evidenceCount, runs),
    missing: qualityMissing(key, envMissing, runs),
  }));
  const overall = round4(QUALITY_DIMENSIONS.reduce((s, [k, , w]) => s + raw[k] * w, 0));
  return {
    dimensions,
    formula: "overall = Σ (dimension.score × dimension.weight)，权重和=1.0",
    overall, scope_note: QUALITY_SCOPE_NOTE,
  };
}
async function getQuality(c: Call): Promise<Record<string, any>> {
  const { db, user, q } = c;
  const projectId = requireQuery(q, "project_id");
  await projectContext(db, projectId, user!);
  const facts = rows(await db.from("extracted_facts").select("*").eq("project_id", projectId).limit(1000));
  const evidenceCount = (await softRows(db.from("evidence_items").select("id").eq("project_id", projectId).limit(1000))).length;
  const runs = rows(await db.from("reproduction_runs").select("*").eq("project_id", projectId).limit(1000));
  const comparisons = rows(await db.from("metric_comparisons").select("*").eq("project_id", projectId).limit(1000));
  const envs = rows(await db.from("execution_environments").select("*").eq("project_id", projectId).limit(1000));
  const envMissing: string[] = envs.flatMap(e => loads(e.missing_json) ?? []);
  return evaluateReproQuality(
    facts, evidenceCount,
    runs.map(r => ({ status: r.status, execution_enabled: r.execution_enabled })),
    comparisons.map(x => ({ verdict: x.verdict })),
    envMissing,
  );
}

async function createDiagnostic(c: Call): Promise<Record<string, any>> {
  const { db, user } = c;
  const data = bodyObj(c);
  forbidExtra(data, ["run_id", "project_id", "problem"]);
  if (typeof data.project_id !== "string" || !data.project_id) {
    throw new AppError("VALIDATION_ERROR", "字段 project_id 必填且长度不超过 500。");
  }
  await projectContext(db, data.project_id, user!);
  throw new AppError("LLM_KEY_NOT_CONFIGURED", "AI 诊断不可用：尚未配置真实 API Key，未生成任何诊断结论。");
}
async function reviewRemediation(c: Call): Promise<Record<string, any>> {
  const { db, user, params } = c;
  const data = bodyObj(c);
  forbidExtra(data, ["decision", "reviewer", "note", "modified_value"]);
  const decision = data.decision;
  if (!["approve", "reject", "modify"].includes(decision)) {
    throw new AppError("VALIDATION_ERROR", "审核决定必须是 approve/reject/modify。");
  }
  const proposal = one(await db.from("remediation_proposals").select("*").eq("id", params.proposal_id).limit(1));
  if (!proposal) throw new AppError("NOT_FOUND", "修复建议不存在。");
  const { role } = await projectContext(db, proposal.project_id, user!);
  await requirePermission(db, role, "review.decide");
  let note = String(data.note ?? "");
  if (proposal.changes_research_conditions && decision === "approve") {
    note = (note + "；注意：该修改可能改变原始研究条件，不能称为严格复现").replace(/^；+/, "").replace(/；+$/, "");
  }
  const review = {
    id: id14("rev"), proposal_id: params.proposal_id,
    decision, reviewer: user!.display_name || user!.email, reviewer_user_id: user!.id, note,
    modified_value: data.modified_value ?? null, original_preserved: true,
    created_at: nowIso(),
  };
  rows(await db.from("remediation_reviews").insert(review).select("*"));
  const statusMap: Record<string, string> = { approve: "approved", reject: "rejected", modify: "modified" };
  rows(await db.from("remediation_proposals").update({ status: statusMap[decision] })
    .eq("id", proposal.id).select("*"));
  return {
    review_id: review.id, proposal_id: review.proposal_id, decision: review.decision,
    reviewer: review.reviewer, note: review.note, modified_value: review.modified_value,
    original_preserved: review.original_preserved,
    created_at: review.created_at,
  };
}

// ---- ReportGenerator（14 章，纯 DB/模板；站点不产出 PDF） ----
const CHAPTERS = [
  "项目基本信息", "论文与科研材料清单", "复现目标和实验范围", "反向复现任务规划",
  "复现环境与依赖信息", "代码安全检查结果", "任务执行记录", "实验运行结果",
  "论文结果与复现结果对照", "复现差异与失败原因", "证据链与来源定位",
  "问题修复建议", "人工复核记录", "最终复现结论与限制说明",
];
function renderReportHtml(title: string, sections: any[], quality: Record<string, any>): string {
  const parts = [
    "<!DOCTYPE html><html lang='zh-CN'><head><meta charset='utf-8'>",
    "<title>ReproCheck 复现审计报告</title>",
    "<style>body{font-family:'Segoe UI','Microsoft YaHei',sans-serif;max-width:900px;margin:40px auto;color:#12294a;line-height:1.7}"
    + "h1{border-bottom:3px solid #0b1f3a;padding-bottom:12px}h2{margin-top:36px;color:#0b1f3a;font-size:18px}"
    + ".origin{color:#2e6bff;font-size:12px}.sources{color:#64748b;font-size:12px;margin:8px 0}"
    + ".scope{background:#eef4ff;border-left:4px solid #2e6bff;padding:12px;margin-top:32px}"
    + "table{border-collapse:collapse;width:100%}td,th{border:1px solid #cbd5e1;padding:6px;font-size:13px}</style>",
    "</head><body>",
    `<h1>ReproCheck 科研复现审计报告</h1><p>${htmlEscape(title)}</p>`,
  ];
  for (const s of sections) {
    parts.push(`<h2>第${s.index}章　${htmlEscape(s.chapter)}</h2>`);
    parts.push(`<p>${htmlEscape(s.content)}</p>`);
    parts.push(`<p class='origin'>来源类型：${htmlEscape(s.origin)}</p>`);
    if (s.sources.length) {
      parts.push("<p class='sources'>证据引用：" + htmlEscape(s.sources.slice(0, 10).join("；")) + "</p>");
    }
  }
  parts.push(`<div class='scope'><b>范围声明</b><br>${htmlEscape(quality.scope_note)}<br>`
    + `复现验证覆盖度：${pyFloat(quality.overall)}</div>`);
  parts.push("</body></html>");
  return parts.join("");
}
async function generateReport(db: Db, projectId: string, project: any): Promise<any> {
  const plans = rows(await db.from("reproduction_plans").select("*").eq("project_id", projectId).limit(1000));
  const tasks = rows(await db.from("reproduction_tasks").select("*").eq("project_id", projectId).limit(1000));
  const runs = rows(await db.from("reproduction_runs").select("*").eq("project_id", projectId).limit(1000));
  const envs = rows(await db.from("execution_environments").select("*").eq("project_id", projectId).limit(1000));
  const comps = rows(await db.from("metric_comparisons").select("*").eq("project_id", projectId).limit(1000));
  const facts = rows(await db.from("extracted_facts").select("*").eq("project_id", projectId).limit(100));
  const diags = rows(await db.from("failure_diagnostics").select("*").eq("project_id", projectId).limit(1000));
  const proposals = rows(await db.from("remediation_proposals").select("*").eq("project_id", projectId).limit(1000));
  const reviews = proposals.length
    ? rows(await db.from("remediation_reviews").select("*").in("proposal_id", proposals.map(p => p.id)).limit(1000))
    : rows(await db.from("remediation_reviews").select("*").eq("id", "__none__").limit(1000));
  const quality = evaluateReproQuality(
    facts, facts.length,
    runs.map(r => ({ status: r.status, execution_enabled: r.execution_enabled })),
    comps.map(x => ({ verdict: x.verdict })),
    envs.flatMap(e => loads(e.missing_json) ?? []),
  );
  const sec: any[] = [];
  const add = (idx: number, content: string, sources: string[], origin = "程序自动检测") => {
    sec.push({ index: idx + 1, chapter: CHAPTERS[idx], content, sources, origin, created_at: nowIso() });
  };
  add(0, `项目名称：${project.name}；研究领域：${project.domain || "未记录"}；`
    + `论文标题：${project.paper_title || "未记录"}。报告生成时间：${nowIso()}。`,
    [`projects:${project.id}`], "数据库记录");
  add(1, `已抽取科研事实 ${facts.length} 条；关联材料 ${new Set(facts.map(x => x.material_id)).size} 份。`,
    facts.slice(0, 8).map(x => `extracted_facts:${x.fact_id || x.id}`));
  add(2, "复现目标：依据已解析材料建立可执行的复现规划；范围仅限平台已记录的材料与事实，"
    + "未记录内容一律标注 materials_not_found，不推断研究未实施。",
    [`projects:${project.id}`], "范围声明");
  add(3, `复现规划 ${plans.length} 份，任务 ${tasks.length} 项。`
    + tasks.slice(0, 10).map(t => `${t.task_key} ${t.title}（${t.feasibility}）`).join("；"),
    tasks.slice(0, 8).map(t => `reproduction_tasks:${t.id}`),
    plans.some(p => p.ai_available) ? "AI 分析 + 程序可行性校验" : "程序校验");
  add(4, `环境记录 ${envs.length} 份；缺失项：`
    + (envs.flatMap(e => loads(e.missing_json) ?? []).join("；") || "无"),
    envs.slice(0, 8).map(e => `execution_environments:${e.id}`));
  add(5, "代码安全预检结果见各运行记录 security_check 字段；所有执行默认禁用，"
    + "安全阻断由程序规则决定。静态扫描不能保证绝对安全。",
    runs.slice(0, 8).map(r => `reproduction_runs:${r.id}`), "程序安全规则");
  add(6, `运行记录 ${runs.length} 条：`
    + runs.slice(0, 10).map(r => `${r.id} 状态=${r.status} 执行启用=${pyStr(r.execution_enabled)}`).join("；"),
    runs.slice(0, 8).map(r => `reproduction_runs:${r.id}`), "实际运行记录");
  add(7, "实验运行结果来自 reproduction_metrics 表（若为空表示未产生可提取指标）。", [], "实际执行结果");
  add(8, "指标对照："
    + (comps.slice(0, 10).map(x => `${x.metric_name} 论文=${pyFloat(num(x.paper_value))} 复现=${pyFloat(num(x.reproduced_value))} `
      + `判定=${x.verdict}`).join("；") || "暂无对照记录"),
    comps.slice(0, 8).map(x => `metric_comparisons:${x.id}`), "程序对照规则");
  add(9, "差异与失败原因："
    + (diags.slice(0, 6).map(d => String(d.problem).slice(0, 80)).join("；") || "暂无诊断记录"),
    diags.slice(0, 6).map(d => `failure_diagnostics:${d.id}`),
    diags.some(d => d.ai_available) ? "AI 诊断" : "无 AI 诊断");
  add(10, "证据链：每条科研事实关联 extracted_facts.chunk_id 与 evidence_items；"
    + "原文来自后端材料，不采用模型生成引用文本。",
    facts.slice(0, 10).map(x => `extracted_facts:${x.fact_id || x.id}`), "证据库");
  add(11, "修复建议："
    + (proposals.slice(0, 8).map(p => `${p.change_type}: ${String(p.proposed_value || "").slice(0, 60)}`).join("；")
      || "暂无修复建议") + "。默认不修改用户原始文件。",
    proposals.slice(0, 8).map(p => `remediation_proposals:${p.id}`), "AI 建议 + 人工审核");
  add(12, "人工复核记录："
    + (reviews.slice(0, 8).map(r => `${r.decision} by ${r.reviewer}`).join("；") || "暂无人工复核"),
    reviews.slice(0, 8).map(r => `remediation_reviews:${r.id}`), "用户人工判断");
  add(13, `复现验证覆盖度评分：${pyFloat(quality.overall)}（0-1）。${quality.scope_note} `
    + `公式：${quality.formula}。当前环境无安全隔离执行后端，代码执行未启用；`
    + "本报告不构成学术质量或论文真实性判定。",
    [], "综合声明");

  const htmlText = renderReportHtml(project.name, sec, quality);
  const report = {
    id: id14("rreport"), project_id: projectId,
    title: `ReproCheck 复现审计报告 - ${project.name}`,
    status: "generated", version: 1,
    sections_json: dumps(sec),
    html: htmlText, pdf_path: null,
    scope_note: quality.scope_note,
    created_at: nowIso(),
  };
  rows(await db.from("reproduction_reports").insert(report).select("*"));
  return report;
}
async function createReport(c: Call): Promise<Record<string, any>> {
  const { db, user } = c;
  const data = bodyObj(c);
  forbidExtra(data, ["project_id", "plan_id", "run_ids"]);
  if (typeof data.project_id !== "string" || !data.project_id) {
    throw new AppError("VALIDATION_ERROR", "字段 project_id 必填且长度不超过 500。");
  }
  const { project } = await projectContext(db, data.project_id, user!);
  const report = await generateReport(db, project.id, project);
  return {
    report_id: report.id, status: report.status,
    section_count: (loads(report.sections_json) ?? []).length,
    html_available: !!report.html,
    pdf_available: !!report.pdf_path,
  };
}
async function listReports(c: Call): Promise<Record<string, any>> {
  const { db, user, q } = c;
  const projectId = requireQuery(q, "project_id");
  await projectContext(db, projectId, user!);
  const list = rows(await db.from("reproduction_reports").select("*").eq("project_id", projectId)
    .order("created_at", { ascending: false }).limit(1000));
  const items = list.map(r => ({
    report_id: r.id, project_id: r.project_id, title: r.title,
    status: r.status, version: r.version,
    section_count: (loads(r.sections_json) ?? []).length,
    html_available: !!r.html, pdf_available: !!r.pdf_path,
    scope_note: r.scope_note,
    created_at: r.created_at || "",
  }));
  return { items, total: items.length };
}
async function getReportRow(db: Db, reportId: string): Promise<any> {
  const r = one(await db.from("reproduction_reports").select("*").eq("id", reportId).limit(1));
  if (!r) throw new AppError("NOT_FOUND", "复现报告不存在。");
  return r;
}
async function getReport(c: Call): Promise<Record<string, any>> {
  const { db, user, params } = c;
  const r = await getReportRow(db, params.report_id);
  await projectContext(db, r.project_id, user!);
  return {
    report_id: r.id, project_id: r.project_id, title: r.title,
    status: r.status, version: r.version,
    sections: loads(r.sections_json) ?? [],
    html_available: !!r.html, pdf_available: !!r.pdf_path,
    scope_note: r.scope_note,
    created_at: r.created_at || "",
  };
}
async function reportHtml(c: Call): Promise<Response> {
  const { db, params } = c;
  const r = one(await db.from("reproduction_reports").select("*").eq("id", params.report_id).limit(1));
  if (!r || !r.html) throw new AppError("NOT_FOUND", "报告 HTML 不存在。");
  return new Response(r.html, { headers: { "content-type": "text/html; charset=utf-8" } });
}
async function reportPdf(c: Call): Promise<Response> {
  const { db, params } = c;
  const r = await getReportRow(db, params.report_id);
  if (!r.pdf_path) throw new AppError("PDF_UNAVAILABLE", "当前环境不支持 PDF 导出，请使用 HTML 导出。");
  throw new AppError("DEMO_LIMIT", "演示站点未存储 PDF 文件，无法下载。", null, 501);
}

// ============================ 路由注册 ============================

export function register(router: Router, _deps: Deps): void {
  const P = "/api/v1";

  // ---- 基准案例（第六阶段 B 组） ----
  router.post(`${P}/cases`, createCase);
  router.get(`${P}/cases`, listCases);
  router.post(`${P}/cases/search`, searchCases);
  router.get(`${P}/cases/:case_id`, getCase);
  router.post(`${P}/cases/:case_id/facts`, addCaseFact);
  router.get(`${P}/cases/:case_id/facts`, listCaseFacts);
  router.post(`${P}/cases/:case_id/verifications`, addVerification);
  router.get(`${P}/cases/:case_id/verifications`, listVerifications);
  router.post(`${P}/cases/:case_id/quality/recompute`, recomputeQuality);
  router.get(`${P}/fact-schema`, async () => factSchemaView());

  // ---- 遗留事实 ----
  router.get(`${P}/facts`, listFacts);
  router.patch(`${P}/facts/:fact_id`, patchFact);
  router.get(`${P}/facts/:fact_id/revisions`, factRevisions);
  router.get(`${P}/facts/summary`, factsSummary);

  // ---- 材料 / 解析任务 / 概览 ----
  router.get(`${P}/materials`, listMaterials);
  router.get(`${P}/materials/:material_id`, getMaterial);
  router.get(`${P}/materials/:material_id/download`, downloadMaterial, { auth: false });
  router.delete(`${P}/materials/:material_id`, deleteMaterial);
  router.post(`${P}/materials/upload`, async () => {
    throw new AppError("DEMO_LIMIT", "演示站点未部署文件存储与解析流水线，无法上传材料。", null, 501);
  });
  router.post(`${P}/materials/:material_id/parse`, async (c) => {
    const m = await getMaterialRow(c.db, c.params.material_id);
    await projectContext(c.db, m.project_id, c.user!);
    throw new AppError("DEMO_LIMIT", "演示站点未部署材料解析与 AI 抽取运行时，无法启动解析。", null, 501);
  });
  router.get(`${P}/parse-tasks`, listParseTasks);
  router.get(`${P}/parse-tasks/:task_id`, getParseTask);
  router.post(`${P}/parse-tasks/:task_id/retry`, async (c) => {
    const t = await getParseTaskRow(c.db, c.params.task_id);
    await projectContext(c.db, t.project_id, c.user!);
    throw new AppError("DEMO_LIMIT", "演示站点未部署解析运行时，无法重试解析任务。", null, 501);
  });
  router.delete(`${P}/parse-tasks/:task_id`, cancelParseTask);
  router.get(`${P}/projects/:project_id/parse-overview`, parseOverview);

  // ---- 演示审计 / LLM ----
  router.post(`${P}/demo/audit`, async () => {
    throw new AppError("DEMO_LIMIT", "演示站点未配置真实模型密钥，无法执行 AI 审计。", null, 501);
  });
  router.get(`${P}/audit-runs/:run_id`, async (c) => {
    const row = one(await c.db.from("ai_runs").select("*").eq("id", c.params.run_id).limit(1));
    if (!row || !row.result_json) throw new AppError("NOT_FOUND", `未找到审计运行 ${c.params.run_id}。`);
    return loads(row.result_json);
  }, { auth: false });
  router.get(`${P}/llm/status`, async () => ({
    provider: "qwen", model: "qwen-plus", api_key_configured: false,
    connection_status: "unknown", last_call_at: null, last_call_duration_ms: null,
    last_call_success: null, last_token_usage: null,
  }), { auth: false });
  router.post(`${P}/llm/test`, async () => {
    throw new AppError("DEMO_LIMIT", "演示站点未配置真实模型密钥，无法测试模型连接。", null, 501);
  });

  // ---- 第四阶段：复现规划 / 任务 ----
  router.post(`${P}/reproductions/plans`, createPlan);
  router.get(`${P}/reproductions/plans`, listPlans);
  router.get(`${P}/reproductions/plans/:plan_id`, getPlan);
  router.post(`${P}/reproductions/plans/:plan_id/tasks`, addManualTask);
  router.get(`${P}/reproductions/tasks/:task_id`, getReproTask);
  router.post(`${P}/reproductions/tasks/:task_id/confirm`, confirmReproTask);

  // ---- 运行 / 环境 / 指标 ----
  router.post(`${P}/reproductions/runs`, createRun);
  router.get(`${P}/reproductions/runs`, listRuns);
  router.get(`${P}/reproductions/runs/:run_id`, getRun);
  router.post(`${P}/reproductions/runs/:run_id/cancel`, cancelRun);
  router.get(`${P}/reproductions/runs/:run_id/logs`, runLogs);
  router.get(`${P}/reproductions/runs/:run_id/artifacts`, runArtifacts);
  router.get(`${P}/reproductions/runs/:run_id/metrics`, runMetrics);
  router.get(`${P}/reproduction_metrics/project`, projectMetrics);
  router.get(`${P}/reproductions/environments`, listEnvironments);
  router.get(`${P}/reproductions/metric-comparisons`, listComparisons);
  router.get(`${P}/reproductions/quality`, getQuality);

  // ---- 诊断 / 修复审核 ----
  router.post(`${P}/reproductions/diagnostics`, createDiagnostic);
  router.post(`${P}/reproductions/remediations/:proposal_id/review`, reviewRemediation);

  // ---- 报告 ----
  router.post(`${P}/reproductions/reports`, createReport);
  router.get(`${P}/reproductions/reports`, listReports);
  router.get(`${P}/reproductions/reports/:report_id`, getReport);
  router.get(`${P}/reproductions/reports/:report_id/html`, reportHtml, { auth: false });
  router.get(`${P}/reproductions/reports/:report_id/pdf`, reportPdf, { auth: false });
}
