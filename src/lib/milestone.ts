import { and, eq, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { deliverables, milestones, projects, tasks } from "@/db/schema";
import { ConflictError, ForbiddenError, NotFoundError } from "./errors";
import { getProjectForUser } from "./project";
import { projectMutation } from "./project-mutation";

const signature = z.strictObject({
  title: z.string(),
  targetDate: z.string().nullable(),
  status: z.enum(["open", "done"]),
});
const deletion = z.strictObject({ requestId: z.uuid(), expected: signature });
export type DeleteMilestoneInput = z.infer<typeof deletion>;

export async function previewMilestoneDeletion(
  actorId: string,
  projectId: string,
  milestoneId: string,
) {
  z.uuid().parse(projectId);
  z.uuid().parse(milestoneId);
  const access = await getProjectForUser(actorId, projectId);
  if (
    !access ||
    access.role !== "admin" ||
    access.project.status === "archived"
  )
    throw new ForbiddenError();
  const [row] = await db
    .select()
    .from(milestones)
    .where(
      and(eq(milestones.id, milestoneId), eq(milestones.projectId, projectId)),
    );
  if (!row) throw new NotFoundError("里程碑不存在");
  const [[taskCount], [deliverableCount]] = await Promise.all([
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(tasks)
      .where(eq(tasks.milestoneId, milestoneId)),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(deliverables)
      .where(
        or(
          eq(deliverables.milestoneId, milestoneId),
          sql`${deliverables.workingCopy}->>'milestoneId'=${milestoneId}`,
        ),
      ),
  ]);
  return {
    expected: {
      title: row.title,
      targetDate: row.targetDate,
      status: row.status,
    },
    taskCount: taskCount.count,
    deliverableCount: deliverableCount.count,
  };
}

export async function deleteMilestone(
  actorId: string,
  projectId: string,
  milestoneId: string,
  input: DeleteMilestoneInput,
) {
  z.uuid().parse(projectId);
  z.uuid().parse(milestoneId);
  const value = deletion.parse(input);
  return projectMutation(
    {
      actorId,
      projectId,
      operation: "milestone.delete",
      requestId: value.requestId,
    },
    { milestoneId, ...value },
    ["admin"],
    async (tx) => {
      const [project] = await tx
        .select({ status: projects.status })
        .from(projects)
        .where(eq(projects.id, projectId));
      if (project.status === "archived")
        throw new ForbiddenError("归档项目不能删除里程碑");
      const [row] = await tx
        .select()
        .from(milestones)
        .where(
          and(
            eq(milestones.id, milestoneId),
            eq(milestones.projectId, projectId),
          ),
        )
        .for("update");
      if (!row) throw new NotFoundError("里程碑不存在或已删除");
      if (
        row.title !== value.expected.title ||
        row.targetDate !== value.expected.targetDate ||
        row.status !== value.expected.status
      )
        throw new ConflictError("里程碑已变化，请重新确认删除");
      // Explicit updates invalidate task/draft versions; an FK SET NULL alone would not.
      await tx
        .update(tasks)
        .set({ milestoneId: null, updatedAt: sql`now()` })
        .where(eq(tasks.milestoneId, milestoneId));
      await tx
        .update(deliverables)
        .set({
          milestoneId: sql`case when ${deliverables.milestoneId}=${milestoneId} then null else ${deliverables.milestoneId} end`,
          revision: sql`${deliverables.revision}+1`,
          updatedAt: sql`now()`,
          workingCopy: sql`case when ${deliverables.workingCopy} is null then null else jsonb_set(
        case when ${deliverables.workingCopy}->>'milestoneId'=${milestoneId} then jsonb_set(${deliverables.workingCopy},'{milestoneId}','null'::jsonb) else ${deliverables.workingCopy} end,
        '{baseRevision}',to_jsonb(${deliverables.revision}+1)) end`,
        })
        .where(
          or(
            eq(deliverables.milestoneId, milestoneId),
            sql`${deliverables.workingCopy}->>'milestoneId'=${milestoneId}`,
          ),
        );
      // Immutable versions, feedback snapshots and iteration history retain their original identifiers/titles.
      await tx.delete(milestones).where(eq(milestones.id, milestoneId));
      return { deleted: true, milestoneId };
    },
  );
}
