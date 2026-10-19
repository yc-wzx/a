import { createHash } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { db, type DbTx } from "@/db";
import { projects, teamMembers } from "@/db/schema";
import { AppError, ConflictError, ForbiddenError } from "./errors";
import { projectVersion } from "./project";

async function managementAccess(tx: DbTx, actorId: string, projectId: string) {
  const [project] = await tx.select().from(projects).where(eq(projects.id, projectId)).for("update");
  if (!project) throw new ForbiddenError();
  const [member] = await tx.select().from(teamMembers).where(and(eq(teamMembers.teamId, project.teamId), eq(teamMembers.userId, actorId))).for("share");
  if (member?.role !== "admin") throw new ForbiddenError();
  return project;
}
async function deletionPreview(tx: DbTx, project: typeof projects.$inferSelect) {
  const [counts] = await tx.execute<{ tasks: number; documents: number; deliverables: number; iterations: number; milestones: number; references: number }>(sql`
    select (select count(*)::int from tasks where project_id=${project.id}) as tasks,
      (select count(*)::int from project_documents where project_id=${project.id}) as documents,
      (select count(*)::int from deliverables where project_id=${project.id}) as deliverables,
      (select count(*)::int from iterations where project_id=${project.id}) as iterations,
      (select count(*)::int from milestones where project_id=${project.id}) as milestones,
      (select count(*)::int from project_references where project_id=${project.id}) as references
  `);
  const token = createHash("sha256").update(JSON.stringify([project.id, projectVersion(project), counts])).digest("hex");
  return { counts, token };
}
export async function previewProjectDeletion(actorId: string, projectId: string) {
  return db.transaction(async tx => deletionPreview(tx, await managementAccess(tx, actorId, projectId)));
}
export async function deleteArchivedProject(actorId: string, projectId: string, input: { name: string; token: string }) {
  return db.transaction(async tx => {
    const project = await managementAccess(tx, actorId, projectId);
    if (project.status !== "archived") throw new AppError("请先归档项目，再进行永久删除");
    if (input.name !== project.name) throw new AppError("请输入完整项目名称以确认删除");
    const preview = await deletionPreview(tx, project);
    if (preview.token !== input.token) throw new ConflictError("项目内容已变化，请重新核对删除范围");
    await tx.execute(sql`delete from collaboration_reactions where message_id in (
      select id from task_comments where project_id=${projectId}
      union all select id from task_discussion_messages where task_id in (select id from tasks where project_id=${projectId})
    )`);
    await tx.delete(projects).where(eq(projects.id, projectId));
  });
}
