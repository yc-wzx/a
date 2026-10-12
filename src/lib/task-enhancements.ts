import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db, type DbTx } from "@/db";
import { deliverables, deliverableVersions, projectReferences, projects, tasks, teamMembers } from "@/db/schema";
import { projectTaskSettings, taskChecklistItems, taskMaterialLinks, taskWatchers } from "@/db/task-enhancements-schema";
import type { ChecklistItem, ProjectDoingLimit, TaskEnhancements, TaskMaterial } from "@/contracts/task-enhancements";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "./errors";
import { getProjectForUser } from "./project";
import { claimWriteRequest, finishWriteRequest, hashRequest } from "./write-request";
import { recordProjectActivity } from "./activity";

const identity = z.strictObject({ actorId: z.uuid(), projectId: z.uuid(), taskId: z.uuid().optional() });
const request = z.uuid();
const revision = z.number().int().positive();
const itemText = z.string().trim().min(1, "请填写检查项").max(500, "检查项最多 500 字");

async function readAccess(actorId: string, projectId: string, taskId?: string) {
  identity.parse({ actorId, projectId, taskId });
  const access = await getProjectForUser(actorId, projectId);
  if (!access) throw new ForbiddenError();
  if (taskId) {
    const [task] = await db.select({ id: tasks.id }).from(tasks).where(and(eq(tasks.projectId, projectId), eq(tasks.id, taskId)));
    if (!task) throw new NotFoundError("任务不存在");
  }
  return access;
}

// Check current membership and archive state inside every mutation, including request replay.
async function lockedAccess(tx: DbTx, actorId: string, projectId: string, mode: "task" | "watch" | "settings") {
  const rows = await tx.execute<{ role: string; status: string }>(sql`
    select m.role, p.status from projects p join team_members m on m.team_id = p.team_id
    where p.id = ${projectId} and m.user_id = ${actorId} for share of p, m
  `);
  const member = rows[0];
  if (!member || (mode === "task" && !["admin", "student"].includes(member.role)) || (mode === "settings" && member.role !== "admin")) throw new ForbiddenError();
  if (member.status === "archived") throw new ForbiddenError("项目已归档，只能查看");
}

async function mutate<T>(actorId: string, projectId: string, taskId: string, requestId: string, operation: string, input: unknown, mode: "task" | "watch", run: (tx: DbTx) => Promise<T>) {
  identity.parse({ actorId, projectId, taskId });
  request.parse(requestId);
  return db.transaction(async (tx) => {
    await lockedAccess(tx, actorId, projectId, mode);
    const [task] = await tx.select({ id: tasks.id }).from(tasks).where(and(eq(tasks.id, taskId), eq(tasks.projectId, projectId))).for("update");
    if (!task) throw new NotFoundError("任务不存在");
    const claim = await claimWriteRequest(tx, { actorId, projectId, operation, requestId }, hashRequest({ taskId, input }));
    if (claim.replay) return claim.result as T;
    return finishWriteRequest(tx, claim.id, await run(tx));
  });
}

async function recordEnhancement(tx: DbTx, actorId: string, projectId: string, taskId: string, requestId: string, type: string, summary: string) {
  await recordProjectActivity(tx, { actorId, projectId, objectType: "task", objectId: taskId, type: "task.updated",
    eventKey: `${type}:${taskId}:${requestId}`, occurredAt: new Date().toISOString(), summary, metadata: { taskId, changedFields: [type.startsWith("task.checklist") ? "checklist" : "materials"] } });
}

export async function getTaskEnhancements(actorId: string, projectId: string, taskId: string): Promise<TaskEnhancements> {
  const access = await readAccess(actorId, projectId, taskId);
  const [checklist, watchers, resources, versions, links] = await Promise.all([
    db.select({ id: taskChecklistItems.id, text: taskChecklistItems.text, checked: taskChecklistItems.checked, revision: taskChecklistItems.revision })
      .from(taskChecklistItems).where(eq(taskChecklistItems.taskId, taskId)).orderBy(asc(taskChecklistItems.sortOrder), asc(taskChecklistItems.id)),
    db.select({ userId: taskWatchers.userId }).from(taskWatchers)
      .innerJoin(teamMembers, and(eq(teamMembers.userId, taskWatchers.userId), eq(teamMembers.teamId, access.project.teamId))).where(eq(taskWatchers.taskId, taskId)),
    db.select({ id: projectReferences.id, title: projectReferences.title }).from(projectReferences).where(eq(projectReferences.projectId, projectId)).orderBy(desc(projectReferences.updatedAt)).limit(200),
    db.select({ id: deliverableVersions.id, title: deliverableVersions.title, number: deliverableVersions.versionNumber }).from(deliverableVersions)
      .innerJoin(deliverables, eq(deliverables.id, deliverableVersions.deliverableId)).where(eq(deliverables.projectId, projectId)).orderBy(desc(deliverableVersions.submittedAt)).limit(200),
    db.select().from(taskMaterialLinks).where(eq(taskMaterialLinks.taskId, taskId)).orderBy(asc(taskMaterialLinks.createdAt)).limit(50),
  ]);
  const resourceIds = links.flatMap((link) => link.resourceId ? [link.resourceId] : []);
  const versionIds = links.flatMap((link) => link.deliverableVersionId ? [link.deliverableVersionId] : []);
  const [linkedResources, linkedVersions] = await Promise.all([
    resourceIds.length ? db.select({ id: projectReferences.id, title: projectReferences.title, url: projectReferences.url }).from(projectReferences)
      .where(and(inArray(projectReferences.id, resourceIds), eq(projectReferences.projectId, projectId))) : Promise.resolve([]),
    versionIds.length ? db.select({ id: deliverableVersions.id, title: deliverableVersions.title, number: deliverableVersions.versionNumber, deliverableId: deliverables.id }).from(deliverableVersions)
      .innerJoin(deliverables, eq(deliverables.id, deliverableVersions.deliverableId)).where(and(inArray(deliverableVersions.id, versionIds), eq(deliverables.projectId, projectId))) : Promise.resolve([]),
  ]);
  const materials: TaskMaterial[] = [];
  for (const link of links) {
    if (link.resourceId) {
      const source = linkedResources.find((row) => row.id === link.resourceId);
      if (source) materials.push({ id: link.id, sourceId: source.id, title: source.title, kind: "resource", href: /^https?:\/\//i.test(source.url) ? source.url : `/projects/${projectId}/references`, revision: link.revision });
    } else if (link.deliverableVersionId) {
      const source = linkedVersions.find((row) => row.id === link.deliverableVersionId);
      if (source) materials.push({ id: link.id, sourceId: source.id, title: `${source.title} · 正式版本 ${source.number}`, kind: "deliverable", href: `/projects/${projectId}/deliverables/${source.deliverableId}?versionId=${source.id}`, revision: link.revision });
    }
  }
  return { taskId, checklist, watching: watchers.some((w) => w.userId === actorId), watchCount: watchers.length,
    canWrite: access.project.status !== "archived" && ["admin", "student"].includes(access.role), canWatch: access.project.status !== "archived", materials,
    materialOptions: [...resources.map((r) => ({ ...r, kind: "resource" as const })), ...versions.map((v) => ({ id: v.id, title: `${v.title} · 正式版本 ${v.number}`, kind: "deliverable" as const }))] };
}

export async function addChecklistItem(actorId: string, projectId: string, taskId: string, input: { requestId: string; text: string }): Promise<ChecklistItem> {
  const data = z.strictObject({ requestId: request, text: itemText }).parse(input);
  return mutate(actorId, projectId, taskId, data.requestId, "task.checklist.add", data, "task", async (tx) => {
    const [count] = await tx.select({ count: sql<number>`count(*)::int`, order: sql<number>`coalesce(max(${taskChecklistItems.sortOrder}), -1)::int` }).from(taskChecklistItems).where(eq(taskChecklistItems.taskId, taskId));
    if (count.count >= 50) throw new ValidationError("每个任务最多 50 条检查项");
    const [item] = await tx.insert(taskChecklistItems).values({ taskId, text: data.text, createdById: actorId, sortOrder: count.order + 1 }).returning();
    await recordEnhancement(tx, actorId, projectId, taskId, data.requestId, "task.checklist.added", "添加了任务检查项");
    return { id: item.id, text: item.text, checked: item.checked, revision: item.revision };
  });
}

export async function updateChecklistItem(actorId: string, projectId: string, taskId: string, input: { requestId: string; itemId: string; expectedRevision: number; text?: string; checked?: boolean }): Promise<ChecklistItem> {
  const data = z.strictObject({ requestId: request, itemId: z.uuid(), expectedRevision: revision, text: itemText.optional(), checked: z.boolean().optional() }).refine((v) => v.text !== undefined || v.checked !== undefined, "请提供修改内容").parse(input);
  return mutate(actorId, projectId, taskId, data.requestId, "task.checklist.update", data, "task", async (tx) => {
    const [item] = await tx.select().from(taskChecklistItems).where(and(eq(taskChecklistItems.id, data.itemId), eq(taskChecklistItems.taskId, taskId))).for("update");
    if (!item) throw new NotFoundError("检查项不存在");
    if (item.revision !== data.expectedRevision) throw new ConflictError("检查项已被修改，请刷新后重试");
    const [updated] = await tx.update(taskChecklistItems).set({ ...(data.text !== undefined && { text: data.text }), ...(data.checked !== undefined && { checked: data.checked }), revision: item.revision + 1, updatedAt: new Date() }).where(eq(taskChecklistItems.id, item.id)).returning();
    await recordEnhancement(tx, actorId, projectId, taskId, data.requestId, "task.checklist.updated", "更新了任务检查项");
    return { id: updated.id, text: updated.text, checked: updated.checked, revision: updated.revision };
  });
}

export async function deleteChecklistItem(actorId: string, projectId: string, taskId: string, input: { requestId: string; itemId: string; expectedRevision: number }) {
  const data = z.strictObject({ requestId: request, itemId: z.uuid(), expectedRevision: revision }).parse(input);
  return mutate(actorId, projectId, taskId, data.requestId, "task.checklist.delete", data, "task", async (tx) => {
    const [item] = await tx.select().from(taskChecklistItems).where(and(eq(taskChecklistItems.id, data.itemId), eq(taskChecklistItems.taskId, taskId))).for("update");
    if (!item) throw new NotFoundError("检查项不存在");
    if (item.revision !== data.expectedRevision) throw new ConflictError("检查项已被修改，请刷新后重试");
    await tx.delete(taskChecklistItems).where(eq(taskChecklistItems.id, item.id));
    await recordEnhancement(tx, actorId, projectId, taskId, data.requestId, "task.checklist.deleted", "删除了任务检查项");
    return { deletedId: item.id };
  });
}

export async function setTaskWatching(actorId: string, projectId: string, taskId: string, input: { requestId: string; watching: boolean }) {
  const data = z.strictObject({ requestId: request, watching: z.boolean() }).parse(input);
  return mutate(actorId, projectId, taskId, data.requestId, "task.watch", data, "watch", async (tx) => {
    if (data.watching) await tx.insert(taskWatchers).values({ taskId, userId: actorId }).onConflictDoNothing();
    else await tx.delete(taskWatchers).where(and(eq(taskWatchers.taskId, taskId), eq(taskWatchers.userId, actorId)));
    return { watching: data.watching };
  });
}

export async function getProjectDoingLimit(actorId: string, projectId: string): Promise<ProjectDoingLimit> {
  const access = await readAccess(actorId, projectId);
  const [[settings], [count]] = await Promise.all([
    db.select().from(projectTaskSettings).where(eq(projectTaskSettings.projectId, projectId)),
    db.select({ value: sql<number>`count(*)::int` }).from(tasks).where(and(eq(tasks.projectId, projectId), eq(tasks.status, "doing"), isNull(tasks.parentTaskId))),
  ]);
  const doingLimit = settings?.doingLimit ?? null;
  return { projectId, doingLimit, revision: settings?.revision ?? 0, doingCount: count.value, exceeded: doingLimit !== null && count.value > doingLimit, canManage: access.role === "admin" && access.project.status !== "archived" };
}

export async function setProjectDoingLimit(actorId: string, projectId: string, input: { requestId: string; expectedRevision: number; doingLimit: number | null }) {
  identity.parse({ actorId, projectId });
  const data = z.strictObject({ requestId: request, expectedRevision: z.number().int().nonnegative(), doingLimit: z.number().int().min(1).max(99).nullable() }).parse(input);
  return db.transaction(async (tx) => {
    // Lock the project before checking/creating the optional settings row.
    await tx.select({ id: projects.id }).from(projects).where(eq(projects.id, projectId)).for("update");
    await lockedAccess(tx, actorId, projectId, "settings");
    const claim = await claimWriteRequest(tx, { actorId, projectId, operation: "project.doing-limit", requestId: data.requestId }, hashRequest(data));
    if (claim.replay) return claim.result as ProjectDoingLimit;
    const [settings] = await tx.select().from(projectTaskSettings).where(eq(projectTaskSettings.projectId, projectId));
    if ((settings?.revision ?? 0) !== data.expectedRevision) throw new ConflictError("任务数量提醒已被修改，请刷新后重试");
    if (settings) await tx.update(projectTaskSettings).set({ doingLimit: data.doingLimit, revision: settings.revision + 1, updatedAt: new Date() }).where(eq(projectTaskSettings.projectId, projectId));
    else await tx.insert(projectTaskSettings).values({ projectId, doingLimit: data.doingLimit });
    const [count] = await tx.select({ value: sql<number>`count(*)::int` }).from(tasks).where(and(eq(tasks.projectId, projectId), eq(tasks.status, "doing"), isNull(tasks.parentTaskId)));
    const result: ProjectDoingLimit = { projectId, doingLimit: data.doingLimit, revision: (settings?.revision ?? 0) + 1, doingCount: count.value,
      exceeded: data.doingLimit !== null && count.value > data.doingLimit, canManage: true };
    return finishWriteRequest(tx, claim.id, result);
  });
}

export async function linkTaskMaterial(actorId: string, projectId: string, taskId: string, input: { requestId: string; kind: "resource" | "deliverable"; sourceId: string }) {
  const data = z.strictObject({ requestId: request, kind: z.enum(["resource", "deliverable"]), sourceId: z.uuid() }).parse(input);
  return mutate(actorId, projectId, taskId, data.requestId, "task.material.link", data, "task", async (tx) => {
    if (data.kind === "resource") {
      const [source] = await tx.select({ id: projectReferences.id }).from(projectReferences).where(and(eq(projectReferences.id, data.sourceId), eq(projectReferences.projectId, projectId))).for("share");
      if (!source) throw new ForbiddenError("资料不存在或不属于该项目");
    } else {
      const [source] = await tx.select({ id: deliverableVersions.id }).from(deliverableVersions).innerJoin(deliverables, eq(deliverables.id, deliverableVersions.deliverableId))
        .where(and(eq(deliverableVersions.id, data.sourceId), eq(deliverables.projectId, projectId))).for("share");
      if (!source) throw new ForbiddenError("只能关联本项目已提交的正式成果版本");
    }
    const existing = await tx.select({ id: taskMaterialLinks.id }).from(taskMaterialLinks).where(and(eq(taskMaterialLinks.taskId, taskId), data.kind === "resource" ? eq(taskMaterialLinks.resourceId, data.sourceId) : eq(taskMaterialLinks.deliverableVersionId, data.sourceId)));
    if (existing[0]) return { id: existing[0].id };
    const [count] = await tx.select({ value: sql<number>`count(*)::int` }).from(taskMaterialLinks).where(eq(taskMaterialLinks.taskId, taskId));
    if (count.value >= 50) throw new ValidationError("每个任务最多关联 50 份资料");
    const [link] = await tx.insert(taskMaterialLinks).values({ taskId, createdById: actorId, ...(data.kind === "resource" ? { resourceId: data.sourceId } : { deliverableVersionId: data.sourceId }) }).returning({ id: taskMaterialLinks.id });
    await recordEnhancement(tx, actorId, projectId, taskId, data.requestId, "task.material.linked", "关联了任务资料");
    return link;
  });
}

export async function unlinkTaskMaterial(actorId: string, projectId: string, taskId: string, input: { requestId: string; linkId: string; expectedRevision: number }) {
  const data = z.strictObject({ requestId: request, linkId: z.uuid(), expectedRevision: revision }).parse(input);
  return mutate(actorId, projectId, taskId, data.requestId, "task.material.unlink", data, "task", async (tx) => {
    const [link] = await tx.select().from(taskMaterialLinks).where(and(eq(taskMaterialLinks.id, data.linkId), eq(taskMaterialLinks.taskId, taskId))).for("update");
    if (!link) throw new NotFoundError("关联不存在");
    if (link.revision !== data.expectedRevision) throw new ConflictError("关联已变化，请刷新后重试");
    await tx.delete(taskMaterialLinks).where(eq(taskMaterialLinks.id, link.id));
    await recordEnhancement(tx, actorId, projectId, taskId, data.requestId, "task.material.unlinked", "解除了任务资料关联");
    return { deletedId: link.id };
  });
}
