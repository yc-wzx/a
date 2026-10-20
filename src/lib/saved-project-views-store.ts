import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { accountProjectViews } from "@/db/calendar-integrations-schema";
import { projects, teamMembers } from "@/db/schema";
import { ConflictError, ForbiddenError, ValidationError } from "./errors";
import { readSavedViews, MAX_SAVED_VIEWS } from "./project-views";

async function membership(tx: Parameters<Parameters<typeof db.transaction>[0]>[0], actor: string, project: string) {
  const rows = await tx.select({ id: projects.id }).from(projects).innerJoin(teamMembers, eq(teamMembers.teamId, projects.teamId)).where(and(eq(projects.id, project), eq(teamMembers.userId, actor))).for("share", { of: [projects, teamMembers] });
  if (!rows.length) throw new ForbiddenError();
}
export async function getAccountProjectViews(actor: string, project: string) {
  z.uuid().parse(actor); z.uuid().parse(project);
  return db.transaction(async tx => {
    await membership(tx, actor, project);
    const [row] = await tx.select().from(accountProjectViews).where(and(eq(accountProjectViews.userId, actor), eq(accountProjectViews.projectId, project)));
    return { views: row?.views ?? [], revision: row?.revision ?? 0 };
  });
}
export async function saveAccountProjectViews(actor: string, project: string, input: unknown) {
  z.uuid().parse(actor); z.uuid().parse(project);
  const data = z.strictObject({ expectedRevision: z.number().int().min(0), views: z.array(z.strictObject({ id: z.string(), name: z.string(), query: z.string() })).max(MAX_SAVED_VIEWS) }).parse(input);
  const views = readSavedViews(JSON.stringify(data.views));
  if (views.length !== data.views.length || new Set(views.map(v => v.name)).size !== views.length) throw new ValidationError("筛选名称或内容不合法，请核对后重试");
  return db.transaction(async tx => {
    await membership(tx, actor, project);
    await tx.insert(accountProjectViews).values({ userId: actor, projectId: project }).onConflictDoNothing();
    const [row] = await tx.select().from(accountProjectViews).where(and(eq(accountProjectViews.userId, actor), eq(accountProjectViews.projectId, project))).for("update");
    if (row.revision !== data.expectedRevision) throw new ConflictError("另一设备已更新常用筛选，请重新加载后再保存");
    await tx.update(accountProjectViews).set({ views, revision: row.revision + 1 }).where(eq(accountProjectViews.id, row.id));
    return { views, revision: row.revision + 1 };
  });
}
