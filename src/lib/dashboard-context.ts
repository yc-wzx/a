import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { projects, teams, teamMembers, tasks } from "@/db/schema";
import type { QueryPart } from "@/contracts/p0-p2";
import { ForbiddenError, NotFoundError } from "./errors";
import { todayInShanghai } from "./dashboard";
import { getMySchedule } from "./schedule/store";
import { getMyPlansNeedingReview } from "./schedule/availability";

// 项目、成员资格及统计在同一 SQL 快照读取；不使用先查成员、再取项目的旧快照。
export async function getDashboardProjects(actorId: string) {
  z.uuid().parse(actorId);
  const rows = await db
    .select({
      id: projects.id,
      name: projects.name,
      teamName: teams.name,
      role: teamMembers.role,
      taskTotal: sql<number>`(select count(*)::int from ${tasks} t where t.project_id = ${projects.id})`,
      doneCount: sql<number>`(select count(*)::int from ${tasks} t where t.project_id = ${projects.id} and t.status = 'done')`,
      total: sql<number>`(count(*) over())::int`,
    })
    .from(projects)
    .innerJoin(teams, eq(teams.id, projects.teamId))
    .innerJoin(
      teamMembers,
      and(
        eq(teamMembers.teamId, projects.teamId),
        eq(teamMembers.userId, actorId),
      ),
    )
    .where(eq(projects.status, "active"))
    .orderBy(desc(projects.createdAt), projects.id)
    .limit(6);
  return {
    items: rows.map((row) => ({
      id: row.id,
      name: row.name,
      teamName: row.teamName,
      role: row.role,
      taskTotal: row.taskTotal,
      doneCount: row.doneCount,
    })),
    total: rows[0]?.total ?? 0,
  };
}

async function part<T>(
  name: string,
  run: () => Promise<T>,
): Promise<QueryPart<T>> {
  try {
    return { state: "ready", data: await run() };
  } catch (error) {
    if (error instanceof ForbiddenError || error instanceof NotFoundError)
      throw error;
    console.error(
      "[dashboard]",
      name,
      error instanceof Error ? error.name : "UnknownError",
    );
    return {
      state: "unavailable",
      code: "INTERNAL",
      message: `${name}加载失败，请稍后刷新`,
    };
  }
}

export async function getDashboardContext(
  actorId: string,
  today = todayInShanghai(),
) {
  z.uuid().parse(actorId);
  z.iso.date().parse(today);
  const [projects, schedule, replans] = await Promise.all([
    part("项目", () => getDashboardProjects(actorId)),
    part("今日日程", async () => {
      const data = await getMySchedule(actorId, {
        startDate: today,
        endDate: today,
      });
      // 只读取本人日程，且不向工作台传递共享设置、偏好、导入来源或其他人的日程。
      return {
        items: data.items.map(({ id, title, startAt, endAt }) => ({
          id,
          title,
          startAt,
          endAt,
        })),
        nextOffset: data.nextOffset,
      };
    }),
    part("重新规划提醒", () => getMyPlansNeedingReview(actorId)),
  ]);
  return { projects, schedule, replans };
}
