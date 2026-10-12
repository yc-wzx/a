import Link from "next/link";
import { QuickstartTour } from "@/components/quickstart-tour";

const roles = [
  {
    id: "leader",
    title: "我是负责人",
    steps: [
      "在「团队」创建团队，把邀请码发给组员和老师。",
      "在成员管理设好角色：负责人为管理员、老师为导师、同学为学生。",
      "从团队进入「项目」，创建课程项目；模板会提供四个建议里程碑，可以删去不需要的阶段。",
      "在项目看板创建任务，填写负责人、截止时间和验收标准；点击卡片可查看、修改或删除。",
      "登记里程碑和迭代后，关注项目概览的进度；展示前在成果、周报和过程证据中整理真实记录。",
    ],
  },
  {
    id: "student",
    title: "我是组员",
    steps: [
      "用自己的账号注册登录，在「团队」填写负责人给的邀请码。",
      "在「工作台」查看指派给自己的任务，点击进入详情；有问题在任务评论中讨论。",
      "完成工作后，到项目「成果」登记文档、PPT、视频或代码链接，先保存草稿，再正式提交。",
      "老师退回时查看反馈，修改后重新提交；成果通过和任务完成分别记录，提交不等于通过。",
      "需要排期时，导入自己的课表，打开项目「我的短期计划」，选择规则规划或个人 AI。新增突发事件后可重新规划，确认后才替换原安排。",
    ],
  },
  {
    id: "teacher",
    title: "我是指导老师",
    steps: [
      "注册自己的账号，用邀请码加入团队，由管理员设为导师。",
      "通过教师项目总览查看项目进度、阻塞与阶段成果。",
      "在成果详情查看正式版本与说明，选择验收通过或退回，并填写具体反馈。",
      "通过公告或任务讨论补充指导意见；任务和里程碑的修改由管理员或有权限的组员执行。",
      "需要查看成员时间时，打开团队忙碌日程；只看到成员自愿共享的模糊忙碌时段，不看到私人事件。",
    ],
  },
];

export default function HelpPage() {
  return (
    <main className="space-y-6 py-6">
      <header className="space-y-3">
        <h1 className="font-display text-2xl font-semibold">五分钟快速上手</h1>
        <p className="text-sm text-ink-soft">
          先按自己的角色完成一个真实任务。AI 是可选帮助，不影响基本协作。
        </p>
        <div className="flex flex-wrap items-center gap-4">
          <Link href="/teams" className="ac-btn">
            去团队开始
          </Link>
          <Link href="/dashboard" className="text-sm text-primary underline">
            查看我的任务
          </Link>
          <QuickstartTour />
        </div>
      </header>
      <nav aria-label="教程角色" className="flex gap-4 text-sm">
        {roles.map((r) => (
          <a key={r.id} href={`#${r.id}`} className="text-primary underline">
            {r.title}
          </a>
        ))}
      </nav>
      {roles.map((role) => (
        <section id={role.id} key={role.id} className="ac-card space-y-3 p-5">
          <h2 className="font-semibold">{role.title}</h2>
          <ol className="list-decimal space-y-3 pl-5 text-sm leading-6">
            {role.steps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        </section>
      ))}
      <section className="ac-card space-y-3 p-5">
        <h2 className="font-semibold">四个词就够了</h2>
        <dl className="grid grid-cols-[5rem_1fr] gap-x-3 gap-y-3 text-sm">
          <dt className="font-medium">项目</dt>
          <dd>这学期要完成的整体工作，例如课程小组网站。</dd>
          <dt className="font-medium">里程碑</dt>
          <dd>
            阶段节点，例如需求分析、最终展示。删除阶段不删除关联任务和已提交的历史成果。
          </dd>
          <dt className="font-medium">任务</dt>
          <dd>
            具体的一件事，要有负责人和完成标准。点击卡片进入详情；删除主任务会同时删除子任务。
          </dd>
          <dt className="font-medium">迭代</dt>
          <dd>一段短周期的工作安排，例如这一周准备完成哪些任务。</dd>
        </dl>
      </section>
      <section className="ac-card space-y-3 p-5">
        <h2 className="font-semibold">配置自己的 AI 助手（可选）</h2>
        <ol className="list-decimal space-y-2 pl-5 text-sm leading-6">
          <li>
            进入{" "}
            <Link href="/settings#my-ai" className="text-primary underline">
              设置 → 我的 AI 助手
            </Link>
            ，选择自己使用的服务商。
          </li>
          <li>
            填写该服务商支持的模型名称和自己的 API
            密钥，设置助手名称与表达偏好。
          </li>
          <li>
            先保存，再点「测试已保存的连接」。这是一次短问答调用，按服务商规则计费。
          </li>
          <li>
            回到项目使用个人助手。每次调用使用当前登录人的配置；个人会话默认仅本人可见，项目共享会话需要主动选择。
          </li>
          <li>
            AI
            生成的任务或计划先作为草案；看过再确认。没有配置密钥时，选择规则规划也能安排工作。
          </li>
        </ol>
      </section>
      <section className="ac-card space-y-2 p-5">
        <h2 className="font-semibold">常见卡点</h2>
        <ul className="list-disc space-y-2 pl-5 text-sm">
          <li>找不到项目：先加入团队，再从团队项目页打开。</li>
          <li>
            看不到删除按钮：里程碑仅管理员管理；导师只读任务；归档项目不允许修改。
          </li>
          <li>
            AI
            不能用：核对个人设置并测试连接。更换服务商时要填写对应密钥，其他人的配置不能替你使用。
          </li>
          <li>
            周报没有内容：没有真实操作就没有记录，先完成一个任务与成果流程。
          </li>
          <li>
            课表不想公开：默认私有，只有本人主动选择共享时段后团队才可见。
          </li>
        </ul>
      </section>
    </main>
  );
}
