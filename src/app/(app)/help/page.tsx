import Link from "next/link";
import { ArrowRight, BookOpen, CheckCircle2 } from "lucide-react";
import { QuickstartTour } from "@/components/quickstart-tour";

const contents = [["start", "开始使用"], ["roles", "角色操作流程"], ["tasks", "项目与任务管理"], ["documents", "项目文档协作"], ["deliverables", "成果提交与反馈"], ["notifications", "通知处理"], ["personal", "个人 AI 与日程"], ["questions", "常见问题"]];
const roleGuides = [
  { title: "负责人／团队管理员", steps: [
    ["组建团队", "在团队页创建团队，将邀请码提供给成员与指导教师。管理员在成员管理中设置教师角色；指定项目负责人不会自动改变团队权限。"],
    ["建立项目", "进入团队项目页创建项目，填写目标、起止日期并选择模板。模板提供建议阶段，管理员可按课程安排添加或删除里程碑。"],
    ["安排工作", "在任务页创建任务，填写负责人、截止时间及完成标准；将任务纳入计划迭代，明确本轮目标后开始迭代。"],
    ["跟进协作", "通过项目概览查看进度和成员工作量，在任务详情维护检查清单、阻塞情况和资料关联；在项目文档中共同编写与审阅材料。"],
    ["整理阶段成果", "展示前核对正式成果版本、教师反馈和修改任务，保存关键文档版本；使用周报及过程证据整理已有记录。"],
  ]},
  { title: "项目成员", steps: [
    ["加入团队", "注册并登录个人账号，填写团队邀请码。加入后默认是成员，从团队项目页进入课程项目。"],
    ["完成任务", "在工作台查看自己的任务，打开详情核对要求与日期。开始工作后更新状态；遇到阻塞及时记录，并通过任务评论沟通。"],
    ["记录过程", "勾选已经完成的检查项，关联文档或资料，关注需要跟进的任务。需要独立负责人或日期的工作使用子任务。"],
    ["提交成果", "在成果页登记报告、演示文稿、视频或代码链接，先保存草稿，核对后正式提交。收到退回反馈后修改并重新提交。"],
    ["安排个人时间", "需要排期时导入课表或补充日程，在项目短期计划中生成规则或 AI 草案，核对后确认。临时事件可用于重新规划。"],
  ]},
  { title: "指导教师", steps: [
    ["加入指导团队", "使用个人账号和邀请码加入团队，由管理员设置为指导教师。"],
    ["查看项目进度", "在教师项目总览查看任务、迭代、阶段成果与风险，在项目概览进一步查看工作分布和活动记录。"],
    ["审阅文档", "打开项目共享文档，通过段落评论提出具体建议。教师默认可评论，文档所有者明确授予编辑权限后才能修改正文。"],
    ["审核正式成果", "在成果详情查看正式版本、说明与材料，选择验收通过或退回并填写反馈；学生据此修改并重新提交。"],
    ["持续指导", "发布公告或参与任务讨论。团队忙碌日程仅展示成员主动共享的模糊时段，不展示私人事件内容。"],
  ]},
];

function Chapter({ id, number, title, children }: { id: string; number: string; title: string; children: React.ReactNode }) {
  return <section id={id} className="ac-card scroll-mt-24 space-y-5 p-6"><h2 className="flex items-center gap-3 text-lg font-semibold"><span className="text-sm font-normal tabular-nums text-ink-faint">{number}</span>{title}</h2><div className="space-y-4 text-sm leading-7 text-ink-soft">{children}</div></section>;
}
export default function HelpPage() {
  return <main className="space-y-7 py-6" data-help-guide>
    <header className="flex items-start justify-between gap-6 border-b border-line pb-6"><div><p className="mb-2 flex items-center gap-2 text-sm text-primary"><BookOpen size={16} />新手教程</p><h1 className="font-display text-3xl font-semibold">AgileCampus 使用指南</h1><p className="mt-3 max-w-2xl text-sm leading-6 text-ink-soft">面向高校课程项目的操作说明。按角色完成团队组建、任务协作、文档编写与成果提交，建立可追溯的项目过程。</p></div><Link href="/dashboard" className="ac-btn-ghost">进入工作台<ArrowRight size={15} /></Link></header>
    <div className="grid grid-cols-[200px_minmax(0,1fr)] items-start gap-7">
      <aside className="sticky top-24 space-y-4"><nav aria-label="使用指南目录" className="ac-card p-3"><p className="px-3 py-2 text-xs font-medium text-ink-faint">目录</p>{contents.map(([id, title], index) => <a key={id} href={`#${id}`} className="block rounded-field px-3 py-2.5 text-sm text-ink-soft hover:bg-primary-soft hover:text-primary"><span className="mr-2 text-xs text-ink-faint">{String(index + 1).padStart(2, "0")}</span>{title}</a>)}</nav><div className="rounded-xl border border-line p-4 text-xs leading-5 text-ink-soft">页面操作指引已纳入「新手教程」菜单，可在当前业务页面启动，定位主要入口。</div></aside>
      <div className="space-y-5">
        <Chapter id="start" number="01" title="开始使用">
          <p>每位成员和教师使用独立账号。团队管理成员与角色，项目管理目标、任务、阶段和成果。首次使用建议先完成一次「创建任务 → 记录协作 → 提交成果 → 查看反馈」流程。</p>
          <div className="flex gap-3"><Link href="/teams" className="ac-btn">进入团队</Link><Link href="/projects" className="ac-btn-ghost">查看项目</Link><QuickstartTour /></div>
          <p>顶部「新手教程」提供完整使用指南和当前页面操作指引。账户菜单提供我的主页、个人日程、设置与退出入口。</p>
        </Chapter>
        <Chapter id="roles" number="02" title="角色操作流程">
          <p>先确认团队角色，再按对应流程操作。团队管理员、项目成员、指导教师具有不同权限。</p>
          {roleGuides.map((guide, i) => <details key={guide.title} className="rounded-xl border border-line bg-canvas/40" open={i === 0}><summary className="cursor-pointer px-4 py-3 font-medium text-ink">{guide.title}</summary><ol className="space-y-4 px-5 pb-5">{guide.steps.map(([label, description], index) => <li key={label} className="flex items-start gap-3"><span className="mt-1 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-primary-soft text-[11px] text-primary">{index + 1}</span><div><h3 className="font-medium text-ink">{label}</h3><p className="mt-1">{description}</p></div></li>)}</ol></details>)}
        </Chapter>
        <Chapter id="tasks" number="03" title="项目与任务管理">
          <dl className="grid grid-cols-[5rem_1fr] gap-x-4 gap-y-3"><dt className="font-medium text-ink">项目</dt><dd>课程团队要完成的整体工作，包含目标、周期、任务和成果。</dd><dt className="font-medium text-ink">里程碑</dt><dd>阶段节点，例如需求确认、中期展示、结题。删除阶段会解除当前关联，保留任务和历史成果。</dd><dt className="font-medium text-ink">任务</dt><dd>有负责人、截止日期和完成标准的具体工作。任务清单用于核对完成条件，子任务用于独立分工。</dd><dt className="font-medium text-ink">迭代</dt><dd>围绕短期目标安排的一轮工作。计划阶段选择任务，开始后跟踪，结束时处理未完成任务并记录复盘。</dd></dl>
          <p>任务页支持看板、列表、甘特图，三种视图共用筛选和详情。看板用于推进状态，列表用于核对分工，甘特图用于查看排期。常用筛选仅保存在当前账号、当前项目和当前浏览器。</p>
          <p>关注任务后可收到状态与阻塞变化通知。管理员可设置进行中主任务数量建议上限，超过时提醒，但不会阻止操作。</p>
          <p>概览的成员工作量统计实际任务数量，主任务和子任务各计一条，不作为贡献评分。归档项目只读；删除主任务会同时删除其子任务，操作前需核对影响范围。</p>
        </Chapter>
        <Chapter id="documents" number="04" title="项目文档协作">
          <ol className="list-decimal space-y-2 pl-5"><li>从项目侧栏进入「项目文档」，新建文档或导入 Markdown，填写标题和目录。</li><li>正文支持列表、表格、检查项、代码和图片网址，输入「/」可快捷插入内容。修改会自动保存，关闭前确认显示「已保存」。</li><li>多位成员可同时编辑并看到在线光标。断线输入保留在当前页面，重连后合并；关闭或刷新前先复制或下载未保存内容。</li><li>选中或点击段落后添加评论，可回复、解决和重新打开。原段落删除后，评论引用仍保留，并提示位置失效。</li><li>在版本面板保存命名版本、比较差异或恢复。恢复前保留当前稿，其他在线成员按提示重新打开。</li><li>在任务面板关联已有任务，从文档与任务详情双向跳转；在设置中选择项目共享或个人草稿，以及阅读、评论、编辑权限。</li><li>导出 Markdown 或使用浏览器打印。误删文档可从回收站恢复。Markdown 不包含权限、评论与协作历史。</li></ol>
          <h3 className="font-medium text-ink">从资料落实到任务</h3>
          <p>在文档库顶部查看「项目指南」，按需求、设计、测试与汇报找到当前依据。负责人可设置固定资料；星标收藏与最近打开仅本人可见。使用顶部「快速查找」或 Ctrl+K 查找有权访问的文档正文、任务及会议资料。</p>
          <p>正文输入 [[ 或点击「引用项目文档」，在「文档引用」面板查看引用与反向引用。引用不改变目标文档权限，改名后显示最新标题；没有阅读权限的内容不会显示。</p>
          <p>通过「插入…」添加折叠、提示、待确认和风险内容块。光标放入块中后点「上移／下移」，或使用 Alt+Shift+↑/↓ 调整一个顶层块的位置；可以撤销。</p>
          <p>学生选中同一段落内的工作要求，点击「创建任务」，确认标题、负责人和截止日期。任务保留原文入口；从个人草稿复制文字为共享任务前，需要明确同意共享选区内容。</p>
        </Chapter>
        <Chapter id="deliverables" number="05" title="成果提交与反馈">
          <p>在项目成果页登记报告、PPT、视频或代码链接，先保存草稿，再明确提交为正式版本。确认外部链接可以访问，材料与说明对应当前工作。</p>
          <div className="rounded-field bg-primary-soft p-4 text-ink"><p className="flex items-center gap-2 font-medium"><CheckCircle2 size={16} />提交、任务完成、成果验收分别记录</p><p className="mt-2 text-ink-soft">提交材料不等于验收通过。教师退回后需依据反馈修改并重新提交；任务进度与成果通过率独立显示。</p></div>
          <p>正式版本保留提交内容和时间。教师可通过验收或退回给出具体反馈；已有教师反馈可以关联修改任务。展示前可导出周报和过程证据，记录来自真实操作，不自动补写历史。</p>
        </Chapter>
        <Chapter id="notifications" number="06" title="通知处理">
          <p>通知中心展示任务指派、关注任务变化、讨论提及、成果反馈和公告。切换「查看全部」或「只看未读」，选择项目后点击「应用筛选」。</p>
          <p>点击「查看来源」进入对应工作；单条或批量标记已读仅整理消息，不改变任务与成果状态。按项目筛选时，批量操作只处理该项目已有的通知。</p>
          <Link href="/notifications" className="inline-flex items-center gap-1 text-primary">进入通知中心<ArrowRight size={14} /></Link>
        </Chapter>
        <Chapter id="personal" number="07" title="个人 AI 与日程">
          <h3 className="font-medium text-ink">个人主页与团队分工</h3><p>在团队成员页点击姓名或头像，查看个人介绍、技能、共同团队的项目、负责的任务和正式成果。在账户菜单进入自己的主页，通过「编辑个人资料」维护姓名、简介、技能和头像。任务数量用于了解工作分布，不作为贡献评分；私人日程、私有文档及 AI 会话不进入个人主页。</p>
          <h3 className="font-medium text-ink">配置自己的 AI 助手</h3><ol className="list-decimal space-y-2 pl-5"><li>在<Link href="/settings" className="text-primary underline">设置</Link>中选择服务商，填写支持的模型与个人 API 密钥，设置助手名称及表达偏好。</li><li>保存后测试已保存的连接；测试会调用该服务商，额度和计费以服务商规则为准。</li><li>项目聊天、迭代草案、个人规划与文档写作使用当前账号配置。没有配置也能使用基本协作和规则规划。</li><li>AI 生成的方案先作为草案或预览，核对后确认。文档 AI 仅发送本次选中文字，确认后才替换选区。</li></ol>
          <h3 className="font-medium text-ink">项目资料问答</h3><p>在项目助手切换「资料问答」，主动选择最多 3 篇有权阅读的项目文档，再填写问题。助手通过自己的 AI 配置处理相关段落，回答必须附能核对的原文出处；本次问答只在当前页面展示，不写入团队会话或自动修改任务。较长文档仅选取部分相关段落，正式要求仍需核对原文并由师生确认。</p>
          <h3 className="font-medium text-ink">课表、临时事件与短期计划</h3><p>在个人日程页导入 ICS／CSV 或手动记录课程与占用时间，设置可投入时间后，在项目个人短期计划中生成安排。临时事件无需填写具体原因，确认新草案后才替换旧安排。</p><p>日程默认私有。仅本人主动选择共享的时间，才会在团队忙碌日程中展示模糊时段，具体事件内容不会显示给组员或教师。</p>
        </Chapter>
        <Chapter id="questions" number="08" title="常见问题">
          {[ ["为什么看不到项目？", "确认使用正确账号并已加入所属团队。从团队卡片进入项目；没有项目时联系团队管理员创建。"], ["为什么不能编辑或删除？", "核对团队角色、文档授权及项目是否归档。教师默认可评论项目文档，不能自动修改正文；里程碑由管理员管理。"], ["文档没有保存成功怎么办？", "保留当前页面，核对网络及权限。复制或下载未保存副本后再重新打开。版本恢复、权限变化或移入回收站可能停止旧会话同步。"], ["AI 无法使用怎么办？", "检查个人服务商、模型、密钥及连接测试。其他成员的配置不会替代当前账号配置，规则规划仍可使用。"], ["为什么周报和通知为空？", "先确认筛选范围。系统只展示已记录的真实事件，没有操作时不会补造过程记录。"] ].map(([question, answer]) => <div key={question}><h3 className="font-medium text-ink">{question}</h3><p className="mt-1">{answer}</p></div>)}
        </Chapter>
      </div>
    </div>
  </main>;
}
