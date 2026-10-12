import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import * as Y from "yjs";
import { Awareness, encodeAwarenessUpdate } from "y-protocols/awareness";
import { db } from "@/db";
import { projects, teamMembers, users } from "@/db/schema";
import { documentPresence } from "@/db/documents-schema";
import { createTeam, joinTeam, updateMemberRole } from "@/lib/team";
import { createProject } from "@/lib/project";
import { createTask } from "@/lib/task";
import { addDocumentComment, changeDocumentComment, changeDocumentTaskLink, createDocument, createDocumentVersion, exportDocument, getDocumentDetail, getDocumentVersion, listDocuments, previewDocumentAi, restoreDocumentVersion, syncDocument, trashDocument, updateDocument } from "@/lib/documents";
import { contentToYState, documentMarkdown, readYState, validateDocumentContent, yDocumentContent } from "@/lib/documents-content";
import { resetDb } from "./helpers";

const model = vi.hoisted(() => ({ configure: vi.fn(async (actorId: string) => ({ model: "personal", instructions: "我的助手", actorId })), generate: vi.fn(async (options: unknown) => ({ text: "润色后的文字", options })) }));
vi.mock("@/lib/agent/model", () => ({ getConfiguredAssistant: model.configure, personalModelRequest: (run: () => Promise<unknown>) => run() }));
vi.mock("ai", () => ({ generateText: model.generate }));
async function scene() {
  const [owner, peer, teacher, outsider] = await db.insert(users).values(["owner", "peer", "teacher", "outsider"].map(name => ({ name, email: name + "@documents.test", passwordHash: "fixture" }))).returning();
  const team = await createTeam(owner.id, "文档协作试用");
  for (const user of [peer, teacher]) await joinTeam(user.id, team.inviteCode);
  await updateMemberRole(owner.id, team.id, teacher.id, "teacher");
  const project = await createProject(owner.id, team.id, { name: "交互设计课程" });
  const other = await createProject(owner.id, team.id, { name: "另一个项目" });
  const doc = await createDocument(owner.id, project.id, { requestId: randomUUID(), title: "需求文档", content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "核心协作流程" }] }] } });
  return { owner, peer, teacher, outsider, team, project, other, doc };
}
function packet(ydoc: Y.Doc, epoch = 1, update?: Uint8Array) { return { sessionId: randomUUID(), epoch, stateVector: Buffer.from(Y.encodeStateVector(ydoc)).toString("base64"), ...(update ? { update: Buffer.from(update).toString("base64") } : {}) }; }
function insertUpdate(ydoc: Y.Doc, text: string) {
  const vector = Y.encodeStateVector(ydoc);
  const paragraph = ydoc.getXmlFragment("default").get(0) as Y.XmlElement;
  (paragraph.get(0) as Y.XmlText).insert(0, text);
  return Y.encodeStateAsUpdate(ydoc, vector);
}
describe("project documents: real PostgreSQL, Yjs and current access", () => {
  beforeEach(async () => { await resetDb(); model.configure.mockClear(); model.generate.mockClear(); });
  it("creates structured rich content with stable anchors, idempotent requests and body search", async () => {
    const s = await scene();
    const input = { requestId: randomUUID(), title: "设计说明", folder: "设计资料" };
    const first = await createDocument(s.owner.id, s.project.id, input);
    expect(await createDocument(s.owner.id, s.project.id, input)).toEqual(first);
    await expect(createDocument(s.owner.id, s.project.id, { ...input, title: "不同标题" })).rejects.toThrow("不同内容");
    const detail = await getDocumentDetail(s.peer.id, s.project.id, s.doc.id);
    expect(detail.content.content?.[0].attrs?.id).toBeTruthy();
    expect((await listDocuments(s.peer.id, s.project.id, { q: "核心协作" })).items.map(d => d.id)).toEqual([s.doc.id]);
    expect((await listDocuments(s.peer.id, s.project.id, { folder: "设计资料" })).total).toBe(1);
  });
  it("private drafts hide their titles, search hits, counts, task links, export and presence", async () => {
    const s = await scene();
    const privateDoc = await createDocument(s.peer.id, s.project.id, { requestId: randomUUID(), title: "保密草稿", visibility: "private" });
    expect((await listDocuments(s.owner.id, s.project.id, { q: "保密" })).total).toBe(0);
    for (const actor of [s.owner.id, s.teacher.id, s.outsider.id]) {
      await expect(getDocumentDetail(actor, s.project.id, privateDoc.id)).rejects.toThrow();
      await expect(exportDocument(actor, s.project.id, privateDoc.id)).rejects.toThrow();
      await expect(syncDocument(actor, s.project.id, privateDoc.id, { sessionId: randomUUID(), epoch: 1 })).rejects.toThrow();
    }
    await expect(getDocumentDetail(s.peer.id, s.other.id, privateDoc.id)).rejects.toThrow();
  });
  it("enforces read/comment/edit grants, teacher defaults, no unauthorized ACL editing and revoked sessions", async () => {
    const s = await scene();
    expect((await getDocumentDetail(s.teacher.id, s.project.id, s.doc.id)).permission).toBe("comment");
    await expect(updateDocument(s.peer.id, s.project.id, s.doc.id, { requestId: randomUUID(), expectedRevision: 1, visibility: "private" })).rejects.toThrow();
    await updateDocument(s.owner.id, s.project.id, s.doc.id, { requestId: randomUUID(), expectedRevision: 1, grants: [{ userId: s.peer.id, permission: "read" }, { userId: s.teacher.id, permission: "edit" }] });
    expect((await getDocumentDetail(s.teacher.id, s.project.id, s.doc.id)).canEdit).toBe(true);
    const ydoc = readYState((await getDocumentDetail(s.peer.id, s.project.id, s.doc.id)).state);
    try { await expect(syncDocument(s.peer.id, s.project.id, s.doc.id, packet(ydoc, 1, insertUpdate(ydoc, "禁止保存")))).rejects.toThrow("编辑"); } finally { ydoc.destroy(); }
    await expect(addDocumentComment(s.peer.id, s.project.id, s.doc.id, { requestId: randomUUID(), body: "无权评论" })).rejects.toThrow("评论");
    await expect(updateDocument(s.owner.id, s.project.id, s.doc.id, { requestId: randomUUID(), expectedRevision: 2, grants: [{ userId: s.outsider.id, permission: "edit" }] })).rejects.toThrow("当前团队成员");
  });
  it("merges simultaneous edits based on the same old state without losing either client", async () => {
    const s = await scene(); const detail = await getDocumentDetail(s.owner.id, s.project.id, s.doc.id);
    const a = readYState(detail.state), b = readYState(detail.state);
    try {
      const updates = [insertUpdate(a, "甲"), insertUpdate(b, "乙")];
      await Promise.all([syncDocument(s.owner.id, s.project.id, s.doc.id, packet(a, 1, updates[0])), syncDocument(s.peer.id, s.project.id, s.doc.id, packet(b, 1, updates[1]))]);
      const markdown = (await exportDocument(s.owner.id, s.project.id, s.doc.id)).markdown;
      expect(markdown).toContain("甲"); expect(markdown).toContain("乙"); expect(markdown).toContain("核心协作流程");
      const revision = (await getDocumentDetail(s.owner.id, s.project.id, s.doc.id)).revision;
      await syncDocument(s.owner.id, s.project.id, s.doc.id, packet(a, 1, updates[0]));
      expect((await getDocumentDetail(s.owner.id, s.project.id, s.doc.id)).revision).toBe(revision);
    } finally { a.destroy(); b.destroy(); }
  });
  it("version restore records previous content, increments epoch and rejects stale/offline updates", async () => {
    const s = await scene(); const named = await createDocumentVersion(s.owner.id, s.project.id, s.doc.id, { requestId: randomUUID(), expectedRevision: 1, label: "开题版本" });
    const ydoc = readYState((await getDocumentDetail(s.owner.id, s.project.id, s.doc.id)).state);
    try {
      const update = insertUpdate(ydoc, "后期修改"); await syncDocument(s.owner.id, s.project.id, s.doc.id, packet(ydoc, 1, update));
      const restore = { requestId: randomUUID(), expectedRevision: 2, epoch: 1 };
      const restored = await restoreDocumentVersion(s.owner.id, s.project.id, s.doc.id, named.id, restore);
      expect(restored.epoch).toBe(2); expect(await restoreDocumentVersion(s.owner.id, s.project.id, s.doc.id, named.id, restore)).toEqual(restored);
      await expect(syncDocument(s.peer.id, s.project.id, s.doc.id, packet(ydoc, 1, update))).rejects.toThrow("版本已恢复");
      expect((await exportDocument(s.owner.id, s.project.id, s.doc.id)).markdown).not.toContain("后期修改");
      const detail = await getDocumentDetail(s.owner.id, s.project.id, s.doc.id);
      const before = detail.versions.find(v => v.kind === "restore")!;
      expect((await getDocumentVersion(s.owner.id, s.project.id, s.doc.id, before.id)).markdown).toContain("后期修改");
    } finally { ydoc.destroy(); }
  });
  it("paragraph comments keep their quote after deletion, and support resolve/reopen with author permissions", async () => {
    const s = await scene(); const detail = await getDocumentDetail(s.teacher.id, s.project.id, s.doc.id); const blockId = detail.content.content![0].attrs!.id;
    const created = await addDocumentComment(s.teacher.id, s.project.id, s.doc.id, { requestId: randomUUID(), body: "说明异常流程", blockId, quote: "核心协作流程" });
    await changeDocumentComment(s.owner.id, s.project.id, s.doc.id, { requestId: randomUUID(), commentId: created.id, resolved: true });
    expect((await getDocumentDetail(s.teacher.id, s.project.id, s.doc.id)).comments[0].resolvedAt).toBeTruthy();
    await changeDocumentComment(s.teacher.id, s.project.id, s.doc.id, { requestId: randomUUID(), commentId: created.id, resolved: false });
    await expect(changeDocumentComment(s.peer.id, s.project.id, s.doc.id, { requestId: randomUUID(), commentId: created.id }, true)).rejects.toThrow();
    const ydoc = readYState(detail.state); try { const vector = Y.encodeStateVector(ydoc); ydoc.getXmlFragment("default").delete(0, 1); ydoc.getXmlFragment("default").insert(0, [new Y.XmlElement("paragraph")]); await syncDocument(s.owner.id, s.project.id, s.doc.id, packet(ydoc, 1, Y.encodeStateAsUpdate(ydoc, vector))); } finally { ydoc.destroy(); }
    expect((await getDocumentDetail(s.teacher.id, s.project.id, s.doc.id)).comments[0].quote).toBe("核心协作流程");
    await expect(addDocumentComment(s.teacher.id, s.project.id, s.doc.id, { requestId: randomUUID(), body: "已删段落", blockId })).rejects.toThrow("段落");
  });
  it("links only same-project tasks, hides linked private docs, and protects trash/restore", async () => {
    const s = await scene(); const task = await createTask(s.owner.id, s.project.id, { title: "设计评审" });
    await changeDocumentTaskLink(s.peer.id, s.project.id, s.doc.id, { requestId: randomUUID(), taskId: task.id });
    expect((await listDocuments(s.teacher.id, s.project.id, { taskId: task.id })).items).toHaveLength(1);
    const foreign = await createTask(s.owner.id, s.other.id, { title: "跨项目任务" });
    await expect(changeDocumentTaskLink(s.owner.id, s.project.id, s.doc.id, { requestId: randomUUID(), taskId: foreign.id })).rejects.toThrow();
    const deleted = await trashDocument(s.owner.id, s.project.id, s.doc.id, { requestId: randomUUID(), expectedRevision: 1 });
    expect((await listDocuments(s.peer.id, s.project.id, { taskId: task.id })).total).toBe(0);
    await expect(getDocumentDetail(s.peer.id, s.project.id, s.doc.id)).rejects.toThrow("回收站");
    expect((await listDocuments(s.owner.id, s.project.id, { trash: true })).items[0].id).toBe(s.doc.id);
    await trashDocument(s.owner.id, s.project.id, s.doc.id, { requestId: randomUUID(), expectedRevision: deleted.revision, operation: "restore" }, true);
    expect((await getDocumentDetail(s.peer.id, s.project.id, s.doc.id)).content).toBeTruthy();
  });
  it("replies preserve paragraph context, reject foreign parents and do not reveal deleted parent bodies", async () => {
    const s = await scene(); const detail = await getDocumentDetail(s.owner.id, s.project.id, s.doc.id);
    const parent = await addDocumentComment(s.teacher.id, s.project.id, s.doc.id, { requestId: randomUUID(), blockId: detail.content.content![0].attrs!.id, quote: "核心协作流程", body: "需要补充异常流程" });
    const reply = await addDocumentComment(s.peer.id, s.project.id, s.doc.id, { requestId: randomUUID(), replyToId: parent.id, body: "已补充，将在下次展示演示" });
    const next = await getDocumentDetail(s.owner.id, s.project.id, s.doc.id);
    expect(next.comments.find(c => c.id === reply.id)).toMatchObject({ replyToId: parent.id, replyToAuthorName: s.teacher.name, quote: "核心协作流程" });
    const other = await createDocument(s.owner.id, s.project.id, { requestId: randomUUID(), title: "另一篇文档" });
    await expect(addDocumentComment(s.peer.id, s.project.id, other.id, { requestId: randomUUID(), replyToId: parent.id, body: "跨文档回复" })).rejects.toThrow("不属于");
    await changeDocumentComment(s.teacher.id, s.project.id, s.doc.id, { requestId: randomUUID(), commentId: parent.id }, true);
    const after = await getDocumentDetail(s.peer.id, s.project.id, s.doc.id);
    expect(after.comments).toHaveLength(1); expect(after.comments[0].replyToAuthorName).toBeNull(); expect(JSON.stringify(after.comments)).not.toContain("需要补充异常流程");
  });
  it("binds online cursors to authenticated sessions, rejects malformed/duplicate cursor ids and removes departed peers", async () => {
    const s = await scene(); const ydoc = readYState((await getDocumentDetail(s.owner.id, s.project.id, s.doc.id)).state); const awareness = new Awareness(ydoc);
    try {
      awareness.setLocalState({ user: { id: s.outsider.id, name: "伪造身份" }, cursor: null });
      const encoded = Buffer.from(encodeAwarenessUpdate(awareness, [ydoc.clientID])).toString("base64");
      const input = { ...packet(ydoc), awareness: encoded };
      const result = await syncDocument(s.peer.id, s.project.id, s.doc.id, input);
      expect(result.presence[0]).toMatchObject({ userId: s.peer.id, name: s.peer.name });
      await expect(syncDocument(s.owner.id, s.project.id, s.doc.id, { ...input, sessionId: randomUUID() })).rejects.toThrow("光标标识冲突");
      awareness.setLocalStateField("cursor", { anchor: "invalid", head: null });
      await expect(syncDocument(s.peer.id, s.project.id, s.doc.id, { ...input, awareness: Buffer.from(encodeAwarenessUpdate(awareness, [ydoc.clientID])).toString("base64") })).rejects.toThrow("光标");
      await db.delete(teamMembers).where(and(eq(teamMembers.userId, s.peer.id), eq(teamMembers.teamId, s.team.id)));
      expect((await syncDocument(s.owner.id, s.project.id, s.doc.id, packet(ydoc))).presence.map(p => p.userId)).not.toContain(s.peer.id);
      await expect(syncDocument(s.peer.id, s.project.id, s.doc.id, input)).rejects.toThrow();
      expect(await db.select().from(documentPresence)).toHaveLength(2);
    } finally { awareness.destroy(); ydoc.destroy(); }
  });
  it("archived projects remain readable but reject body, comment, ACL, version and trash writes", async () => {
    const s = await scene(); await db.update(projects).set({ status: "archived" }).where(eq(projects.id, s.project.id));
    const detail = await getDocumentDetail(s.owner.id, s.project.id, s.doc.id); expect(detail.canEdit).toBe(false); expect(detail.canManage).toBe(false);
    await expect(createDocumentVersion(s.owner.id, s.project.id, s.doc.id, { requestId: randomUUID(), expectedRevision: 1, label: "归档后" })).rejects.toThrow("归档");
    await expect(addDocumentComment(s.owner.id, s.project.id, s.doc.id, { requestId: randomUUID(), body: "归档后" })).rejects.toThrow("归档");
    await expect(trashDocument(s.owner.id, s.project.id, s.doc.id, { requestId: randomUUID(), expectedRevision: 1 })).rejects.toThrow("归档");
    expect((await syncDocument(s.owner.id, s.project.id, s.doc.id, { sessionId: randomUUID(), epoch: 1 })).permission).toBe("read");
  });
  it("personal AI receives only selected text, returns preview without editing and checks current write permission", async () => {
    const s = await scene(); const preview = await previewDocumentAi(s.peer.id, s.project.id, s.doc.id, { operation: "polish", selection: "核心协作", epoch: 1, revision: 1 });
    expect(model.configure).toHaveBeenCalledWith(s.peer.id); expect(model.generate).toHaveBeenCalledWith(expect.objectContaining({ prompt: "核心协作", model: "personal" })); expect(preview.text).toBe("润色后的文字");
    expect((await getDocumentDetail(s.owner.id, s.project.id, s.doc.id)).revision).toBe(1);
    await expect(previewDocumentAi(s.teacher.id, s.project.id, s.doc.id, { operation: "summarize", selection: "核心协作", epoch: 1, revision: 1 })).rejects.toThrow("编辑");
    await expect(previewDocumentAi(s.peer.id, s.project.id, s.doc.id, { operation: "polish", selection: "其他人的隐私内容", epoch: 1, revision: 1 })).rejects.toThrow("当前文档");
  });
  it("AI rechecks revision after inference so concurrent edits cannot produce an applicable stale preview", async () => {
    const s = await scene(); model.generate.mockImplementationOnce(async (options) => { await updateDocument(s.owner.id, s.project.id, s.doc.id, { requestId: randomUUID(), expectedRevision: 1, title: "并发更新" }); return { text: "过期预览", options }; });
    await expect(previewDocumentAi(s.peer.id, s.project.id, s.doc.id, { operation: "polish", selection: "核心协作", epoch: 1, revision: 1 })).rejects.toThrow("已更新");
  });
  it("rejects executable URLs, unsupported CRDT roots and duplicate anchors; exports rich content to Markdown", async () => {
    expect(() => validateDocumentContent({ type: "doc", content: [{ type: "image", attrs: { src: "javascript:alert(1)" } }] })).toThrow();
    expect(() => validateDocumentContent({ type: "doc", content: [{ type: "paragraph", attrs: { id: "same" } }, { type: "paragraph", attrs: { id: "same" } }] })).toThrow("重复");
    const rich = validateDocumentContent({ type: "doc", content: [{ type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "计划" }] }, { type: "taskList", content: [{ type: "taskItem", attrs: { checked: true }, content: [{ type: "paragraph", content: [{ type: "text", text: "完成调研", marks: [{ type: "bold" }] }] }] }] }] });
    const ydoc = readYState(contentToYState(rich)); try { expect(documentMarkdown(yDocumentContent(ydoc))).toContain("- [x] **完成调研**"); ydoc.getMap("hidden").set("secret", "payload"); expect(() => yDocumentContent(ydoc)).toThrow("字段"); } finally { ydoc.destroy(); }
  });
});
