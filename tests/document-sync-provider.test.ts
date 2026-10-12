import { afterEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import { DocumentSyncProvider, decodeBinary, encodeBinary } from "@/components/documents/sync-provider";
import type { DocumentSyncResult } from "@/contracts/documents";

const providers: DocumentSyncProvider[] = [];
afterEach(() => { providers.splice(0).forEach((provider) => provider.destroy()); vi.unstubAllGlobals(); });
function makeProvider() {
  const provider = new DocumentSyncProvider("/sync", "", 1, 1, "edit");
  providers.push(provider);
  return provider;
}
function response(patch: Partial<DocumentSyncResult> = {}) {
  return new Response(JSON.stringify({ ok: true, data: { update: "", epoch: 1, revision: 2, permission: "edit", updatedAt: "2026-10-12", presence: [], ...patch } }), { status: 200, headers: { "Content-Type": "application/json" } });
}

describe("collaborative document synchronization", () => {
  it("encodes large updates without exceeding argument limits", () => {
    const value = Uint8Array.from({ length: 200000 }, (_, index) => index % 256);
    expect(decodeBinary(encodeBinary(value))).toEqual(value);
  });
  it("keeps edits made during an in-flight request pending until the next acknowledgement", async () => {
    const provider = makeProvider();
    provider.doc.getMap("content").set("before", "first");
    let finish!: (value: Response) => void;
    const fetcher = vi.fn().mockImplementationOnce(() => new Promise<Response>((resolve) => { finish = resolve; })).mockResolvedValueOnce(response({ revision: 3 }));
    vi.stubGlobal("fetch", fetcher);
    const syncing = provider.sync();
    provider.doc.getMap("content").set("during", "second");
    finish(response());
    await syncing;
    expect(provider.getSnapshot().pending).toBe(true);
    await provider.flush();
    expect(provider.getSnapshot().pending).toBe(false);
    const server = new Y.Doc();
    try {
      for (const call of fetcher.mock.calls) Y.applyUpdate(server, decodeBinary(JSON.parse(call[1].body).update));
      expect(server.getMap("content").toJSON()).toEqual({ before: "first", during: "second" });
    } finally { server.destroy(); }
  });
  it("does not echo incoming remote updates back to the server", async () => {
    const provider = makeProvider();
    const remote = new Y.Doc();
    remote.getMap("content").set("remote", "other member");
    const fetcher = vi.fn().mockResolvedValueOnce(response({ update: encodeBinary(Y.encodeStateAsUpdate(remote)) })).mockResolvedValueOnce(response());
    vi.stubGlobal("fetch", fetcher);
    await provider.sync(); await provider.sync();
    expect(provider.doc.getMap("content").get("remote")).toBe("other member");
    expect(provider.getSnapshot().pending).toBe(false);
    expect(JSON.parse(fetcher.mock.calls[1][1].body).update).toBeUndefined();
    remote.destroy();
  });
  it("retains offline edits and resumes without replacing the document", async () => {
    const provider = makeProvider();
    provider.doc.getMap("content").set("draft", "keep me");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValueOnce(new TypeError("Failed to fetch")).mockResolvedValueOnce(response()));
    await expect(provider.sync()).rejects.toThrow("Failed to fetch");
    expect(provider.getSnapshot()).toMatchObject({ status: "offline", pending: true });
    expect(provider.doc.getMap("content").get("draft")).toBe("keep me");
    await provider.flush();
    expect(provider.getSnapshot()).toMatchObject({ status: "saved", pending: false });
  });
  it("stops on an epoch change and preserves the unsaved local copy", async () => {
    const provider = makeProvider();
    provider.doc.getMap("content").set("draft", "pre-restore content");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({ epoch: 2 })));
    await provider.sync();
    expect(provider.getSnapshot()).toMatchObject({ status: "restored", pending: true });
    expect(provider.doc.getMap("content").get("draft")).toBe("pre-restore content");
    await expect(provider.flush()).rejects.toThrow("停止同步");
  });
  it("does not retry writing after access is revoked", async () => {
    const provider = makeProvider();
    provider.doc.getMap("content").set("draft", "private copy");
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: false, code: "FORBIDDEN", error: "文档编辑权限已撤销" }), { status: 403 }));
    vi.stubGlobal("fetch", fetcher);
    await expect(provider.sync()).rejects.toThrow("权限已撤销");
    expect(provider.getSnapshot()).toMatchObject({ status: "blocked", pending: true });
    await expect(provider.sync()).rejects.toThrow("停止同步");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("allows only one sync request at a time", async () => {
    const provider = makeProvider();
    let finish!: (value: Response) => void;
    const fetcher = vi.fn().mockImplementation(() => new Promise<Response>((resolve) => { finish = resolve; }));
    vi.stubGlobal("fetch", fetcher);
    const first = provider.sync();
    expect(provider.sync()).toBe(first);
    expect(fetcher).toHaveBeenCalledTimes(1);
    finish(response()); await first;
  });
  it("supports the synced event used by Tiptap UniqueID and removes listeners cleanly", async () => {
    const provider = makeProvider();
    const listener = vi.fn(() => provider.off("synced", listener));
    provider.on("synced", listener);
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => response()));
    await provider.sync(); await provider.sync();
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
