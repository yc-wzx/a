import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { tasks } from "@/db/schema";
import { taskAssociationsSchema, type TaskAssociationsInput, type TaskAssociationsResult } from "@/contracts/task-associations";
import { recordProjectActivity } from "./activity";
import { ConflictError, ForbiddenError, NotFoundError } from "./errors";
import { setTaskLabels } from "./label";
import { requireTaskWrite, setTaskSuccessors } from "./task";
import { runIdempotent } from "./write-request";

/** This form changes associations only; both replacements commit or roll back together. */
export async function saveTaskAssociations(actorId: string, projectId: string, taskId: string,
  input: TaskAssociationsInput): Promise<TaskAssociationsResult> {
  const parsed = taskAssociationsSchema.parse(input);
  return db.transaction(tx => runIdempotent(tx,
    { actorId, projectId, operation: "task.associations", requestId: parsed.requestId },
    { taskId, ...parsed }, async () => {
      const access = await requireTaskWrite(actorId, projectId);
      if (access.project.status === "archived") throw new ForbiddenError("已归档项目不能修改任务");
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${projectId + ":task-associations"}))`);
      const [task] = await tx.select().from(tasks)
        .where(and(eq(tasks.id, taskId), eq(tasks.projectId, projectId))).for("update");
      if (!task) throw new NotFoundError("任务不存在或无权访问");
      if (task.updatedAt.getTime() !== new Date(parsed.expectedUpdatedAt).getTime())
        throw new ConflictError("任务已被他人修改，请重新打开任务核对后保存");

      await setTaskLabels(actorId, taskId, parsed.labelIds, { tx });
      await setTaskSuccessors(actorId, taskId, [...new Set(parsed.successorIds)], { tx });
      const [updated] = await tx.update(tasks).set({
        updatedAt: sql`greatest(date_trunc('milliseconds', clock_timestamp()), date_trunc('milliseconds', ${tasks.updatedAt}) + interval '1 millisecond')`,
      }).where(eq(tasks.id, taskId)).returning({ updatedAt: tasks.updatedAt });
      const occurredAt = updated.updatedAt.toISOString();
      await recordProjectActivity(tx, { projectId, actorId, type: "task.updated", objectType: "task", objectId: taskId,
        summary: "更新了任务标签与依赖", occurredAt,
        eventKey: `task.associations:${taskId}:${parsed.requestId}`,
        metadata: { taskId, changedFields: ["labels", "dependencies"] } });
      return { taskId, updatedAt: occurredAt };
    }));
}
