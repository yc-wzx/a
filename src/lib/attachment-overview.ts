import { and, desc, eq, isNotNull, isNull, ne, or, sql } from "drizzle-orm";
import { z } from "zod";
import { projectAttachments as attachments } from "@/db/course-extensions-schema";
import { documentGrants, projectDocuments } from "@/db/documents-schema";
import { deliverables, projects, tasks, teamMembers, users } from "@/db/schema";
import { readProject } from "./project-read";

const inputSchema = z.object({
  query: z.string().trim().max(100).default(""),
  type: z.enum(["all", "project", "task", "document", "deliverable"]).default("all"),
  offset: z.coerce.number().int().min(0).max(100000).default(0),
});
export async function listProjectAttachmentOverview(actorId: string, projectId: string, input: unknown = {}) {
  const filter = inputSchema.parse(input);
  return readProject(actorId, projectId, async tx => {
    const [member] = await tx.select({ role: teamMembers.role }).from(teamMembers)
      .innerJoin(projects, eq(projects.teamId, teamMembers.teamId))
      .where(and(eq(projects.id, projectId), eq(teamMembers.userId, actorId)));
    const admin = member.role === "admin";
    const sourceTitle = sql<string>`coalesce(${tasks.title}, ${projectDocuments.title}, ${deliverables.title}, '项目资料')`;
    const rows = await tx.select({ id: attachments.id, filename: attachments.filename,
      size: attachments.size, createdAt: attachments.createdAt,
      sourceType: attachments.targetType, sourceId: attachments.targetId,
      sourceTitle, uploaderName: users.name,
    }).from(attachments)
      .leftJoin(users, eq(users.id, attachments.ownerId))
      .leftJoin(tasks, and(eq(attachments.targetType, "task"), eq(tasks.id, attachments.targetId), eq(tasks.projectId, projectId)))
      .leftJoin(projectDocuments, and(eq(attachments.targetType, "document"), eq(projectDocuments.id, attachments.targetId), eq(projectDocuments.projectId, projectId)))
      .leftJoin(documentGrants, and(eq(documentGrants.documentId, projectDocuments.id), eq(documentGrants.userId, actorId)))
      .leftJoin(deliverables, and(eq(attachments.targetType, "deliverable"), eq(deliverables.id, attachments.targetId), eq(deliverables.projectId, projectId)))
      .where(and(eq(attachments.projectId, projectId), isNull(attachments.deletedAt),
        filter.type !== "all" ? eq(attachments.targetType, filter.type) : undefined,
        filter.query ? sql`position(lower(${filter.query}) in lower(${attachments.filename} || ' ' || coalesce(${users.name}, '') || ' ' || ${sourceTitle})) > 0` : undefined,
        or(
          and(eq(attachments.targetType, "project"), eq(attachments.targetId, projectId)),
          and(eq(attachments.targetType, "task"), isNotNull(tasks.id)),
          and(eq(attachments.targetType, "document"), isNotNull(projectDocuments.id), isNull(projectDocuments.deletedAt),
            or(eq(projectDocuments.ownerId, actorId), eq(projectDocuments.visibility, "project"), isNotNull(documentGrants.userId))),
          and(eq(attachments.targetType, "deliverable"), isNotNull(deliverables.id),
            or(ne(deliverables.status, "draft"), eq(deliverables.authorId, actorId), sql`${admin}`),
            or(isNotNull(attachments.publishedAt), eq(attachments.ownerId, actorId), sql`${admin}`)),
        ),
      )).orderBy(desc(attachments.createdAt), desc(attachments.id)).limit(51).offset(filter.offset);
    return { items: rows.slice(0, 50).map(row => ({ ...row,
      createdAt: row.createdAt.toISOString(), href: `/api/attachments/${row.id}`,
      sourceHref: row.sourceType === "task" ? `/projects/${projectId}?task=${row.sourceId}`
        : row.sourceType === "document" ? `/projects/${projectId}/documents/${row.sourceId}`
        : row.sourceType === "deliverable" ? `/projects/${projectId}/deliverables/${row.sourceId}`
        : `/projects/${projectId}/references`,
    })), nextOffset: rows.length > 50 ? filter.offset + 50 : null };
  });
}
export type AttachmentOverviewPage = Awaited<ReturnType<typeof listProjectAttachmentOverview>>;
