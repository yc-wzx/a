import { afterEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import { DocumentSyncProvider, decodeBinary, encodeBinary } from "@/components/documents/sync-provider";
import { draftKey, listLocalDocumentDrafts, saveLocalDocumentDraft, type LocalDocumentDraft } from "@/components/documents/local-drafts";

function storage(): Storage {
  const data: Record<string, string> = {};
  Object.defineProperties(data, { length: { get: () => Object.keys(data).length }, getItem: { value: (key: string) => data[key] ?? null },
    setItem: { writable: true, value: (key: string, value: string) => { data[key] = value; } }, removeItem: { value: (key: string) => { delete data[key]; } },
    clear: { value: () => Object.keys(data).forEach(key => delete data[key]) }, key: { value: (index: number) => Object.keys(data)[index] ?? null } });
  return data as unknown as Storage;
}
const scope = { actorId: "student-a", projectId: "project-a", documentId: "doc-a" };
const providers: DocumentSyncProvider[] = [];
function provider(state = "", epoch = 1) {
  const p = new DocumentSyncProvider("/sync", state, epoch, 1, "edit", { scope, preview: () => "本人草稿" }); providers.push(p); return p;
}
function response(patch = {}) { return new Response(JSON.stringify({ ok: true, data: { update: "", epoch: 1, revision: 2, permission: "edit", updatedAt: new Date().toISOString(), presence: [], ...patch } })); }
afterEach(() => { providers.splice(0).forEach(p => p.destroy()); vi.unstubAllGlobals(); });

describe("browser document recovery persists only pending local edits", () => {
  it("does not store the remote document as an unsaved local draft", async () => {
    vi.stubGlobal("localStorage", storage());
    const remote = new Y.Doc(); remote.getMap("body").set("server", "已保存正文");
    const p = provider(encodeBinary(Y.encodeStateAsUpdate(remote)));
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response())); await p.sync();
    expect(listLocalDocumentDrafts(scope)).toHaveLength(0); remote.destroy();
  });
  it("keeps a local delta across provider destruction without auto-upload on reopen", async () => {
    vi.stubGlobal("localStorage", storage());
    const first = provider(); first.doc.getMap("body").set("mine", "离线修改");
    const draft = listLocalDocumentDrafts(scope)[0]; expect(draft.update).toBeTruthy(); first.destroy();
    const second = provider(); const fetcher = vi.fn().mockImplementation(async () => response()); vi.stubGlobal("fetch", fetcher);
    await second.sync(); expect(JSON.parse(fetcher.mock.calls[0][1].body).update).toBeUndefined();
    expect(listLocalDocumentDrafts(scope)).toHaveLength(1);
    second.restoreLocalDraft(draft); expect(second.doc.getMap("body").get("mine")).toBe("离线修改");
    expect(listLocalDocumentDrafts(scope).length).toBeGreaterThan(0); await second.flush();
    expect(listLocalDocumentDrafts(scope)).toHaveLength(0);
  });
  it("does not remove a draft until all in-flight and later updates are acknowledged", async () => {
    vi.stubGlobal("localStorage", storage());
    const p = provider(); p.doc.getMap("body").set("one", "甲");
    let finish!: (response: Response) => void;
    vi.stubGlobal("fetch", vi.fn().mockImplementationOnce(() => new Promise<Response>(resolve => { finish = resolve; })).mockResolvedValue(response()));
    const request = p.sync(); p.doc.getMap("body").set("two", "乙"); finish(response()); await request;
    const left = listLocalDocumentDrafts(scope)[0]; const draftDoc = new Y.Doc(); Y.applyUpdate(draftDoc, decodeBinary(left.update));
    // The second delta can reference the first server-confirmed struct, so its
    // dependency is supplied exactly as a reopened document would supply it.
    expect(p.getSnapshot().pending).toBe(true); await p.flush(); expect(listLocalDocumentDrafts(scope)).toHaveLength(0); draftDoc.destroy();
  });
  it("separates accounts, projects, documents, epochs and browser tabs", () => {
    vi.stubGlobal("localStorage", storage());
    const p = provider(); p.doc.getMap("body").set("mine", "私密修改"); const original = listLocalDocumentDrafts(scope)[0];
    for (const changed of [{ ...scope, actorId: "other" }, { ...scope, projectId: "other" }, { ...scope, documentId: "other" }]) expect(listLocalDocumentDrafts(changed)).toHaveLength(0);
    const anotherTab: LocalDocumentDraft = { ...original, sessionId: "another-tab", key: draftKey(scope, 1, "another-tab") }; saveLocalDocumentDraft(anotherTab);
    expect(listLocalDocumentDrafts(scope)).toHaveLength(2);
    expect(() => provider("", 2).restoreLocalDraft(original)).toThrow("版本");
    expect(() => p.restoreLocalDraft({ ...original, actorId: "other" })).toThrow("账号");
  });
  it("expires old entries and rejects malformed entries without reading other accounts", () => {
    vi.stubGlobal("localStorage", storage());
    const p = provider(); p.doc.getMap("body").set("mine", "甲"); const original = listLocalDocumentDrafts(scope)[0];
    saveLocalDocumentDraft({ ...original, savedAt: Date.now() - 15 * 86400000 });
    expect(listLocalDocumentDrafts(scope)).toHaveLength(0);
    localStorage.setItem(draftKey(scope, 1, "broken"), "not-json"); expect(listLocalDocumentDrafts(scope)).toHaveLength(0);
  });
  it("keeps the pending recovery entry after permission is revoked and never retries it", async () => {
    vi.stubGlobal("localStorage", storage()); const p = provider(); p.doc.getMap("body").set("mine", "保留");
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: false, code: "FORBIDDEN", error: "权限已撤销" }), { status: 403 })); vi.stubGlobal("fetch", fetcher);
    await expect(p.sync()).rejects.toThrow("权限"); await expect(p.sync()).rejects.toThrow("停止同步");
    expect(fetcher).toHaveBeenCalledTimes(1); expect(listLocalDocumentDrafts(scope)).toHaveLength(1);
    expect(() => p.restoreLocalDraft(listLocalDocumentDrafts(scope)[0])).toThrow("权限");
  });
  it("merges recovered edits with remote edits without replacing server text", async () => {
    vi.stubGlobal("localStorage", storage()); const remote = new Y.Doc(); remote.getMap("body").set("remote", "他人已保存");
    const old = provider(); old.doc.getMap("body").set("mine", "我的修改"); const draft = listLocalDocumentDrafts(scope)[0]; old.destroy();
    const current = provider(encodeBinary(Y.encodeStateAsUpdate(remote))); current.restoreLocalDraft(draft);
    expect(current.doc.getMap("body").toJSON()).toEqual({ remote: "他人已保存", mine: "我的修改" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response())); await current.flush(); expect(listLocalDocumentDrafts(scope)).toHaveLength(0); remote.destroy();
  });
  it("reports blocked browser storage while keeping the editable page in memory", () => {
    const unavailable = storage(); unavailable.setItem = () => { throw new Error("storage quota"); }; vi.stubGlobal("localStorage", unavailable);
    const p = provider(); p.doc.getMap("body").set("mine", "保留在内存");
    expect(p.getSnapshot().pending).toBe(true); expect(p.getSnapshot().recoveryError).toContain("quota");
  });
  it("does not erase newer unsaved updates from another still-open tab", async () => {
    vi.stubGlobal("localStorage", storage()); const original = provider(); original.doc.getMap("body").set("one", "原草稿");
    const draft = listLocalDocumentDrafts(scope)[0], restored = provider(); restored.restoreLocalDraft(draft);
    original.doc.getMap("body").set("two", "恢复过程中原标签页又写了内容");
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => response())); await restored.flush();
    const remaining = listLocalDocumentDrafts(scope); expect(remaining).toHaveLength(1); expect(remaining[0].key).toBe(draft.key); expect(remaining[0].update).not.toBe(draft.update);
  });
});
