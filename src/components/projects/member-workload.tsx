import { TaskLink as Link } from "@/components/tasks/task-link";
import { getProjectForUser } from "@/lib/project";
import { listProjectTasks } from "@/lib/task";
import { listTeamMembers } from "@/lib/team";
import { ForbiddenError } from "@/lib/errors";
import { notFound } from "next/navigation";
import { QueryUnavailable } from "./query-state";
import { summarizeMemberWorkload } from "@/lib/project-workload";

export async function MemberWorkloadPanel({
  actorId,
  projectId,
  today,
}: {
  actorId: string;
  projectId: string;
  today: string;
}) {
  let rows;
  try {
    const access = await getProjectForUser(actorId, projectId);
    if (!access) throw new ForbiddenError();
    const [members, tasks] = await Promise.all([
      listTeamMembers(access.project.teamId),
      listProjectTasks(actorId, projectId),
    ]);
    rows = summarizeMemberWorkload(members, tasks, today);
  } catch (error) {
    if (error instanceof ForbiddenError) notFound();
    console.error(
      "[overview] 成员工作量查询失败",
      error instanceof Error ? error.name : "UnknownError",
    );
    return (
      <QueryUnavailable
        title="成员工作量"
        message="工作量暂时无法读取，请稍后刷新；不会将读取失败显示为零任务。"
      />
    );
  }
  return (
    <section className="ac-card p-5" aria-label="成员工作量">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-medium text-ink">成员工作量</h2>
          <p className="mt-1 text-xs text-ink-soft">
            本项目实际任务数；主任务、子任务分别计为一条，已完成不计入逾期。数量不代表投入时长或贡献评分。
          </p>
        </div>
        <span className="ac-badge shrink-0 bg-sunken text-ink-soft">
          {rows.reduce((sum, r) => sum + r.total, 0)} 个任务
        </span>
      </div>
      <div className="mt-4 space-y-2">
        {rows.map((row) => (
          <details
            key={row.id}
            className="rounded-xl border border-line bg-surface p-3"
          >
            <summary className="flex cursor-pointer items-center justify-between gap-3 text-sm">
              <span className="font-medium text-ink">{row.name}</span>
              <span className="flex gap-4 text-xs">
                <span className="text-ink-soft">未完成 {row.open}</span>
                <span className="text-done">完成 {row.done}</span>
                <span className={row.overdue ? "text-high" : "text-ink-faint"}>
                  逾期 {row.overdue}
                </span>
              </span>
            </summary>
            <div className="mt-3 border-t border-line pt-3">
              <Link className="mr-4 text-xs text-primary underline" href={`/people/${row.id}`}>
                查看个人主页
              </Link>
              <Link
                className="text-xs text-primary underline"
                href={`/projects/${projectId}?view=list&assignee=${row.id}`}
              >
                查看此成员的全部任务
              </Link>
              {row.urgent.length ? (
                <ul className="mt-2 space-y-2">
                  {row.urgent.slice(0, 3).map((task) => (
                    <li
                      key={task.id}
                      className="flex items-start justify-between gap-3 text-xs"
                    >
                      <Link
                        className="text-ink hover:text-primary"
                        href={`/projects/${projectId}?view=list&assignee=${row.id}&task=${task.id}`}
                      >
                        {task.parentTaskId ? "子任务 · " : ""}
                        {task.title}
                      </Link>
                      <span
                        className={`shrink-0 ${task.dueDate && task.dueDate < today ? "text-high" : "text-ink-soft"}`}
                      >
                        {task.dueDate ?? "未排期"}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2 text-xs text-ink-faint">暂无未完成任务。</p>
              )}
            </div>
          </details>
        ))}
      </div>
    </section>
  );
}
