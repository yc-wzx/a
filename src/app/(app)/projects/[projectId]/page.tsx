export const metadata = { title: "项目任务 · AgileCampus" };
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { getProjectForUser, listProjectMilestones } from "@/lib/project";
import { listTeamMembers } from "@/lib/team";
import { listProjectTasks, listProjectDependencies } from "@/lib/task";
import { listTeamLabels } from "@/lib/label";
import { parseFilters, applyFilters } from "@/lib/board-filters";
import { MilestoneSection } from "./milestone-section";
import { NewTaskForm } from "./new-task-form";
import { TaskWorkspace } from "./task-workspace";
import { SavedProjectViews } from "@/components/projects/saved-project-views";
import { todayInShanghai } from "@/lib/dashboard";
import { FilterBar } from "./filter-bar";
import { ProjectNav } from "@/components/projects/project-nav";
import { ProjectLeadership } from "@/components/projects/project-leadership";
import Link from "next/link";
import { listProjectIterations } from "@/lib/iteration";
import { getProjectDoingLimit } from "@/lib/task-enhancements";
import { ProjectDoingLimitControl } from "@/components/tasks/project-doing-limit";

export default async function ProjectPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { projectId } = await params;
  const sp = await searchParams;
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!z.uuid().safeParse(projectId).success) notFound();

  const access = await getProjectForUser(session.user.id, projectId);
  if (!access) notFound();
  const { project, role } = access;

  const [
    projectMilestones,
    projectTasks,
    members,
    dependencies,
    teamLabels,
    iterationPage,
    doingLimit,
  ] = await Promise.all([
    listProjectMilestones(session.user.id, projectId),
    listProjectTasks(session.user.id, projectId),
    listTeamMembers(project.teamId),
    listProjectDependencies(session.user.id, projectId),
    listTeamLabels(session.user.id, project.teamId),
    listProjectIterations(session.user.id, projectId, { limit: 100 }),
    getProjectDoingLimit(session.user.id, projectId),
  ]);

  const filters = parseFilters(
    new URLSearchParams(
      Object.entries(sp).flatMap(([k, v]) =>
        typeof v === "string" ? [[k, v] as [string, string]] : [],
      ),
    ),
  );
  const today = todayInShanghai();
  const visibleTasks = applyFilters(projectTasks, filters, today);

  const canWrite =
    (role === "admin" || role === "student") && project.status !== "archived";
  const isAdmin = role === "admin";

  // 登录布局的单例详情侧栏由 URL 驱动，取数仍由面板自己处理：
  // 它按 taskId 调 getTaskPanelContextAction，挂载与切换都重新鉴权。取不到只影响面板本身，
  // 用户还在看板上，不会因为一个失效的深链就丢掉整页上下文。

  return (
    <main className="project-task-page">
      <header className="project-task-header">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <h1 className="min-w-0 break-words font-display text-2xl font-semibold text-ink">
            {project.name}
          </h1>
          <ProjectNav projectId={projectId} current="tasks" />
        </div>
        <p className="mt-1 text-xs text-ink-faint">
          {project.startDate ?? "开始日期未设置"} ~{" "}
          {project.endDate ?? "结束日期未设置"} ·{" "}
          {{
            planning: "规划中",
            active: "进行中",
            completed: "已完成",
            archived: "已归档",
          }[project.status] ?? project.status}
        </p>
        <ProjectLeadership compact actorId={session.user.id} projectId={projectId} canManage={isAdmin && project.status !== "archived"} members={members} />
        {project.description && <details className="project-description"><summary>项目说明</summary><p>{project.description}</p></details>}
      </header>

      {canWrite && (
        <NewTaskForm
          projectId={projectId}
          iterations={iterationPage.items.filter(i => i.status !== "completed").map(i => ({ id: i.id, name: i.name, revision: i.revision }))}
          members={members}
          milestones={projectMilestones.map((m) => ({
            id: m.id,
            title: m.title,
          }))}
        />
      )}

      <MilestoneSection
        projectId={projectId}
        milestones={projectMilestones}
        isAdmin={isAdmin && project.status !== "archived"}
        compact
      />

      <section className="space-y-3" data-tour="board">
        <TaskWorkspace
          toolbar={<><FilterBar members={members.map(m => ({ id: m.id, name: m.name }))} milestones={projectMilestones.map(m => ({ id: m.id, name: m.title }))} labels={teamLabels.map(l => ({ id: l.id, name: l.name }))} visible={visibleTasks.length} total={projectTasks.length} /><SavedProjectViews compact key={`${session.user.id}:${projectId}`} userId={session.user.id} projectId={projectId} /></>}
          notice={<ProjectDoingLimitControl data={doingLimit} />}
          projectId={projectId}
          today={today}
          groupBy={filters.group}
          tasks={visibleTasks.map((t) => ({
            id: t.id,
            title: t.title,
            description: t.description,
            completionNote: t.completionNote,
            status: t.status,
            priority: t.priority,
            startDate: t.startDate,
            dueDate: t.dueDate,
            assigneeName: t.assigneeName,
            assignees: t.assignees,
            assigneeId: t.assigneeId,
            milestoneId: t.milestoneId,
            labels: t.labels,
            parentTaskId: t.parentTaskId,
          }))}
          canWrite={canWrite}
          doingLimit={doingLimit}
          members={members}
          milestones={projectMilestones.map((m) => ({
            id: m.id,
            name: m.title,
          }))}
          allTasks={projectTasks.map((t) => ({ id: t.id, title: t.title }))}
          dependencies={dependencies}
        />
        <details className="project-board-help"><summary>任务操作说明</summary><p>点击任务打开详情，可查看、修改或删除。删除主任务会同时删除其子任务；老师角色只读。可以拖动任务卡片右上角把手，或在“更多”菜单中移动任务；把手支持空格和左右方向键。</p><Link href={`/assistant?projectId=${projectId}`} className="text-primary">打开我的项目助手 →</Link></details>
      </section>


    </main>
  );
}
