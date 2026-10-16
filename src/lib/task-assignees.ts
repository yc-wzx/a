import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db, type DbTx } from "@/db";
import { taskAssignees, tasks, teamMembers, users } from "@/db/schema";
import { ValidationError } from "./errors";
import { recordNotificationIntent } from "./notifications";

export function assignedTo(userId: string) {
  return sql<boolean>`(${tasks.assigneeId} = ${userId} or exists(select 1 from task_assignees ta where ta.task_id=${tasks.id} and ta.user_id=${userId}))`;
}
export async function assigneesByTask(ids: string[], exec: typeof db | DbTx = db) {
  const map = new Map<string, { id: string; name: string }[]>();
  if (!ids.length) return map;
  const rows = await exec.select({ taskId: taskAssignees.taskId, id: users.id, name: users.name })
    .from(taskAssignees).innerJoin(users, eq(users.id, taskAssignees.userId))
    .where(inArray(taskAssignees.taskId, ids)).orderBy(users.name, users.id);
  for (const r of rows) map.set(r.taskId, [...(map.get(r.taskId) ?? []), { id: r.id, name: r.name }]);
  return map;
}
export async function replaceTaskAssignees(tx: DbTx, actorId: string, task: typeof tasks.$inferSelect, ids: string[]) {
  const unique = [...new Set(z.array(z.uuid()).max(30).parse(ids))];
  const old = await tx.select().from(taskAssignees).where(eq(taskAssignees.taskId, task.id));
  if (unique.length) {
    const members = await tx.select({ id: teamMembers.userId }).from(teamMembers)
      .where(and(eq(teamMembers.teamId, sql`(select team_id from projects where id=${task.projectId})`), inArray(teamMembers.userId, unique))).for("share");
    if (members.length !== unique.length) throw new ValidationError("只能指派当前团队成员");
  }
  await tx.delete(taskAssignees).where(eq(taskAssignees.taskId, task.id));
  if (unique.length) await tx.insert(taskAssignees).values(unique.map(userId => ({ taskId: task.id, userId })));
  const added = unique.filter(id => id !== task.assigneeId && !old.some(r => r.userId === id));
  if (added.length) await recordNotificationIntent(tx, {
    eventKey: `task.coassigned:${task.id}:${task.updatedAt.toISOString()}`, projectId: task.projectId, actorId,
    type: "task.assigned", recipientIds: added, summary: `任务《${task.title}》已指派给你`.slice(0, 500),
    sourceRef: { sourceKind: "task", sourceId: task.id, projectId: task.projectId,
      sourceHref: `/projects/${task.projectId}?task=${task.id}`, evidenceKey: `task:${task.id}`, availability: "available" },
  });
}
