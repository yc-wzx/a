import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { projects, tasks, users } from "@/db/schema";
import { createTeam, joinTeam, updateMemberRole } from "@/lib/team";
import { createProject } from "@/lib/project";
import { createDocument, getDocumentDetail, updateDocument, trashDocument, getDocumentKnowledge, setDocumentGuidePin, getPersonalDocuments, recordDocumentVisit, setDocumentBookmark, getDocumentRelations, exportDocument, createTaskFromDocument, askProjectDocuments, createDocumentVersion, getDocumentVersion } from "@/lib/documents";
import { searchWorkspace } from "@/lib/workspace-search";
import { selectDocumentAnswerSources, verifyDocumentAnswer } from "@/lib/document-answers";
import { resetDb } from "./helpers";

const model = vi.hoisted(() => ({ configure: vi.fn(async (actorId: string) => ({ model: "personal", instructions: "", actorId })), generate: vi.fn<(options: { prompt: string }) => Promise<{ text: string }>>() }));
vi.mock("@/lib/agent/model", () => ({ getConfiguredAssistant: model.configure, personalModelRequest: (run: () => Promise<unknown>) => run() }));
vi.mock("ai", () => ({ generateText: model.generate }));
const paragraph = (text: string) => ({ type: "paragraph", content: [{ type: "text", text }] });
async function scene() {
  const [owner, peer, teacher, outsider] = await db.insert(users).values(["owner", "peer", "teacher", "outsider"].map(name => ({ name, email: name + "@knowledge.test", passwordHash: "fixture" }))).returning();
  const team = await createTeam(owner.id, "知识协作试用");
  for (const user of [peer, teacher]) await joinTeam(user.id, team.inviteCode);
  await updateMemberRole(owner.id, team.id, teacher.id, "teacher");
  const project = await createProject(owner.id, team.id, { name: "交互设计项目" });
  const doc = await createDocument(owner.id, project.id, { requestId: randomUUID(), title: "需求范围", content: { type: "doc", content: [paragraph("本轮先完成任务四列看板和教师反馈。"), paragraph("试用时由学生提交成果，老师核对完成条件。Literal%_token")] } });
  return { owner, peer, teacher, outsider, team, project, doc };
}
async function change(owner: string, project: string, document: string, data: object) {
  const detail = await getDocumentDetail(owner, project, document);
  return updateDocument(owner, project, document, { requestId: randomUUID(), expectedRevision: detail.revision, ...data });
}
function grounded(options: { prompt: string }) {
  const source = JSON.parse(options.prompt).sources[0];
  return Promise.resolve({ text: JSON.stringify({ found: true, answer: "本轮围绕看板与教师反馈开展。", citations: [{ sourceId: source.sourceId, quote: source.text }] }) });
}

describe("lightweight document knowledge, real PostgreSQL access rules", () => {
  beforeEach(async () => { await resetDb(); model.configure.mockClear(); model.generate.mockReset(); model.generate.mockImplementation(grounded); });
  it("keeps bookmarks and visits personal, hides revoked private documents and does not count listing as reading", async () => {
    const s = await scene();
    expect((await getPersonalDocuments(s.peer.id)).recent).toHaveLength(0);
    await Promise.all([setDocumentBookmark(s.peer.id, s.project.id, s.doc.id, { bookmarked: true }), recordDocumentVisit(s.peer.id, s.project.id, s.doc.id)]);
    await setDocumentBookmark(s.peer.id, s.project.id, s.doc.id, { bookmarked: true });
    expect((await getPersonalDocuments(s.peer.id)).favorites.map(d => d.id)).toEqual([s.doc.id]);
    expect((await getDocumentDetail(s.peer.id, s.project.id, s.doc.id)).bookmarked).toBe(true);
    expect((await getPersonalDocuments(s.owner.id)).favorites).toHaveLength(0);
    await change(s.owner.id, s.project.id, s.doc.id, { visibility: "private" });
    expect(await getPersonalDocuments(s.peer.id)).toEqual({ favorites: [], recent: [] });
    await expect(recordDocumentVisit(s.outsider.id, s.project.id, s.doc.id)).rejects.toThrow();
  });
  it("limits guide management to project leaders/admins, detects stale pins and clears a newly private pin", async () => {
    const s = await scene(); const input = { slot: "requirements", documentId: s.doc.id, expectedDocumentId: null };
    await expect(setDocumentGuidePin(s.peer.id, s.project.id, input)).rejects.toThrow("负责人");
    await setDocumentGuidePin(s.owner.id, s.project.id, input);
    expect((await getDocumentKnowledge(s.teacher.id, s.project.id)).pins[0].title).toBe("需求范围");
    await expect(setDocumentGuidePin(s.owner.id, s.project.id, input)).rejects.toThrow("已更新");
    await change(s.owner.id, s.project.id, s.doc.id, { visibility: "private" });
    expect((await getDocumentKnowledge(s.owner.id, s.project.id)).pins).toHaveLength(0);
    await expect(setDocumentGuidePin(s.owner.id, s.project.id, input)).rejects.toThrow("共享");
    await db.update(projects).set({ status: "archived" }).where(eq(projects.id, s.project.id));
    await expect(setDocumentGuidePin(s.owner.id, s.project.id, input)).rejects.toThrow("归档");
  });
  it("resolves renamed references with current ACL in backlinks, exports and saved versions without leaking private titles", async () => {
    const s = await scene();
    const source = await createDocument(s.owner.id, s.project.id, { requestId: randomUUID(), title: "设计依据", content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "documentReference", attrs: { documentId: s.doc.id, title: "不可存储的旧标题" } }] }] } });
    const version = await createDocumentVersion(s.owner.id, s.project.id, source.id, { requestId: randomUUID(), expectedRevision: 1, label: "依据版本" });
    expect((await getDocumentRelations(s.peer.id, s.project.id, s.doc.id)).incoming.map(d => d.id)).toEqual([source.id]);
    await change(s.owner.id, s.project.id, s.doc.id, { title: "改名后的需求" });
    expect((await getDocumentRelations(s.peer.id, s.project.id, source.id)).outgoing[0].title).toBe("改名后的需求");
    expect((await exportDocument(s.peer.id, s.project.id, source.id)).markdown).toContain("改名后的需求");
    await change(s.owner.id, s.project.id, s.doc.id, { visibility: "private" });
    expect((await getDocumentRelations(s.peer.id, s.project.id, source.id)).outgoing).toHaveLength(0);
    expect(JSON.stringify((await getDocumentDetail(s.peer.id, s.project.id, source.id)).content)).not.toContain("不可存储");
    expect((await getDocumentVersion(s.peer.id, s.project.id, source.id, version.id)).markdown).not.toContain("改名后的需求");
    expect((await exportDocument(s.peer.id, s.project.id, source.id)).markdown).toContain("引用文档不可用");
  });
  it("atomically creates one task and source paragraph, rejects stale/wrong selections and teachers", async () => {
    const s = await scene(), detail = await getDocumentDetail(s.peer.id, s.project.id, s.doc.id);
    const input = { requestId: randomUUID(), expectedRevision: detail.revision, epoch: detail.epoch, blockId: detail.content.content![0].attrs!.id, selection: "任务四列看板", title: "实现看板", assigneeId: s.peer.id, dueDate: "2026-12-01" };
    const created = await createTaskFromDocument(s.peer.id, s.project.id, s.doc.id, input);
    expect(await createTaskFromDocument(s.peer.id, s.project.id, s.doc.id, input)).toEqual(created);
    expect((await db.select().from(tasks)).filter(t => t.title === "实现看板")).toHaveLength(1);
    expect((await getDocumentDetail(s.peer.id, s.project.id, s.doc.id)).links[0].taskId).toBe(created.taskId);
    expect(created.documentHref).toContain(String(input.blockId));
    await expect(createTaskFromDocument(s.teacher.id, s.project.id, s.doc.id, { ...input, requestId: randomUUID() })).rejects.toThrow();
    await expect(createTaskFromDocument(s.peer.id, s.project.id, s.doc.id, { ...input, requestId: randomUUID(), selection: "老师核对完成条件" })).rejects.toThrow("同一段落");
    await expect(createTaskFromDocument(s.peer.id, s.project.id, s.doc.id, { ...input, requestId: randomUUID(), expectedRevision: 999 })).rejects.toThrow("已更新");
    await expect(createTaskFromDocument(s.peer.id, s.project.id, s.doc.id, { ...input, requestId: randomUUID(), assigneeId: s.outsider.id })).rejects.toThrow();
    expect(await db.select().from(tasks)).toHaveLength(1);
  });
  it("requires explicit consent to copy private material into a shared task", async () => {
    const s = await scene(); await change(s.owner.id, s.project.id, s.doc.id, { visibility: "private" });
    const doc = await getDocumentDetail(s.owner.id, s.project.id, s.doc.id);
    const input = { requestId: randomUUID(), expectedRevision: doc.revision, epoch: doc.epoch, blockId: doc.content.content![0].attrs!.id, title: "确认任务", selection: "任务四列看板" };
    await expect(createTaskFromDocument(s.owner.id, s.project.id, s.doc.id, input)).rejects.toThrow("共享");
    await createTaskFromDocument(s.owner.id, s.project.id, s.doc.id, { ...input, sharePrivateContent: true });
    expect((await searchWorkspace(s.peer.id, { q: "任务四列看板" })).items.map(d => d.group)).toEqual(["任务"]);
  });
  it("filters search before counting/paging, searches body literally and isolates projects", async () => {
    const s = await scene();
    for (let index = 0; index < 21; index++) await createDocument(s.owner.id, s.project.id, { requestId: randomUUID(), title: `分页文档${String(index).padStart(2, "0")}` });
    const hidden = await createDocument(s.owner.id, s.project.id, { requestId: randomUUID(), title: "分页文档私密", visibility: "private" });
    const first = await searchWorkspace(s.peer.id, { q: "分页文档", kind: "documents" });
    expect(first.total).toBe(21); expect(first.items).toHaveLength(20); expect(first.nextOffset).toBe(20);
    const last = await searchWorkspace(s.peer.id, { q: "分页文档", offset: 20 }); expect(last.items).toHaveLength(1);
    expect(JSON.stringify([first, last])).not.toContain(hidden.id);
    expect((await searchWorkspace(s.peer.id, { q: "%_token" })).items[0].excerpt).toContain("Literal%_token");
    expect((await searchWorkspace(s.outsider.id, { q: "分页文档" })).total).toBe(0);
    const other = await createProject(s.owner.id, s.team.id, { name: "另一个项目" });
    expect((await searchWorkspace(s.peer.id, { q: "分页文档", projectId: other.id })).total).toBe(0);
    await trashDocument(s.owner.id, s.project.id, s.doc.id, { requestId: randomUUID(), expectedRevision: 1 });
    expect((await searchWorkspace(s.peer.id, { q: "%_token" })).total).toBe(0);
  });
  it("uses the current user's model and real paragraph citations for a teacher's read-only question", async () => {
    const s = await scene(), detail = await getDocumentDetail(s.teacher.id, s.project.id, s.doc.id);
    const result = await askProjectDocuments(s.teacher.id, s.project.id, { question: "看板要求", documents: [{ id: s.doc.id, revision: detail.revision, epoch: detail.epoch }] });
    expect(model.configure).toHaveBeenCalledWith(s.teacher.id);
    expect(result.citations[0].href).toContain(`#block=${detail.content.content![0].attrs!.id}`);
    expect(result.citations[0].quote).toContain("四列看板");
    expect(await db.select().from(tasks)).toHaveLength(0);
  });
  it("rejects nonexistent quotations, sources and claims without references", async () => {
    const s = await scene(), detail = await getDocumentDetail(s.peer.id, s.project.id, s.doc.id);
    const { sources } = selectDocumentAnswerSources([detail], "看板");
    for (const citations of [[], [{ sourceId: "S999", quote: "编造" }], [{ sourceId: "S1", quote: "不存在的原文" }]]) expect(() => verifyDocumentAnswer(JSON.stringify({ found: true, answer: "未核实回答", citations }), sources, s.project.id)).toThrow();
    expect(verifyDocumentAnswer(JSON.stringify({ found: false, answer: "不应展示的补充", citations: [] }), sources, s.project.id).answer).not.toContain("不应展示");
  });
  it("discards the answer if permissions change during model generation", async () => {
    const s = await scene(), doc = await getDocumentDetail(s.peer.id, s.project.id, s.doc.id);
    model.generate.mockImplementationOnce(async options => { await change(s.owner.id, s.project.id, s.doc.id, { visibility: "private" }); return grounded(options); });
    await expect(askProjectDocuments(s.peer.id, s.project.id, { question: "看板要求", documents: [{ id: doc.id, revision: doc.revision, epoch: doc.epoch }] })).rejects.toThrow("权限");
    expect(await db.select().from(tasks)).toHaveLength(0);
  });
  it("does not call the model for inaccessible sources, oversized source sets or stale versions", async () => {
    const s = await scene(); const documents = [{ id: s.doc.id, revision: 1, epoch: 1 }];
    await expect(askProjectDocuments(s.outsider.id, s.project.id, { question: "要求", documents })).rejects.toThrow();
    await expect(askProjectDocuments(s.peer.id, s.project.id, { question: "要求", documents: [...documents, ...documents, ...documents, ...documents] })).rejects.toThrow();
    await expect(askProjectDocuments(s.peer.id, s.project.id, { question: "要求", documents: [{ ...documents[0], revision: 99 }] })).rejects.toThrow("已更新");
    expect(model.generate).not.toHaveBeenCalled();
  });
  it("shares a bounded personal document AI budget instead of letting repeated questions bypass it", async () => {
    const s = await scene(); const input = { question: "看板要求", documents: [{ id: s.doc.id, revision: 1, epoch: 1 }] };
    for (let index = 0; index < 4; index++) await askProjectDocuments(s.peer.id, s.project.id, input);
    await expect(askProjectDocuments(s.peer.id, s.project.id, input)).rejects.toThrow("一分钟");
    expect(model.generate).toHaveBeenCalledTimes(4);
    await askProjectDocuments(s.teacher.id, s.project.id, input);
    expect(model.generate).toHaveBeenCalledTimes(5);
  });
});
