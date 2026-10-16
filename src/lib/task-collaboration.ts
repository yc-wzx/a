import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { type DbTx } from "@/db";
import { collaborationReads, collaborationReactions, projects, taskAssignees, taskComments, taskDiscussionInvites, taskDiscussionMessages, tasks, teamMembers, users } from "@/db/schema";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "./errors";
import { readProject } from "./project-read";

export type CollaborationChannel = "team" | "discussion";
async function access(tx: DbTx, actorId: string, projectId: string, taskId: string, write = false) {
  const [task] = await tx.select().from(tasks).where(and(eq(tasks.id, taskId), eq(tasks.projectId, projectId))).for("share");
  if (!task) throw new NotFoundError("任务不存在");
  const [project] = await tx.select().from(projects).where(eq(projects.id, projectId));
  if (write && project.status === "archived") throw new ForbiddenError("归档项目只可查看");
  const members = await tx.select({ id: users.id, name: users.name }).from(teamMembers).innerJoin(users, eq(users.id, teamMembers.userId)).where(eq(teamMembers.teamId, project.teamId));
  const executors = await tx.select().from(taskAssignees).where(eq(taskAssignees.taskId, taskId)).for("share");
  const invites = await tx.select().from(taskDiscussionInvites).where(eq(taskDiscussionInvites.taskId, taskId)).for("share");
  const ids = new Set([task.createdById, task.assigneeId, ...executors.map(r => r.userId), ...invites.map(r => r.userId)]);
  const participants = members.filter(m => ids.has(m.id));
  return { task, members, participants, canDiscuss: participants.some(m => m.id === actorId), canWrite: project.status !== "archived" };
}
// No teacher/admin bypass: every private read, write and replay checks current participation.
export async function getTaskCollaboration(actorId: string, projectId: string, taskId: string, before?: string) {
  if (before) z.iso.datetime().parse(before);
  return readProject(actorId, projectId, async tx => {
    const a = await access(tx, actorId, projectId, taskId);
    const rows = a.canDiscuss ? await tx.select({ id: taskDiscussionMessages.id, body: taskDiscussionMessages.body, authorId: users.id, authorName: users.name, replyToId: taskDiscussionMessages.replyToId, mentionedUserIds: taskDiscussionMessages.mentionedUserIds, createdAt: taskDiscussionMessages.createdAt }).from(taskDiscussionMessages).innerJoin(users, eq(users.id, taskDiscussionMessages.authorId)).where(and(eq(taskDiscussionMessages.taskId, taskId), before ? sql`${taskDiscussionMessages.createdAt} < ${before}::timestamptz` : undefined)).orderBy(desc(taskDiscussionMessages.createdAt), desc(taskDiscussionMessages.id)).limit(101) : [];
    const publicIds = await tx.select({ id: taskComments.id }).from(taskComments).where(and(eq(taskComments.taskId, taskId), isNull(taskComments.deletedAt)));
    const permitted = [...publicIds.map(m => m.id), ...rows.map(m => m.id)];
    const reactions = permitted.length ? await tx.select().from(collaborationReactions).where(inArray(collaborationReactions.messageId, permitted)) : [];
    const read = await tx.select().from(collaborationReads).where(and(eq(collaborationReads.taskId, taskId), eq(collaborationReads.userId, actorId)));
    const [publicUnread] = await tx.select({ count: sql<number>`count(*)::int` }).from(taskComments).where(and(eq(taskComments.taskId, taskId), isNull(taskComments.deletedAt), sql`${taskComments.authorId} <> ${actorId}`, sql`${taskComments.createdAt} > ${(read.find(r => r.channel === "team")?.readAt ?? new Date(0)).toISOString()}::timestamptz`));
    return { actorId, canWrite: a.canWrite, canDiscuss: a.canDiscuss, canManageDiscussion: a.canDiscuss && a.task.createdById === actorId,
      invitedUserIds: a.canDiscuss ? (await tx.select().from(taskDiscussionInvites).where(eq(taskDiscussionInvites.taskId, taskId))).map(r => r.userId) : [], members: a.members,
      participants: a.canDiscuss ? a.participants : [], messages: rows.slice(0, 100).reverse().map(m => ({ ...m, createdAt: m.createdAt.toISOString() })), hasMore: rows.length > 100,
      reactions, unread: { team: publicUnread.count, discussion: a.canDiscuss ? rows.filter(m => m.authorId !== actorId && m.createdAt > (read.find(r => r.channel === "discussion")?.readAt ?? new Date(0))).length : 0 } };
  });
}
export async function sendTaskDiscussion(actorId: string, projectId: string, taskId: string, input: unknown) {
  const d = z.object({ requestId: z.uuid(), body: z.string().trim().min(1).max(10000), replyToId: z.uuid().nullish(), mentionedUserIds: z.array(z.uuid()).max(30).default([]) }).parse(input);
  return readProject(actorId, projectId, async tx => {
    const a = await access(tx, actorId, projectId, taskId, true);
    if (!a.canDiscuss) throw new ForbiddenError("仅任务讨论成员可访问");
    if (d.mentionedUserIds.some(id => !a.participants.some(m => m.id === id))) throw new ValidationError("只能提及讨论成员");
    if (d.replyToId && !(await tx.select().from(taskDiscussionMessages).where(and(eq(taskDiscussionMessages.id, d.replyToId), eq(taskDiscussionMessages.taskId, taskId)))).length) throw new NotFoundError("回复目标不存在");
    // Advisory lock prevents a retry racing the original send from creating duplicates.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${actorId + d.requestId},0))`);
    const [existing] = await tx.select().from(taskDiscussionMessages).where(and(eq(taskDiscussionMessages.authorId, actorId), eq(taskDiscussionMessages.requestId, d.requestId)));
    if (existing) {
      if (existing.taskId !== taskId || existing.body !== d.body || existing.replyToId !== (d.replyToId ?? null) || JSON.stringify(existing.mentionedUserIds) !== JSON.stringify(d.mentionedUserIds)) throw new ConflictError("请求内容已变化，请重新发送");
      return { id: existing.id };
    }
    const [row] = await tx.insert(taskDiscussionMessages).values({ ...d, taskId, authorId: actorId }).returning({ id: taskDiscussionMessages.id });
    // Private messages deliberately never enter shared notifications, evidence or AI context.
    return row;
  });
}
export async function mutateCollaboration(actorId: string, projectId: string, taskId: string, input: unknown) {
  const d = z.discriminatedUnion("op", [
    z.object({ op: z.literal("read"), channel: z.enum(["team", "discussion"]) }),
    z.object({ op: z.literal("react"), channel: z.enum(["team", "discussion"]), messageId: z.uuid(), enabled: z.boolean() }),
    z.object({ op: z.literal("invite"), userId: z.uuid(), enabled: z.boolean() }),
  ]).parse(input);
  return readProject(actorId, projectId, async tx => {
    const a = await access(tx, actorId, projectId, taskId, d.op !== "read");
    if ((d.op === "invite" || d.channel === "discussion") && !a.canDiscuss) throw new ForbiddenError();
    if (d.op === "invite") {
      if (a.task.createdById !== actorId) throw new ForbiddenError("仅发起人可管理额外讨论成员");
      if (!a.members.some(m => m.id === d.userId)) throw new ValidationError("请选择当前团队成员");
      if (d.enabled) await tx.insert(taskDiscussionInvites).values({ taskId, userId: d.userId }).onConflictDoNothing();
      else await tx.delete(taskDiscussionInvites).where(and(eq(taskDiscussionInvites.taskId, taskId), eq(taskDiscussionInvites.userId, d.userId)));
    } else if (d.op === "read") {
      await tx.insert(collaborationReads).values({ taskId, userId: actorId, channel: d.channel }).onConflictDoUpdate({ target: [collaborationReads.taskId, collaborationReads.channel, collaborationReads.userId], set: { readAt: sql`now()` } });
    } else {
      const table = d.channel === "team" ? taskComments : taskDiscussionMessages;
      const [message] = await tx.select({ id: table.id }).from(table).where(and(eq(table.id, d.messageId), eq(table.taskId, taskId), d.channel === "team" ? isNull(taskComments.deletedAt) : undefined));
      if (!message) throw new NotFoundError("消息不存在");
      if (d.enabled) await tx.insert(collaborationReactions).values({ messageId: d.messageId, userId: actorId, channel: d.channel }).onConflictDoNothing();
      else await tx.delete(collaborationReactions).where(and(eq(collaborationReactions.messageId, d.messageId), eq(collaborationReactions.userId, actorId), eq(collaborationReactions.channel, d.channel)));
    }
    return { ok: true };
  });
}
