import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import * as Y from "yjs";
import { db } from "@/db";
import { externalNotificationDeliveries, projects, teamMembers, users } from "@/db/schema";
import { createTeam, joinTeam, updateMemberRole } from "@/lib/team";
import { createProject } from "@/lib/project";
import { addDocumentComment, changeDocumentComment, confirmDocument, createDocument, createDocumentVersion, getDocumentConfirmation, getDocumentDetail, requestDocumentConfirmation, restoreDocumentVersion, syncDocument, trashDocument, updateDocument } from "@/lib/documents";
import { getUnreadNotificationCount, listMyNotifications, markNotificationRead } from "@/lib/notifications";
import { readYState } from "@/lib/documents-content";
import { resetDb } from "./helpers";

async function scene(privateDoc = false) {
  const [owner, peer, teacher, stranger] = await db.insert(users).values(["owner", "peer", "teacher", "stranger"].map(name => ({ name, email: `${name}@document-extensions.test`, passwordHash: "fixture" }))).returning();
  const team = await createTeam(owner.id, "文档确认测试");
  for (const user of [peer, teacher]) await joinTeam(user.id, team.inviteCode);
  await updateMemberRole(owner.id, team.id, teacher.id, "teacher");
  const project = await createProject(owner.id, team.id, { name: "课程协作" });
  const doc = await createDocument(owner.id, project.id, { requestId: randomUUID(), title: "需求正文", visibility: privateDoc ? "private" : "project", content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "需要核对的正文" }] }] } });
  return { owner, peer, teacher, stranger, team, project, doc };
}
async function request(s: Awaited<ReturnType<typeof scene>>, reviewerIds = [s.peer.id]) {
  const detail = await getDocumentDetail(s.owner.id, s.project.id, s.doc.id);
  const input = { requestId: randomUUID(), expectedRevision: detail.revision, epoch: detail.epoch, reviewerIds };
  return { input, round: await requestDocumentConfirmation(s.owner.id, s.project.id, s.doc.id, input) };
}
async function editBody(s: Awaited<ReturnType<typeof scene>>, text: string) {
  const detail = await getDocumentDetail(s.owner.id, s.project.id, s.doc.id), doc = readYState(detail.state);
  try { const vector = Y.encodeStateVector(doc); const paragraph = doc.getXmlFragment("default").get(0) as Y.XmlElement;
    (paragraph.get(0) as Y.XmlText).insert(0, text);
    return await syncDocument(s.owner.id, s.project.id, s.doc.id, { sessionId: randomUUID(), epoch: detail.epoch, update: Buffer.from(Y.encodeStateAsUpdate(doc, vector)).toString("base64") });
  } finally { doc.destroy(); }
}

describe("document confirmation and in-app notifications: real database ACL", () => {
  beforeEach(async () => {
    await resetDb();
  });
  it("requests a saved version once and allows an invited read-only teacher to confirm", async () => {
    const s = await scene(); const { input, round } = await request(s, [s.peer.id, s.teacher.id]);
    expect(await requestDocumentConfirmation(s.owner.id, s.project.id, s.doc.id, input)).toEqual(round);
    expect((await listMyNotifications(s.peer.id)).items.filter(n => n.type === "document.confirmation_requested")).toHaveLength(1);
    const current = await getDocumentDetail(s.teacher.id, s.project.id, s.doc.id);
    const data = { requestId: randomUUID(), expectedRevision: current.revision, epoch: current.epoch, roundId: round.id };
    await confirmDocument(s.teacher.id, s.project.id, s.doc.id, data); await confirmDocument(s.teacher.id, s.project.id, s.doc.id, data);
    const state = await getDocumentConfirmation(s.owner.id, s.project.id, s.doc.id);
    expect(state.round?.participants.find(p => p.id === s.teacher.id)?.confirmedAt).toBeTruthy();
    expect((await listMyNotifications(s.owner.id)).items.filter(n => n.type === "document.confirmed")).toHaveLength(1);
    expect(await db.select().from(externalNotificationDeliveries)).toHaveLength(0);
  });
  it("metadata edits keep confirmation valid, body edits invalidate once and reject old confirmations", async () => {
    const s = await scene(); const { round } = await request(s);
    await updateDocument(s.owner.id, s.project.id, s.doc.id, { requestId: randomUUID(), expectedRevision: 1, title: "新标题" });
    expect((await getDocumentConfirmation(s.peer.id, s.project.id, s.doc.id)).round?.stale).toBe(false);
    await editBody(s, "更新一"); await editBody(s, "更新二");
    const current = await getDocumentDetail(s.peer.id, s.project.id, s.doc.id);
    expect((await getDocumentConfirmation(s.peer.id, s.project.id, s.doc.id)).round?.stale).toBe(true);
    await expect(confirmDocument(s.peer.id, s.project.id, s.doc.id, { requestId: randomUUID(), expectedRevision: current.revision, epoch: current.epoch, roundId: round.id })).rejects.toThrow("正文已更新");
    expect((await listMyNotifications(s.peer.id)).items.filter(n => n.type === "document.confirmation_stale")).toHaveLength(1);
    await request(s); expect((await getDocumentConfirmation(s.peer.id, s.project.id, s.doc.id)).canConfirm).toBe(true);
  });
  it("rejects private recipients, unrelated members, non-editors and uninvited confirmation", async () => {
    const s = await scene(true);
    await expect(request(s)).rejects.toThrow("访问权限");
    await updateDocument(s.owner.id, s.project.id, s.doc.id, { requestId: randomUUID(), expectedRevision: 1, grants: [{ userId: s.peer.id, permission: "read" }] });
    const { round } = await request(s);
    await expect(request(s, [s.stranger.id])).rejects.toThrow("访问权限");
    const detail = await getDocumentDetail(s.peer.id, s.project.id, s.doc.id);
    await expect(requestDocumentConfirmation(s.peer.id, s.project.id, s.doc.id, { requestId: randomUUID(), expectedRevision: detail.revision, epoch: detail.epoch, reviewerIds: [s.owner.id] })).rejects.toThrow("编辑");
    await expect(confirmDocument(s.owner.id, s.project.id, s.doc.id, { requestId: randomUUID(), expectedRevision: detail.revision, epoch: detail.epoch, roundId: round.id })).rejects.toThrow("名单");
    expect((await listMyNotifications(s.teacher.id)).items).toHaveLength(0);
  });
  it("comment and reply notifications are deduplicated, exclude self and link to the exact comment", async () => {
    const s = await scene(); const input = { requestId: randomUUID(), body: "需要改进导航" };
    const comment = await addDocumentComment(s.peer.id, s.project.id, s.doc.id, input);
    expect(await addDocumentComment(s.peer.id, s.project.id, s.doc.id, input)).toEqual(comment);
    const owner = (await listMyNotifications(s.owner.id)).items;
    expect(owner).toHaveLength(1); expect(owner[0].sourceRef.sourceHref).toContain(`#comment-${comment.id}`);
    expect((await listMyNotifications(s.peer.id)).items).toHaveLength(0);
    await addDocumentComment(s.owner.id, s.project.id, s.doc.id, { requestId: randomUUID(), replyToId: comment.id, body: "已调整" });
    expect((await listMyNotifications(s.peer.id)).items.map(n => n.type)).toEqual(["document.reply"]);
  });
  it("revoking a private grant hides titles, unread counts, direct mark-read and confirmation participants", async () => {
    const s = await scene(true);
    await updateDocument(s.owner.id, s.project.id, s.doc.id, { requestId: randomUUID(), expectedRevision: 1, grants: [{ userId: s.peer.id, permission: "comment" }] });
    await request(s); const [visible] = (await listMyNotifications(s.peer.id)).items;
    expect(visible.summary).toContain("需求正文"); expect((await getUnreadNotificationCount(s.peer.id)).count).toBe(1);
    await updateDocument(s.owner.id, s.project.id, s.doc.id, { requestId: randomUUID(), expectedRevision: 2, grants: [] });
    expect((await listMyNotifications(s.peer.id)).total).toBe(0); expect((await getUnreadNotificationCount(s.peer.id)).count).toBe(0);
    await expect(markNotificationRead(s.peer.id, visible.id)).rejects.toThrow("无权");
    expect((await getDocumentConfirmation(s.owner.id, s.project.id, s.doc.id)).round?.participants).toHaveLength(0);
    await expect(confirmDocument(s.peer.id, s.project.id, s.doc.id, { requestId: randomUUID(), expectedRevision: 3, epoch: 1, roundId: randomUUID() })).rejects.toThrow("访问权限");
  });
  it("deleted comments/documents and membership removal remove accessible notifications", async () => {
    const s = await scene(); const comment = await addDocumentComment(s.peer.id, s.project.id, s.doc.id, { requestId: randomUUID(), body: "反馈" });
    expect((await getUnreadNotificationCount(s.owner.id)).count).toBe(1);
    await changeDocumentComment(s.peer.id, s.project.id, s.doc.id, { requestId: randomUUID(), commentId: comment.id }, true);
    expect((await getUnreadNotificationCount(s.owner.id)).count).toBe(0);
    await request(s); await db.delete(teamMembers).where(and(eq(teamMembers.teamId, s.team.id), eq(teamMembers.userId, s.peer.id)));
    expect((await listMyNotifications(s.peer.id)).total).toBe(0);
    await request(s, [s.teacher.id]);
    await trashDocument(s.owner.id, s.project.id, s.doc.id, { requestId: randomUUID(), expectedRevision: 1 });
    expect((await listMyNotifications(s.teacher.id)).total).toBe(0);
  });
  it("restoring a version invalidates old confirmation even when its text is the same", async () => {
    const s = await scene(); const version = await createDocumentVersion(s.owner.id, s.project.id, s.doc.id, { requestId: randomUUID(), expectedRevision: 1, label: "保存版" });
    await request(s);
    await restoreDocumentVersion(s.owner.id, s.project.id, s.doc.id, version.id, { requestId: randomUUID(), expectedRevision: 1, epoch: 1 });
    const state = await getDocumentConfirmation(s.peer.id, s.project.id, s.doc.id); expect(state.round?.stale).toBe(true);
    expect((await listMyNotifications(s.peer.id)).items.filter(n => n.type === "document.confirmation_stale")).toHaveLength(1);
  });
  it("archiving disables confirmation writes and account switching cannot send a previous user's delta", async () => {
    const s = await scene(); const { round } = await request(s);
    await expect(syncDocument(s.peer.id, s.project.id, s.doc.id, { sessionId: randomUUID(), expectedActorId: s.owner.id, epoch: 1 })).rejects.toThrow("账号已改变");
    await db.update(projects).set({ status: "archived" }).where(eq(projects.id, s.project.id));
    const state = await getDocumentConfirmation(s.peer.id, s.project.id, s.doc.id); expect(state.canConfirm).toBe(false); expect(state.canRequest).toBe(false);
    await expect(confirmDocument(s.peer.id, s.project.id, s.doc.id, { requestId: randomUUID(), expectedRevision: 1, epoch: 1, roundId: round.id })).rejects.toThrow("归档");
    await expect(request(s)).rejects.toThrow("归档");
  });
});
