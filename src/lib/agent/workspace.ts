import { and, desc, eq, inArray, isNull, or } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { assistantMemories, conversations, messages, projects, teamMembers } from "@/db/schema";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { readProject } from "@/lib/project-read";
import { listBoundedConversationMessages, requireScopedConversation } from "./context";

export async function listPersonalConversations(actorId: string) {
  return db.select({ id: conversations.id, title: conversations.title, projectId: conversations.projectId, projectName: projects.name, createdAt: conversations.createdAt }).from(conversations)
    .innerJoin(projects, eq(projects.id, conversations.projectId)).innerJoin(teamMembers, and(eq(teamMembers.teamId, projects.teamId), eq(teamMembers.userId, actorId)))
    .where(and(eq(conversations.createdById, actorId), eq(conversations.scope, "personal"))).orderBy(desc(conversations.createdAt), desc(conversations.id)).limit(100);
}
export async function listPersonalMemories(actorId: string) {
  return db.select().from(assistantMemories).where(and(eq(assistantMemories.userId, actorId), or(isNull(assistantMemories.projectId),
    // An inaccessible project memory is not even returned to the assistant UI.
    eq(assistantMemories.projectId, db.select({ id: projects.id }).from(projects).innerJoin(teamMembers, and(eq(teamMembers.teamId, projects.teamId), eq(teamMembers.userId, actorId))).where(eq(projects.id, assistantMemories.projectId)).limit(1)))))
    .orderBy(desc(assistantMemories.updatedAt), assistantMemories.id).limit(100);
}
export async function personalMemoryContext(actorId: string, projectId: string) {
  return readProject(actorId, projectId, async tx => {
    const rows = await tx.select({ content: assistantMemories.content }).from(assistantMemories).where(and(eq(assistantMemories.userId, actorId), eq(assistantMemories.enabled, true), or(isNull(assistantMemories.projectId), eq(assistantMemories.projectId, projectId)))).orderBy(desc(assistantMemories.updatedAt)).limit(30);
    return rows.map(r => r.content).join("\n").slice(0, 6000);
  });
}
export async function mutateAssistantWorkspace(actorId: string, input: unknown) {
  const d = z.discriminatedUnion("op", [
    z.object({ op: z.literal("create"), projectId: z.uuid() }),
    z.object({ op: z.literal("rename"), conversationId: z.uuid(), projectId: z.uuid(), title: z.string().trim().min(1).max(100) }),
    z.object({ op: z.literal("delete"), conversationId: z.uuid(), projectId: z.uuid() }),
    z.object({ op: z.literal("memory"), id: z.uuid().optional(), projectId: z.uuid().nullable(), content: z.string().trim().min(1).max(1000), enabled: z.boolean() }),
    z.object({ op: z.literal("forget"), id: z.uuid() }),
  ]).parse(input);
  if (d.op === "create") return readProject(actorId, d.projectId, async tx => (await tx.insert(conversations).values({ projectId: d.projectId, createdById: actorId, scope: "personal", title: "新对话" }).returning({ id: conversations.id }))[0]);
  if (d.op === "delete" || d.op === "rename") {
    await requireScopedConversation(actorId, d.projectId, d.conversationId, "personal");
    return readProject(actorId, d.projectId, async tx => {
      const where = and(eq(conversations.id, d.conversationId), eq(conversations.createdById, actorId), eq(conversations.scope, "personal"));
      if (d.op === "delete") await tx.delete(conversations).where(where);
      else await tx.update(conversations).set({ title: d.title }).where(where);
      return { ok: true };
    });
  }
  if (d.op === "forget") { await db.delete(assistantMemories).where(and(eq(assistantMemories.id, d.id), eq(assistantMemories.userId, actorId))); return { ok: true }; }
  const save = async (tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) => {
    const count = await tx.select({ id: assistantMemories.id }).from(assistantMemories).where(eq(assistantMemories.userId, actorId));
    if (!d.id && count.length >= 100) throw new ValidationError("最多保留100条记忆，请先整理已有内容");
    if (d.id) {
      const [row] = await tx.update(assistantMemories).set({ content: d.content, projectId: d.projectId, enabled: d.enabled, updatedAt: new Date() }).where(and(eq(assistantMemories.id, d.id), eq(assistantMemories.userId, actorId))).returning({ id: assistantMemories.id });
      if (!row) throw new NotFoundError(); return row;
    }
    return (await tx.insert(assistantMemories).values({ userId: actorId, content: d.content, projectId: d.projectId, enabled: d.enabled }).returning({ id: assistantMemories.id }))[0];
  };
  return d.projectId ? readProject(actorId, d.projectId, save) : db.transaction(save);
}
export async function personalWorkspaceHistory(actorId: string, conversationId: string, projectId: string) {
  await requireScopedConversation(actorId, projectId, conversationId, "personal");
  const history = await listBoundedConversationMessages(actorId, conversationId, { limit: 40 });
  return readProject(actorId, projectId, async tx => {
    const rows = history.items.length ? await tx.select({ id: messages.id, trace: messages.toolCalls }).from(messages).where(and(eq(messages.conversationId, conversationId), inArray(messages.id, history.items.map(m => m.id)))) : [];
    return { ...history, items: history.items.map(m => ({ ...m, drafts: ((rows.find(r => r.id === m.id)?.trace ?? []) as { output?: unknown }[]).map(t => t.output).filter((d): d is { __draft: true; requestId?: string; tool: string; draft: unknown } => !!d && typeof d === "object" && (d as { __draft?: boolean }).__draft === true && JSON.stringify(d).length < 30000).slice(0, 10) })) };
  });
}
