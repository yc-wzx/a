import { TaskLink as Link } from "@/components/tasks/task-link";
import { redirect } from "next/navigation";
import {
  ArrowRight,
  ArrowUpRight,
  Bell,
  CalendarDays,
  CheckCheck,
  CircleHelp,
  ClipboardCheck,
  Clock3,
  Flag,
  FolderKanban,
  ListTodo,
  LockKeyhole,
  Sparkles,
  Target,
  Users,
} from "lucide-react";
import { auth } from "@/lib/auth";
import { getMyProfile } from "@/lib/member-profile";
import type { MyActiveIteration, QueryPart } from "@/contracts/p0-p2";
import { todayInShanghai } from "@/lib/dashboard";
import {
  getMyWorkspaceSummary,
  getTeacherOverviewAccess,
  type RevisionRequiredItem,
} from "@/lib/workspace-summary";
import { getDashboardContext } from "@/lib/dashboard-context";
import { DashboardTaskList } from "@/components/dashboard/task-list";
import {
  WorkspaceCommandMenu,
  RefreshWorkspace,
  type WorkspaceCommand,
} from "@/components/dashboard/command-menu";
import "@/components/dashboard/workspace.css";
import { DashboardPersonalDocuments } from "@/components/dashboard/personal-documents";
import { WorkspaceCalendarPanel } from "@/components/dashboard/workspace-calendar";

function ready<T>(p: QueryPart<T>): T | null {
  return p.state === "ready" ? p.data : null;
}
function parseOffset(raw: string | undefined) {
  const n = Number(raw);
  return raw && /^\d+$/.test(raw) && Number.isSafeInteger(n) ? n : 0;
}
function UnavailableNote({ message }: { message: string }) {
  return (
    <p
      className="m-5 rounded-field border border-high/20 bg-high-soft p-4 text-sm text-high"
      role="status"
    >
      {message}
    </p>
  );
}
function SectionHeading({
  title,
  count,
  href,
  linkLabel = "查看全部",
}: {
  title: string;
  count?: number | null;
  href?: string;
  linkLabel?: string;
}) {
  return (
    <div className="workspace-section-heading">
      <h2>
        {title}
        {count != null && (
          <span className="ml-2 text-sm font-normal tabular-nums text-ink-soft">
            {count}
          </span>
        )}
      </h2>
      {href && (
        <Link href={href} className="workspace-text-link">
          {linkLabel}
          <ArrowUpRight aria-hidden className="size-3.5" />
        </Link>
      )}
    </div>
  );
}
function IterationRow({ item }: { item: MyActiveIteration }) {
  const pct = item.taskTotal
    ? Math.round((item.doneCount / item.taskTotal) * 100)
    : 0;
  return (
    <li className="workspace-iteration">
      <div className="flex items-start gap-3">
        <span className="workspace-icon-tile">
          <Target aria-hidden className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <Link
            href={`/projects/${item.projectId}/iterations/${item.id}`}
            className="break-words text-sm font-semibold text-ink hover:text-primary hover:underline"
          >
            {item.name}
          </Link>
          <p className="mt-1 text-xs text-ink-soft">{item.projectName}</p>
        </div>
        <span className="text-sm font-semibold tabular-nums text-primary">
          {item.taskTotal ? `${pct}%` : "尚无任务"}
        </span>
      </div>
      {item.goal && (
        <p className="mt-3 break-words text-xs text-ink-soft">
          目标：{item.goal}
        </p>
      )}
      <div className="mt-3 flex justify-between gap-3 text-xs text-ink-soft">
        <span>
          {item.startDate} ~ {item.endDate}
        </span>
        <span>
          主任务 {item.doneCount}/{item.taskTotal}
        </span>
      </div>
      <progress
        className="workspace-progress mt-2"
        aria-label={`${item.name}主任务完成进度`}
        max={Math.max(1, item.taskTotal)}
        value={item.doneCount}
      />
    </li>
  );
}
function RevisionRow({ item }: { item: RevisionRequiredItem }) {
  return (
    <li className="workspace-revision">
      <span className="workspace-icon-tile bg-accent-soft! text-accent!">
        <ClipboardCheck aria-hidden className="size-5" />
      </span>
      <div className="min-w-0 flex-1">
        <Link
          href={`/projects/${item.projectId}/deliverables/${item.id}?versionId=${item.versionId}&feedbackId=${item.feedbackId}`}
          className="break-words font-medium text-ink hover:text-primary hover:underline"
        >
          {item.title}
        </Link>
        <p className="mt-1 text-xs text-ink-soft">
          {item.projectName} · 第 {item.versionNumber} 版 ·{" "}
          {new Date(new Date(item.reviewedAt).getTime() + 8 * 3600 * 1000)
            .toISOString()
            .slice(0, 10)}
        </p>
        {item.comment && (
          <p className="mt-3 break-words rounded-field bg-accent-soft/50 px-3 py-2 text-sm text-ink-soft">
            教师意见：{item.comment}
          </p>
        )}
      </div>
      <ArrowUpRight aria-hidden className="mt-1 size-4 shrink-0 text-accent" />
    </li>
  );
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{
    revisionsOffset?: string;
    iterationsOffset?: string;
  }>;
}) {
  const params = await searchParams,
    offset = parseOffset(params.revisionsOffset),
    iterationsOffset = parseOffset(params.iterationsOffset);
  const session = await auth();
  if (!session?.user) redirect("/login");
  const today = todayInShanghai();
  const [summary, context, teacherAccess, me] = await Promise.all([
    getMyWorkspaceSummary(session.user.id, {
      revisionsOffset: offset,
      iterationsOffset,
    }),
    getDashboardContext(session.user.id, today),
    getTeacherOverviewAccess(session.user.id).catch(() => false),
    getMyProfile(session.user.id),
  ]);
  const groups = ready(summary.tasks),
    allTasks = groups?.flatMap((g) => g.tasks),
    taskCount = allTasks?.length ?? null;
  const overdue = groups?.find((g) => g.key === "overdue")?.tasks ?? [],
    dueToday = groups?.find((g) => g.key === "today")?.tasks ?? [];
  const iterations = ready(summary.activeIterations),
    revisions = ready(summary.revisionRequired),
    unread = ready(summary.unread);
  const projects = ready(context.projects),
    schedule = ready(context.schedule),
    replans = ready(context.replans);
  const focusTask =
    overdue[0] ??
    dueToday[0] ??
    allTasks?.find((t) => t.status === "doing") ??
    allTasks?.[0];
  const focusRevision = revisions?.items[0];
  const focus = overdue[0]
    ? {
        label: "先处理逾期任务",
        title: overdue[0].title,
        detail: `${overdue[0].projectName} · 原截止日期 ${overdue[0].dueDate}`,
        href: `/projects/${overdue[0].projectId}?task=${overdue[0].id}`,
        action: "打开任务",
      }
    : focusRevision
      ? {
          label: "先处理教师反馈",
          title: focusRevision.title,
          detail: `${focusRevision.projectName} · 第 ${focusRevision.versionNumber} 版需要修改`,
          href: `/projects/${focusRevision.projectId}/deliverables/${focusRevision.id}?versionId=${focusRevision.versionId}&feedbackId=${focusRevision.feedbackId}`,
          action: "查看反馈",
        }
      : focusTask
        ? {
            label: dueToday.length ? "推进今天截止的任务" : "继续推进手头任务",
            title: focusTask.title,
            detail: `${focusTask.projectName} · ${focusTask.dueDate ? `${focusTask.dueDate} 截止` : "尚未设置截止日期"}`,
            href: `/projects/${focusTask.projectId}?task=${focusTask.id}`,
            action: "打开任务",
          }
        : {
            label: "从这里开始",
            title:
              taskCount === null || revisions === null
                ? "部分信息暂未加载完成"
                : "为下一步工作做好准备",
            detail:
              taskCount === null || revisions === null
                ? "可以刷新工作台，或直接进入项目查看。"
                : "查看项目安排，给自己确定一个具体的小目标。",
            href: "/projects",
            action: "查看项目",
          };
  const commands: WorkspaceCommand[] = [
    ...[
      ["projects", "所有项目", "/projects"],
      ["teams", "创建或加入团队", "/teams"],
      ["schedule", "我的课表与日程", "/schedule"],
      ["notifications", "通知中心", "/notifications"],
      ["profile", "我的个人主页", `/people/${session.user.id}`],
      ["ai", "打开我的助手", "/assistant"],
      ["help", "正式使用指南", "/help"],
    ].map(([id, label, href]) => ({ id, label, href, group: "常用入口" })),
    ...(teacherAccess
      ? [
          {
            id: "teacher",
            label: "教师项目总览",
            href: "/teacher",
            group: "常用入口",
          },
        ]
      : []),
    ...(projects?.items.map((p) => ({
      id: `project:${p.id}`,
      label: p.name,
      detail: p.teamName,
      href: `/projects/${p.id}`,
      group: "当前项目",
    })) ?? []),
    ...(allTasks?.map((t) => ({
      id: `task:${t.id}`,
      label: t.title,
      detail: t.projectName,
      href: `/projects/${t.projectId}?task=${t.id}`,
      group: "我的未完成任务",
    })) ?? []),
    ...(iterations?.items.map((i) => ({
      id: `iteration:${i.id}`,
      label: i.name,
      detail: i.projectName,
      href: `/projects/${i.projectId}/iterations/${i.id}`,
      group: "当前迭代",
    })) ?? []),
    ...(revisions?.items.map((d) => ({
      id: `revision:${d.id}`,
      label: d.title,
      detail: d.projectName,
      href: `/projects/${d.projectId}/deliverables/${d.id}?versionId=${d.versionId}&feedbackId=${d.feedbackId}`,
      group: "待修改成果",
    })) ?? []),
  ];
  const dateLabel = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "long",
    day: "numeric",
    weekday: "long",
  }).format(new Date(`${today}T12:00:00+08:00`));
  const midnight = new Date(`${today}T00:00:00+08:00`).getTime();
  const timeLabel = (iso: string) => {
    const timestamp = new Date(iso).getTime();
    if (timestamp < midnight) return "00:00";
    if (timestamp >= midnight + 86400000) return "24:00";
    return new Date(iso).toLocaleTimeString("zh-CN", {
      timeZone: "Asia/Shanghai",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  };
  return (
    <main className="workspace">
      <header className="workspace-header">
        <div className="min-w-0">
          <p className="mb-2 flex items-center gap-2 text-xs font-medium text-primary">
            <span className="workspace-dot bg-primary" />
            个人工作台 <span className="text-ink-soft">/ {dateLabel}</span>
          </p>
          <h1 className="font-display text-3xl font-semibold text-ink">
            你好，{me.name}{" "}
            <span className="text-ink-soft">· 工作台</span>
          </h1>
          <p className="mt-2 text-sm text-ink-soft">
            从今天的一小步，推进整个项目。
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <WorkspaceCommandMenu entries={commands} />
          <RefreshWorkspace />
        </div>
      </header>
      <section
        className="workspace-stats"
        aria-label="个人工作概况"
        data-tour="workspace-summary"
      >
        {[
          {
            label: "今天需关注",
            count: groups ? overdue.length + dueToday.length : null,
            note: groups
              ? `${overdue.length} 项逾期 · ${dueToday.length} 项今天截止`
              : "任务信息暂不可用",
            href: "#tasks",
            icon: Clock3,
            color: "text-accent",
          },
          {
            label: "我的待办",
            count: taskCount,
            note: "指派给我的未完成任务",
            href: "#tasks",
            icon: ListTodo,
            color: "text-primary",
          },
          {
            label: "待修改成果",
            count: revisions?.total ?? null,
            note: "查看教师意见后重新提交",
            href: "#revisions",
            icon: ClipboardCheck,
            color: "text-accent",
          },
          {
            label: "未读通知",
            count: unread?.count ?? null,
            note: unread ? "任务、成果与项目提醒" : "通知信息暂不可用",
            href: "/notifications",
            icon: Bell,
            color: "text-primary",
          },
        ].map((stat) => (
          <Link
            href={stat.href}
            key={stat.label}
            className="workspace-stat group"
          >
            <div className="flex items-center gap-2 text-sm text-ink-soft">
              <stat.icon aria-hidden className={`size-4 ${stat.color}`} />
              {stat.label}
              <ArrowUpRight
                aria-hidden
                className="ml-auto size-3.5 text-ink-soft group-hover:text-primary"
              />
            </div>
            <div
              className={`mt-3 text-3xl font-semibold tabular-nums ${stat.color}`}
            >
              {stat.count ?? "—"}
              <span className="ml-2 text-xs font-normal text-ink-soft">
                {stat.count !== null ? "项" : "加载失败"}
              </span>
            </div>
            <p className="mt-2 text-xs text-ink-soft">{stat.note}</p>
          </Link>
        ))}
      </section>
      <section
        className="workspace-focus"
        aria-label="建议先处理"
        data-tour="workspace-focus"
      >
        <div className="workspace-focus-symbol">
          <Flag aria-hidden className="size-7" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium text-white/75">{focus.label}</p>
          <h2 className="mt-2 break-words text-xl font-semibold text-white">
            {focus.title}
          </h2>
          <p className="mt-2 break-words text-xs text-white/75">
            {focus.detail}
          </p>
        </div>
        <Link href={focus.href} className="workspace-focus-action">
          {focus.action}
          <ArrowRight aria-hidden className="size-4" />
        </Link>
      </section>
      <WorkspaceCalendarPanel today={today} taskCount={taskCount} taskVersion={JSON.stringify(allTasks ?? [])}>
            <p className="px-5 pb-4 text-xs text-ink-soft">
              按截止时间排列 · 包含指派给你的子任务
            </p>
            {summary.tasks.state === "unavailable" ? (
              <UnavailableNote message={summary.tasks.message} />
            ) : (
              <DashboardTaskList groups={groups!} />
            )}
      </WorkspaceCalendarPanel>
      <div className="workspace-columns">
        <div className="min-w-0 space-y-5">
          <section className="workspace-panel" data-tour="workspace-projects">
            <SectionHeading
              title="我的项目"
              count={projects?.total}
              href="/projects"
            />
            {context.projects.state === "unavailable" ? (
              <UnavailableNote message={context.projects.message} />
            ) : !projects?.items.length ? (
              <div className="workspace-empty">
                <FolderKanban aria-hidden className="size-8 text-primary/60" />
                <h3>给课程项目一个协作空间</h3>
                <p>
                  负责人在团队中创建项目，组员用邀请码加入团队后即可看到项目。
                </p>
                <Link href="/teams" className="ac-btn-ghost">
                  <Users aria-hidden className="size-4" />
                  进入团队
                </Link>
              </div>
            ) : (
              <div className="workspace-projects">
                {projects.items.map((p) => {
                  const pct = p.taskTotal
                    ? Math.round((p.doneCount / p.taskTotal) * 100)
                    : 0;
                  return (
                    <article key={p.id} className="workspace-project">
                      <div className="flex gap-3">
                        <span className="workspace-icon-tile">
                          <FolderKanban aria-hidden className="size-5" />
                        </span>
                        <div className="min-w-0 flex-1">
                          <Link
                            href={`/projects/${p.id}`}
                            className="break-words text-sm font-semibold hover:text-primary hover:underline"
                          >
                            {p.name}
                          </Link>
                          <p className="mt-1 text-xs text-ink-soft">
                            {p.teamName} ·{" "}
                            {p.role === "admin"
                              ? "负责人"
                              : p.role === "teacher"
                                ? "指导老师"
                                : "组员"}
                          </p>
                        </div>
                      </div>
                      <div className="mb-2 mt-4 flex justify-between text-xs text-ink-soft">
                        <span>任务完成（含子任务）</span>
                        <span className="tabular-nums">
                          {p.doneCount}/{p.taskTotal}
                          {p.taskTotal > 0 ? ` · ${pct}%` : " · 尚无任务"}
                        </span>
                      </div>
                      <progress
                        aria-label={`${p.name}任务完成进度`}
                        className="workspace-progress"
                        max={Math.max(1, p.taskTotal)}
                        value={p.doneCount}
                      />
                      <div className="mt-4 flex gap-4 border-t border-line pt-3 text-xs">
                        <Link
                          className="workspace-text-link"
                          href={`/projects/${p.id}`}
                        >
                          任务看板
                        </Link>
                        <Link
                          className="workspace-text-link"
                          href={`/projects/${p.id}/personal-plan`}
                        >
                          个人规划
                        </Link>
                        <Link
                          className="workspace-text-link"
                          href={`/projects/${p.id}/deliverables`}
                        >
                          {p.role === "teacher" ? "查看成果" : "提交成果"}
                          <ArrowUpRight aria-hidden className="size-3" />
                        </Link>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
            {projects && projects.total > projects.items.length && (
              <p className="px-5 pb-4 text-xs text-ink-soft">
                显示最近创建的 {projects.items.length}{" "}
                个项目，其余项目可在“查看全部”中打开。
              </p>
            )}
          </section>
          <section className="workspace-panel" data-tour="workspace-schedule">
            <SectionHeading
              title="今日日程"
              href="/schedule"
              linkLabel="管理日程"
            />
            <div className="mx-5 mb-4 flex items-center gap-1.5 text-xs text-ink-soft">
              <LockKeyhole aria-hidden className="size-3.5" />
              仅本人可见 · 北京时间
            </div>
            {context.schedule.state === "unavailable" ? (
              <UnavailableNote message={context.schedule.message} />
            ) : !schedule?.items.length ? (
              <div className="px-5 pb-5">
                <CalendarDays
                  aria-hidden
                  className="mb-3 size-7 text-primary/60"
                />
                <p className="text-sm font-medium">今天暂无已登记日程</p>
                <p className="mt-2 text-xs leading-6 text-ink-soft">
                  导入课表或补充临时事件后，会在这里显示。未登记不代表空闲。
                </p>
                <Link className="workspace-text-link mt-3" href="/schedule">
                  导入我的课表
                  <ArrowUpRight aria-hidden className="size-3" />
                </Link>
              </div>
            ) : (
              <ol className="workspace-agenda">
                {schedule.items.slice(0, 5).map((e) => (
                  <li key={e.id}>
                    <time className="text-xs tabular-nums text-primary">
                      {timeLabel(e.startAt)} — {timeLabel(e.endAt)}
                    </time>
                    <span className="mt-1 block break-words text-sm font-medium">
                      {e.title}
                    </span>
                  </li>
                ))}
                {(schedule.items.length > 5 ||
                  schedule.nextOffset !== null) && (
                  <li>
                    <Link
                      href={`/schedule?from=${today}&to=${today}`}
                      className="workspace-text-link"
                    >
                      查看今天全部日程
                      <ArrowUpRight aria-hidden className="size-3" />
                    </Link>
                  </li>
                )}
              </ol>
            )}
            {context.replans.state === "unavailable" ? (
              <UnavailableNote message={context.replans.message} />
            ) : (
              !!replans?.length && (
                <div className="mx-5 mb-5 rounded-field bg-accent-soft p-3">
                  <p className="text-xs font-medium text-accent">
                    日程已变化，有 {replans.length} 份安排需要核对
                  </p>
                  {replans.slice(0, 2).map((p) => (
                    <Link
                      key={p.id}
                      className="mt-2 block break-words text-xs text-primary underline"
                      href={`/projects/${p.projectId}/personal-plan?replan=${p.id}`}
                    >
                      {p.projectName}：重新规划
                    </Link>
                  ))}
                  {replans.length > 2 && (
                    <Link href="/schedule" className="workspace-text-link mt-2">
                      查看其他安排
                    </Link>
                  )}
                </div>
              )
            )}
          </section>
          <section className="workspace-panel">
            <SectionHeading title="当前迭代" count={iterations?.total} />
            {summary.activeIterations.state === "unavailable" ? (
              <UnavailableNote message={summary.activeIterations.message} />
            ) : !iterations?.items.length ? (
              <div className="px-5 pb-5 text-xs leading-6 text-ink-soft">
                <Target aria-hidden className="mb-3 size-7 text-primary/60" />
                <p className="text-sm font-medium text-ink">暂无进行中的迭代</p>
                <p className="mt-2">
                  把阶段目标拆成一轮短周期工作，开始迭代后可在这里跟进。
                </p>
                <Link href="/projects" className="workspace-text-link mt-3">
                  进入项目安排迭代
                  <ArrowUpRight aria-hidden className="size-3" />
                </Link>
              </div>
            ) : (
              <>
                <ul>
                  {iterations.items.slice(0, 2).map((i) => (
                    <IterationRow key={i.id} item={i} />
                  ))}
                </ul>
                {iterations.items.length > 2 && (
                  <details className="border-t border-line">
                    <summary className="cursor-pointer px-5 py-3 text-xs text-primary">
                      展开本页其他 {iterations.items.length - 2} 轮迭代
                    </summary>
                    <ul>
                      {iterations.items.slice(2).map((i) => (
                        <IterationRow key={i.id} item={i} />
                      ))}
                    </ul>
                  </details>
                )}
              </>
            )}
            {iterations &&
              (iterationsOffset > 0 || iterations.nextOffset !== null) && (
                <nav
                  aria-label="当前迭代分页"
                  className="flex flex-wrap gap-3 border-t border-line px-5 py-3 text-xs text-primary"
                >
                  {iterationsOffset > 0 && (
                    <Link
                      href={`/dashboard?iterationsOffset=${Math.max(0, iterationsOffset - 50)}&revisionsOffset=${offset}`}
                    >
                      上一页
                    </Link>
                  )}
                  {iterations.nextOffset !== null && (
                    <Link
                      href={`/dashboard?iterationsOffset=${iterations.nextOffset}&revisionsOffset=${offset}`}
                    >
                      下一页
                    </Link>
                  )}
                  <span>共 {iterations.total} 轮</span>
                </nav>
              )}
          </section>
        </div>
        <aside className="min-w-0 space-y-5">
          <DashboardPersonalDocuments actorId={session.user.id} />
          <section className="workspace-assistant">
            <span className="workspace-icon-tile">
              <Sparkles aria-hidden className="size-5" />
            </span>
            <h2 className="mt-3 text-sm font-semibold">让助手配合你的节奏</h2>
            <p className="mt-2 text-xs leading-6 text-ink-soft">
              配置自己的 AI，在项目中拆解任务、拟定安排。草案由你确认后再采用。
            </p>
            <Link href="/assistant" className="workspace-text-link mt-3">
              打开我的助手
              <ArrowUpRight aria-hidden className="size-3.5" />
            </Link>
            <div className="mt-4 border-t border-primary/10 pt-3">
              <Link href="/help" className="workspace-text-link">
                <CircleHelp aria-hidden className="size-4" />
                五分钟快速上手
              </Link>
              {teacherAccess && (
                <Link href="/teacher" className="workspace-text-link mt-3">
                  <Users aria-hidden className="size-4" />
                  教师项目总览
                </Link>
              )}
            </div>
          </section>
        </aside>
      </div>
      <section id="revisions" className="workspace-panel scroll-mt-24">
        <SectionHeading title="需要处理的成果" count={revisions?.total} />
        <p className="px-5 pb-4 text-xs text-ink-soft">
          通知已读后仍保留在这里；按教师意见修改并重新提交后移出。
        </p>
        {summary.revisionRequired.state === "unavailable" ? (
          <UnavailableNote message={summary.revisionRequired.message} />
        ) : !revisions?.items.length ? (
          <div className="flex items-center gap-3 border-t border-line px-5 py-5">
            <CheckCheck aria-hidden className="size-6 text-done" />
            <div>
              <p className="text-sm font-medium">暂无需要修改的成果</p>
              <p className="mt-1 text-xs text-ink-soft">
                提交与评审记录可以在项目成果页查看。
              </p>
            </div>
          </div>
        ) : (
          <ul className="divide-y divide-line border-t border-line">
            {revisions.items.map((d) => (
              <RevisionRow key={d.id} item={d} />
            ))}
          </ul>
        )}
        {revisions && (offset > 0 || revisions.nextOffset !== null) && (
          <nav
            aria-label="待修改成果分页"
            className="flex flex-wrap gap-3 border-t border-line px-5 py-3 text-sm text-primary"
          >
            {offset > 0 && (
              <Link
                href={`/dashboard?revisionsOffset=${Math.max(0, offset - 50)}&iterationsOffset=${iterationsOffset}#revisions`}
              >
                上一页
              </Link>
            )}
            {revisions.nextOffset !== null && (
              <Link
                href={`/dashboard?revisionsOffset=${revisions.nextOffset}&iterationsOffset=${iterationsOffset}#revisions`}
              >
                下一页
              </Link>
            )}
            <span>共 {revisions.total} 项</span>
          </nav>
        )}
      </section>
    </main>
  );
}
