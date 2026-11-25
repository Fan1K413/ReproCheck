import { useState, type ReactNode } from 'react'

export type GlossaryEntry = {
  term: string
  plain: string
  detail: string
  alias?: string[]
}

/**
 * 面向第一次使用科研软件的人，而不是面向开发者。
 * 术语尽量保留原文（便于在论文/服务商页面里对照），解释用任务语言。
 */
export const GLOSSARY: GlossaryEntry[] = [
  {
    term: '科研复现',
    plain: '照着论文再做一遍实验，看看结论能不能站得住。',
    detail: '不是把论文复述一遍，而是把论文里的数据、代码、实验环境和结果逐项对齐，记录哪些能重现、哪些不能、为什么。',
    alias: ['复现', '可复现性', 'reproducibility'],
  },
  {
    term: '论文',
    plain: '你要核对的那篇研究报告。',
    detail: '通常上传 PDF。ReproCheck 会保存原文，并尝试提取标题、方法、数据与结果等信息；提取结果需要你复核。',
    alias: ['Paper', '文献'],
  },
  {
    term: '数据集',
    plain: '论文实验所用的原始数据或表格。',
    detail: '例如 CSV、Excel 数据文件。数据集是判断结果能否复现的重要证据；没有数据时可以先跳过，之后再补。',
    alias: ['Dataset', '数据'],
  },
  {
    term: '代码仓库',
    plain: '作者存放实验代码的网页地址。',
    detail: '例如 GitHub、GitLab 或 Gitee 的项目链接。ReproCheck 只登记地址和版本信息，不会自动下载或运行仓库里的代码。',
    alias: ['Repository', 'Repo', '代码库'],
  },
  {
    term: '实验环境',
    plain: '跑实验时电脑里的软件和版本组合。',
    detail: '包括 Python 版本、依赖包、显卡/系统等。环境不同，结果可能不同，所以要记录并检查缺失项。',
    alias: ['Environment', '运行环境'],
  },
  {
    term: '软件依赖',
    plain: '实验运行前必须安装的软件包。',
    detail: '例如 requirements.txt 里列出的包。缺少依赖时实验可能直接失败，或算出不同结果。',
    alias: ['Dependency', '依赖包'],
  },
  {
    term: 'API',
    plain: '让两个软件互相通信的接口。',
    detail: 'ReproCheck 用 API 连接外部 AI 服务，辅助整理论文、抽取信息和生成说明。它不是验证论文真实性的替代品，也不影响你保存和整理本地材料。',
    alias: ['接口', '应用程序接口'],
  },
  {
    term: 'API 密钥',
    plain: '服务商发给你的一串访问凭证。',
    detail: '类似一把只给你用的钥匙。它用于授权 ReproCheck 调用你选择的 AI 服务；不要把密钥发给别人，也不要写进论文或代码仓库。',
    alias: ['API Key', '密钥', 'Key'],
  },
  {
    term: '模型',
    plain: '实际帮你阅读和整理内容的 AI 程序。',
    detail: '不同模型在速度、费用、中文能力和可处理长度上不同。你需要在服务商处开通，并在测试连接成功后才能使用。',
    alias: ['Model', '大模型'],
  },
  {
    term: '服务地址',
    plain: 'AI 服务所在的网址。',
    detail: '高级设置。一般选择服务商后系统会自动填好，只有自建服务或代理服务才需要修改。',
    alias: ['Base URL', 'Endpoint', '接口地址', '端点'],
  },
  {
    term: '模型名称',
    plain: '你要调用的那个 AI 模型的名字。',
    detail: '不同服务商的名字不同。通常从服务商控制台或文档复制；填错时测试连接会提示“找不到模型”。',
    alias: ['Model ID', '模型 ID'],
  },
  {
    term: '温度参数',
    plain: '控制 AI 回答“稳定”还是“发散”的旋钮。',
    detail: '高级设置。越低越稳定、越可重复；越高越发散。科研材料整理建议保持默认的低值。',
    alias: ['Temperature'],
  },
  {
    term: '最大输出长度',
    plain: '一次最多允许 AI 写多长。',
    detail: '高级设置。太小会截断内容，太大可能增加费用；不确定时保留默认值。',
    alias: ['Max Tokens', '输出上限'],
  },
  {
    term: '请求超时',
    plain: '等待服务商多久还没回应就算失败。',
    detail: '高级设置。网络慢时可适当增大；设置过长会让失败反馈来得更晚。',
    alias: ['Timeout'],
  },
  {
    term: '证据',
    plain: '能指回论文原文的依据。',
    detail: '每条科研事实都应能定位到具体材料、页码或段落。没有证据的说法只能标为“待复核”或“证据不足”。',
    alias: ['Evidence', '原文依据'],
  },
  {
    term: '科研事实',
    plain: '从论文中抽出的一条可核对信息。',
    detail: '例如数据集名称、模型结构、实验指标。它不是 AI 的自由发挥，应该附带原文位置并允许人工修订。',
    alias: ['Fact', '事实'],
  },
  {
    term: '证据图谱',
    plain: '把事实、原文和它们之间的关系连起来看。',
    detail: '用于检查一条结论是否有足够依据，以及不同材料之间是否矛盾。',
    alias: ['Evidence Graph'],
  },
  {
    term: '复现规划',
    plain: '把复现拆成可执行的步骤清单。',
    detail: '每个任务写明要做什么、依赖什么、是否需要人工确认。它不会自动替你运行代码，执行前仍需检查环境和权限。',
    alias: ['Plan', 'DAG', '规划'],
  },
  {
    term: '复现运行',
    plain: '真正执行一次复现任务。',
    detail: '运行可能成功、失败或被安全策略阻止。执行记录会保留时间、输出和错误，便于回看。',
    alias: ['Run', '执行'],
  },
  {
    term: '结果对照',
    plain: '把论文报告的结果和你的复现结果放在一起比较。',
    detail: '关注指标、误差和差异原因。对照不等于自动判定谁对谁错，需要结合证据判断。',
    alias: ['Comparison', '结果比较'],
  },
  {
    term: '审计报告',
    plain: '把这次复现的过程、证据和结论整理成一份可交付文档。',
    detail: '报告会汇总材料、事实、运行与对照结果。它可以导出，但不应把“未验证”写成“已证实”。',
    alias: ['Report', '复现报告'],
  },
  {
    term: '操作与审计记录',
    plain: '谁在什么时候做了什么。',
    detail: '用于团队复核和追溯，不会因为页面刷新而丢失。普通使用者通常只需要查看，不需要修改。',
    alias: ['Audit Trail', '审计轨迹'],
  },
  {
    term: '数据来源记录',
    plain: '这份材料从哪里来、经过了哪些处理。',
    detail: '包括上传文件、原文位置、抽取方式和修改记录。它帮助别人判断证据是否可靠。',
    alias: ['Provenance', '溯源'],
  },
  {
    term: '对照测试',
    plain: '用一组已知答案的案例来检查系统是否可靠。',
    detail: '基准案例库中的案例是测试材料，不代表你自己的科研结论。',
    alias: ['Benchmark', '基准'],
  },
]

const GLOSSARY_MAP = new Map<string, GlossaryEntry>(
  GLOSSARY.flatMap((entry) => [entry.term, ...(entry.alias ?? [])].map((name) => [name.toLowerCase(), entry])),
)

export function lookupTerm(name: string): GlossaryEntry | undefined {
  return GLOSSARY_MAP.get(name.trim().toLowerCase())
}

/** 保留原文，悬停或聚焦即可看解释；键盘用户也能读到。 */
export function Term({ name, children }: { name: string; children?: ReactNode }) {
  const [open, setOpen] = useState(false)
  const entry = lookupTerm(name)
  if (!entry) return <>{children ?? name}</>
  return (
    <span className="ux-term-wrap">
      <button
        type="button"
        className="ux-term"
        aria-expanded={open}
        aria-label={`${entry.term}是什么意思`}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onClick={() => setOpen((value) => !value)}
      >
        {children ?? name}
      </button>
      {open && (
        <span className="ux-term-pop" role="tooltip">
          <strong>{entry.plain}</strong>
          <span>{entry.detail}</span>
        </span>
      )}
    </span>
  )
}

export function GlossaryList({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`ux-glossary${compact ? ' ux-glossary--compact' : ''}`}>
      {GLOSSARY.map((entry) => (
        <article key={entry.term} className="ux-glossary__item">
          <div className="ux-glossary__head">
            <h3>{entry.term}</h3>
            {entry.alias?.length ? <span>{entry.alias[0]}</span> : null}
          </div>
          <p>{entry.plain}</p>
          {!compact && <p className="ux-glossary__detail">{entry.detail}</p>}
        </article>
      ))}
    </div>
  )
}
