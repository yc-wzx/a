import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users, tasks, notifications } from "@/db/schema";
import { createTeam, joinTeam } from "@/lib/team";
import { createProject } from "@/lib/project";
import { createDocument, getDocumentDetail, getDocumentCollaboration, notifyDocumentMentions, addDocumentComment, changeDocumentComment, updateDocument } from "@/lib/documents";
import { contentToYState, readYState, yDocumentContent, validateDocumentContent } from "@/lib/documents-content";
import { documentCommentMentions } from "@/contracts/document-collaboration";
import { resetDb } from "./helpers";
import { getSchema } from "@tiptap/core";
import { EditorState } from "@tiptap/pm/state";
import { baseDocumentExtensions } from "@/components/documents/extensions";
import { dropDocumentBlock } from "@/components/documents/block-movement";
import { findDocumentMatches } from "@/components/documents/document-find";
const paragraph = (text: string, id = "block-a") => ({ type: "paragraph", attrs: { id }, content: [{ type: "text", text }] });
async function scene() {
  const [owner, peer, outsider] = await db.insert(users).values(["owner", "peer", "outsider"].map(name => ({ name, email: `${name}@mentions.test`, passwordHash: "fixture" }))).returning();
  const team = await createTeam(owner.id, "文档协作测试"); await joinTeam(peer.id, team.inviteCode);
  const project = await createProject(owner.id, team.id, { name: "交互设计项目" });
  return { owner, peer, outsider, project };
}
describe("document collaboration access and mentions", () => {
  beforeEach(resetDb);
  it("roundtrips stable mention/task/attachment identities without persisting spoofed names", () => {
    const content = { type: "doc", content: [{ type: "paragraph", content: [{ type: "documentMention", attrs: { userId: randomUUID(), name: "伪造姓名" } }, { type: "documentTaskReference", attrs: { taskId: randomUUID(), title: "伪造标题" } }] }, { type: "documentAttachment", attrs: { attachmentId: randomUUID(), id: "file-a" } }] };
    const ydoc = readYState(contentToYState(content)); try { const result = yDocumentContent(ydoc); expect(JSON.stringify(result)).not.toContain("伪造"); expect(result.content![1].attrs!.id).toBe("file-a"); } finally { ydoc.destroy(); }
    expect(() => validateDocumentContent({ type: "doc", content: [{ type: "documentAttachment", attrs: { attachmentId: "javascript:alert(1)" } }] })).toThrow();
  });
  it("restricts picker members and reference insertion on private documents", async () => {
    const s = await scene(); const doc = await createDocument(s.owner.id, s.project.id, { requestId: randomUUID(), title: "个人草稿", visibility: "private" });
    expect((await getDocumentCollaboration(s.owner.id, s.project.id, doc.id)).members.map(m => m.id)).toEqual([s.owner.id]);
    await expect(getDocumentCollaboration(s.peer.id, s.project.id, doc.id)).rejects.toThrow();
    await expect(createDocument(s.owner.id, s.project.id, { requestId: randomUUID(), title: "不应泄露", visibility: "private", content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "documentMention", attrs: { userId: s.peer.id } }] }] } })).rejects.toThrow("访问权限");
    await expect(createDocument(s.owner.id, s.project.id, { requestId: randomUUID(), title: "跨项目任务", content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "documentTaskReference", attrs: { taskId: randomUUID() } }] }] } })).rejects.toThrow("本项目任务");
    await expect(createDocument(s.owner.id, s.project.id, { requestId: randomUUID(), title: "跨文档文件", content: { type: "doc", content: [{ type: "documentAttachment", attrs: { attachmentId: randomUUID() } }] } })).rejects.toThrow("当前文档");
  });
  it("notifies an actual body mention once, links to its block and refuses stale/wrong targets", async () => {
    const s = await scene(); const doc = await createDocument(s.owner.id, s.project.id, { requestId: randomUUID(), title: "本轮协作", content: { type: "doc", content: [{ type: "paragraph", attrs: { id: "body-mention" }, content: [{ type: "documentMention", attrs: { userId: s.peer.id } }, { type: "text", text: "请确认" }] }] } });
    const detail = await getDocumentDetail(s.owner.id, s.project.id, doc.id);
    const input = { requestId: randomUUID(), expectedRevision: detail.revision, epoch: detail.epoch, blockId: "body-mention", userIds: [s.peer.id] };
    await notifyDocumentMentions(s.owner.id, s.project.id, doc.id, input); await notifyDocumentMentions(s.owner.id, s.project.id, doc.id, input);
    const rows = await db.select().from(notifications).where(eq(notifications.recipientId, s.peer.id));
    expect(rows).toHaveLength(1); expect(rows[0].href).toContain("#block=body-mention");
    await expect(notifyDocumentMentions(s.owner.id, s.project.id, doc.id, { ...input, requestId: randomUUID(), userIds: [s.outsider.id] })).rejects.toThrow();
    await expect(notifyDocumentMentions(s.owner.id, s.project.id, doc.id, { ...input, requestId: randomUUID(), expectedRevision: 999 })).rejects.toThrow("已更新");
    await updateDocument(s.owner.id, s.project.id, doc.id, { requestId: randomUUID(), expectedRevision: detail.revision, visibility: "private" });
    const next = await getDocumentDetail(s.owner.id, s.project.id, doc.id);
    await expect(notifyDocumentMentions(s.owner.id, s.project.id, doc.id, { ...input, requestId: randomUUID(), expectedRevision: next.revision })).rejects.toThrow("访问权限");
  });
  it("supports targeted comment notifications, owner-only edits and optimistic conflicts", async () => {
    const s = await scene(); const doc = await createDocument(s.owner.id, s.project.id, { requestId: randomUUID(), title: "试用反馈" });
    const body = `@[同名同学](member:${s.peer.id}) 请补充截图`;
    expect(documentCommentMentions(body)[0].id).toBe(s.peer.id);
    const input = { requestId: randomUUID(), body }; const comment = await addDocumentComment(s.owner.id, s.project.id, doc.id, input); await addDocumentComment(s.owner.id, s.project.id, doc.id, input);
    const notice = await db.select().from(notifications).where(eq(notifications.recipientId, s.peer.id)); expect(notice).toHaveLength(1); expect(notice[0].href).toContain(`#comment-${comment.id}`);
    await expect(changeDocumentComment(s.peer.id, s.project.id, doc.id, { requestId: randomUUID(), commentId: comment.id, body: "他人修改", expectedBody: body })).rejects.toThrow();
    await changeDocumentComment(s.owner.id, s.project.id, doc.id, { requestId: randomUUID(), commentId: comment.id, body: body + "，谢谢", expectedBody: body });
    await expect(changeDocumentComment(s.owner.id, s.project.id, doc.id, { requestId: randomUUID(), commentId: comment.id, body: "覆盖", expectedBody: body })).rejects.toThrow("已被修改");
    expect((await getDocumentDetail(s.owner.id, s.project.id, doc.id)).comments[0].body).toBe(body + "，谢谢");
    await expect(addDocumentComment(s.owner.id, s.project.id, doc.id, { requestId: randomUUID(), body: `@[外人](member:${s.outsider.id})` })).rejects.toThrow("访问权限");
  });
  it("resolves current task state from the existing project task", async () => {
    const s = await scene(); const [task] = await db.insert(tasks).values({ projectId: s.project.id, title: "修复错误提示", createdById: s.owner.id, status: "doing", assigneeId: s.peer.id, dueDate: "2026-12-01" }).returning();
    const doc = await createDocument(s.owner.id, s.project.id, { requestId: randomUUID(), title: "任务引用", content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "documentTaskReference", attrs: { taskId: task.id } }] }] } });
    expect((await getDocumentCollaboration(s.peer.id, s.project.id, doc.id)).tasks[0]).toMatchObject({ id: task.id, status: "doing", assigneeName: "peer" });
    await db.update(tasks).set({ status: "done", title: "已修复错误提示" }).where(eq(tasks.id, task.id)); expect((await getDocumentCollaboration(s.peer.id, s.project.id, doc.id)).tasks[0].status).toBe("done");
  });
});
describe("document editor transactions", () => {
  it("drops a whole block using identities while preserving nested anchors", () => {
    const schema = getSchema(baseDocumentExtensions()); const doc = schema.nodeFromJSON({ type: "doc", content: [paragraph("第一段", "a"), { type: "blockquote", attrs: { id: "b" }, content: [paragraph("引用", "b-child")] }, paragraph("最后一段", "c")] });
    const state = EditorState.create({ schema, doc }); const tr = dropDocumentBlock(state, "b", "c", true)!; const next = state.apply(tr);
    expect(next.doc.child(2).attrs.id).toBe("b"); expect(next.doc.child(2).child(0).attrs.id).toBe("b-child"); expect(dropDocumentBlock(next, "deleted", "a", false)).toBeNull();
  });
  it("finds text across formatting but never crosses an atomic reference", () => {
    const schema = getSchema(baseDocumentExtensions()); const doc = schema.nodeFromJSON({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "提交" }, { type: "text", text: "失败", marks: [{ type: "bold" }] }, { type: "documentReference", attrs: { documentId: randomUUID() } }, { type: "text", text: "提交失败" }] }] });
    expect(findDocumentMatches(doc, "提交失败")).toEqual([{ from: 1, to: 5 }, { from: 6, to: 10 }]); expect(findDocumentMatches(doc, "失败提交")).toHaveLength(0);
  });
});
