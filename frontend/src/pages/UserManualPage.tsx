import { useState } from 'react'
import {
  AlertTriangle, ArrowRight, BookOpen, CheckCircle2, ChevronRight, CircleHelp,
  KeyRound, LockKeyhole, Printer, ShieldCheck,
} from 'lucide-react'
import { Link } from 'react-router-dom'
import { GlossaryList } from '../ux/glossary'

const TOC = [
  ['quickstart', '1. 五分钟开始'],
  ['guided', '2. 四步复现引导'],
  ['projects', '3. 项目与材料'],
  ['facts', '4. 解析、事实与证据'],
  ['reproduce', '5. 规划、环境与运行'],
  ['report', '6. 对照、验证与报告'],
  ['api', '7. 连接 AI 助手'],
  ['team', '8. 团队与权限'],
  ['glossary', '9. 术语词典'],
  ['errors', '10. 常见错误'],
  ['limits', '11. 当前边界'],
] as const

function Section({ id, title, kicker, children }: { id: string; title: string; kicker: string; children: React.ReactNode }) {
  return (
    <section id={id} className="ux-manual-section">
      <span className="ux-eyebrow">{kicker}</span>
      <h2>{title}</h2>
      {children}
    </section>
  )
}

function Steps({ items }: { items: string[] }) {
  return <ol className="ux-manual-steps">{items.map((text, index) => <li key={text}><span>{index + 1}</span><p>{text}</p></li>)}</ol>
}

export default function UserManualPage() {
  const [query, setQuery] = useState('')
  const lower = query.trim().toLowerCase()
  const visibleToc = TOC.filter(([, label]) => !lower || label.toLowerCase().includes(lower))

  return (
    <div className="ux-manual-page">
      <header className="ux-manual-hero">
        <div>
          <span className="ux-eyebrow"><BookOpen size={14} /> 中文使用手册 · 2026-11-24</span>
          <h1>不懂科研软件，也能把一次复现做完。</h1>
          <p>这份手册只描述 ReproCheck 当前真实具备的功能。你可以从头读，也可以按左边目录直接跳到眼下要解决的问题。</p>
          <div className="ux-manual-hero__actions">
            <Link to="/start/reproduce" className="ux-onboard-primary">从四步引导开始<ArrowRight size={16} /></Link>
            <button type="button" className="ux-onboard-secondary" onClick={() => window.print()}><Printer size={15} />打印 / 存为 PDF</button>
          </div>
        </div>
        <div className="ux-manual-hero__card">
          <CircleHelp size={20} />
          <strong>迷路时先看这一句</strong>
          <p>“我现在在哪个项目里？这一步要产出什么？页面上的下一步提示让我去哪？”</p>
          <small>页面顶部的“根据项目真实数据判断的下一步”会一直回答第三个问题。</small>
        </div>
      </header>

      <div className="ux-manual-layout">
        <aside className="ux-manual-toc">
          <label className="ux-manual-search">
            <span>按章节名筛选</span>
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="例如：API、报告、证据" />
          </label>
          <nav aria-label="手册目录">
            {visibleToc.map(([id, label]) => <a key={id} href={`#${id}`}>{label}<ChevronRight size={13} /></a>)}
            {!visibleToc.length && <p className="ux-manual-filter">没有匹配的章节名。试试“报告”“API”或清空输入。</p>}
          </nav>
        </aside>

        <article className="ux-manual-body">
          <Section id="quickstart" title="五分钟开始：先做一件小事" kicker="五分钟开始">
            <p>第一次打开 ReproCheck，不要先研究所有菜单。按下面顺序，只做当前需要的一步：</p>
            <Steps items={[
              '在工作台选择“我想复现一篇论文”，或直接打开四步复现引导。',
              '选择已有项目，或新建一个项目；项目名只要你自己认得出即可。',
              '上传论文 PDF。数据和代码没有也能先继续。',
              '最后进入复现总览，跟着页面上的下一步提示继续。',
            ]} />
            <div className="ux-manual-callout"><CheckCircle2 size={17} /><p>完成到这一步，你已经有了一次真实可继续的项目，而不是一个空演示页面。</p></div>
            <h3>你不需要先理解的事</h3>
            <ul>
              <li>不需要懂编程。代码仓库链接只登记，不会在你的电脑上自动执行。</li>
              <li>不需要先买 AI 服务。API 配置是可选增强；项目、材料、对照和报告仍可使用。</li>
              <li>不需要一次把所有材料找齐。缺项会被如实记录，不会被伪造补齐。</li>
            </ul>
          </Section>

          <Section id="guided" title="四步复现引导：论文 → 数据 → 代码 → 准备" kicker="四步引导">
            <p>引导的核心不是“填满四个步骤”，而是让你知道每一步为什么存在。</p>
            <div className="ux-manual-grid">
              {[
                ['论文', '要准备：PDF。做完得到：项目里出现原文材料，可以开始解析。', '没有论文：先跳过也可以，但无法抽取科研事实。'],
                ['数据', '要准备：CSV / Excel。做完得到：数据文件与来源记录。', '没有数据：可跳过，报告会记录限制。'],
                ['代码', '要准备：GitHub/GitLab 链接或 zip。做完得到：可追溯的仓库地址。', '注意：只登记，不下载、不运行。'],
                ['准备', '要准备：确认哪些材料已有。做完得到：真实缺项清单和下一步。', '缺项：按“去补充”回到材料页，或直接进入复现总览。'],
              ].map(([title, a, b]) => <div key={title} className="ux-manual-mini"><strong>{title}</strong><p>{a}</p><small>{b}</small></div>)}
            </div>
            <h3>每一步都可以跳过</h3>
            <p>跳过不是失败。系统只会在报告和下一步提示里记录“这项还缺”，不会把空白当成已完成。</p>
          </Section>

          <Section id="projects" title="项目与材料：先把东西放在同一个地方" kicker="项目与材料">
            <p><b>项目</b>是总文件夹；<b>材料</b>是项目里的论文、数据、代码和配置。一个项目只放同一篇论文的复现内容，最容易管理。</p>
            <h3>新建项目</h3>
            <Steps items={[
              '从“项目档案”点“新建项目”，或从四步引导里新建。',
              '项目名用你能认出的名字，例如“ResNet 图像分类复现”。',
              '论文标题和领域不确定时可以留空；系统写“待补充”，不会替你编造。',
              '创建成功后，先上传论文，再考虑数据与代码。',
            ]} />
            <h3>上传材料</h3>
            <ul>
              <li><b>论文：</b>推荐 PDF。上传后还需要“解析”，系统才会尝试读出原文块和事实。</li>
              <li><b>数据：</b>CSV / Excel。多个文件逐个上传；文件是否敏感由你判断。</li>
              <li><b>代码：</b>可以登记仓库链接，也可以上传 zip / py / ipynb。当前不会自动执行代码。</li>
            </ul>
            <div className="ux-manual-callout"><LockKeyhole size={17} /><p>材料保存在你项目的后端空间。不要把 API 密钥、身份证件或未脱敏患者数据上传到不需要它的项目。</p></div>
          </Section>

          <Section id="facts" title="解析、事实与证据：AI 读到什么，都要能指回原文" kicker="事实与证据">
            <p>解析是把 PDF 变成可搜索的文字块；事实抽取是从文字块里找出数据集、方法、指标等条目。<b>事实不是结论</b>，只是待核对的线索。</p>
            <h3>怎样检查读得对不对</h3>
            <Steps items={[
              '打开材料详情，先看解析状态与告警。',
              '再看原文预览，确认文字没有乱码或漏页。',
              '打开科研事实，逐条检查是否带原文位置。',
              '没有证据的条目不要直接写进报告；标为待复核或补充材料。',
            ]} />
            <h3>证据图谱是什么</h3>
            <p>它把事实和原文块连起来。图是空的，说明还没有可用的证据，不是系统故障。点节点可以回到来源。</p>
          </Section>

          <Section id="reproduce" title="规划、环境与运行：把“复现”拆成能检查的步骤" kicker="复现与运行">
            <p>复现规划是一条任务清单，不是一段自动脚本。每条任务应该写明做什么、依赖什么、需要谁确认。</p>
            <h3>建议顺序</h3>
            <Steps items={[
              '在复现总览创建一个手动规划。',
              '补齐任务和依赖；不确定的步骤标成需要人工确认。',
              '记录实验环境：Python、依赖包、操作系统和关键硬件。',
              '检查权限与安全策略后再启动运行。',
              '失败时保留日志和错误，不要用“重试到成功”掩盖问题。',
            ]} />
            <div className="ux-manual-callout ux-manual-callout--warn"><AlertTriangle size={17} /><p>如果后端没有启用安全执行环境，系统会阻止运行并说明原因。这是保护措施，不是让你找办法绕过。</p></div>
            <h3>运行记录看什么</h3>
            <ul><li>开始与结束时间、当前阶段、输出和错误。</li><li>失败原因是否能回到环境、数据或代码差异。</li><li>成功也不等于论文结论正确；还需要结果对照和证据检查。</li></ul>
          </Section>

          <Section id="report" title="对照、验证与报告：把“跑过”变成“说清楚”" kicker="对照与报告">
            <p>结果对照把论文报告的指标与你的真实运行结果放在一起；项目验证按证据覆盖情况汇总结论；报告把过程整理成可交付文档。</p>
            <h3>报告前的最低检查</h3>
            <ul>
              <li>每条关键结论都有证据或真实运行记录。</li>
              <li>没有把“未验证”“证据不足”写成“已证实”。</li>
              <li>数据、代码或环境缺失已写进限制，而不是隐藏。</li>
              <li>报告中的 AI 生成内容经过人工核对。</li>
            </ul>
            <h3>结果不同，不一定是论文错</h3>
            <p>环境版本、数据划分、随机种子、代码实现都可能造成差异。先记录差异，再分析原因；不要直接下结论。</p>
          </Section>

          <Section id="api" title="连接 AI 助手：五步，不碰高级参数" kicker="AI 配置">
            <p>AI 服务是可选的。它帮助你整理论文与排查问题，但不能代替证据和人工判断。第一次配置请只走向导，不要进高级管理。</p>
            <div className="ux-api-steps">
              {[
                ['选择服务商', '列表来自后端真实适配器。不要假设所有厂商都已支持。'],
                ['输入密钥', '在服务商控制台创建 API Key，粘贴到这里。密钥不会回显。'],
                ['确认模型', '先用服务商提供的常用模型；不确定时不要手填奇怪名称。'],
                ['测试连接', '系统会用你的密钥真实调用一次，不是前端假装成功。'],
                ['保存', '测试通过才允许保存；保存后设为默认模型。'],
              ].map(([title, text], index) => <div key={title}><span>{index + 1}</span><div><strong>{title}</strong><p>{text}</p></div></div>)}
            </div>
            <h3>常见概念，一句话版</h3>
            <ul>
              <li><b>API 密钥</b>：服务商给你的一把“钥匙”，只给 ReproCheck 用。</li>
              <li><b>模型</b>：真正读文字、给建议的 AI 程序。</li>
              <li><b>服务地址</b>：AI 服务所在网址。一般自动填好，只有自建服务才改。</li>
              <li><b>Token</b>：服务商计费和限流的计量单位，不是密码。</li>
            </ul>
            <div className="ux-manual-callout"><KeyRound size={17} /><p>不要把密钥写进论文、代码仓库、聊天截图或工单。怀疑泄露时，立刻到服务商控制台撤销并重建。</p></div>
            <Link to="/settings/models?tab=setup" className="ux-inline-link ux-inline-link--strong">打开五步配置向导<ChevronRight size={14} /></Link>
          </Section>

          <Section id="team" title="团队与权限：只给完成工作所需的范围" kicker="团队与权限">
            <ul>
              <li><b>组织</b>管理成员与共享空间；<b>项目团队</b>决定谁能打开具体项目。</li>
              <li>负责人可管理项目；研究员可处理材料与规划；复核员侧重检查；观察者通常只能看。</li>
              <li>页面隐藏按钮不等于后端没有校验；真正的权限由后端执行。</li>
            </ul>
            <p>邀请成员时使用对方登录邮箱。加入组织后，还需要加入具体项目团队，才能看到项目内容。</p>
          </Section>

          <Section id="glossary" title="术语词典：保留原词，但先讲人话" kicker="术语解释">
            <p>下面这些词会出现在论文、服务商页面和 ReproCheck 里。保留它们是为了方便对照；解释是为了让你不用猜。</p>
            <GlossaryList />
          </Section>

          <Section id="errors" title="常见错误：先看普通中文，再看技术详情" kicker="常见错误">
            <div className="ux-error-cards">
              {[
                ['上传失败', '检查文件类型、大小和网络。页面会显示后端具体原因；不要连续点击上传。'],
                ['解析一直排队', '后台可能在处理其他任务，或服务未启动。先刷新，仍无变化再查后端日志。'],
                ['事实为空', '通常是没有完成解析，或解析失败。先看任务状态，再回到材料详情。'],
                ['AI 测试失败', '按向导的普通中文提示处理：密钥、模型、网络或地址。技术详情折叠在下方。'],
                ['运行按钮是灰的', '安全沙箱未启用，或你的角色没有执行权限。不要尝试绕过。'],
                ['报告内容空', '先确认已有材料、事实和运行；报告不会用假数据填充章节。'],
              ].map(([title, text]) => <div key={title}><strong>{title}</strong><p>{text}</p></div>)}
            </div>
          </Section>

          <Section id="limits" title="当前边界：这些事 ReproCheck 现在不会替你假装" kicker="当前边界">
            <ul>
              <li>不会自动下载或执行代码仓库；只登记地址。</li>
              <li>没有安全执行环境时，不会假装运行成功。</li>
              <li>AI 没配置、额度不足或服务不可用时，不会用模拟回答冒充真实结果。</li>
              <li>不会把“未验证”自动改成“已验证”；证据不足会保留。</li>
              <li>不会替你在服务商处开通账号或购买额度。</li>
              <li>当前界面没有项目删除与项目字段编辑入口；如需清理请联系管理员。</li>
            </ul>
            <div className="ux-manual-foot">
              <ShieldCheck size={18} />
              <p>这份手册对应本机当前版本。若页面与手册不一致，以真实页面和接口返回为准，并请反馈。</p>
              <Link to="/" className="ux-text-link">回到工作台</Link>
            </div>
          </Section>
        </article>
      </div>
    </div>
  )
}
