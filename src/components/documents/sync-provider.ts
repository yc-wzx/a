import * as Y from "yjs";
import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate, removeAwarenessStates } from "y-protocols/awareness";
import type { DocumentPermission, DocumentSyncResult } from "@/contracts/documents";
import { documentRequest, DocumentRequestError } from "./http";

export function encodeBinary(value: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < value.length; i += 8192) binary += String.fromCharCode(...value.subarray(i, i + 8192));
  return btoa(binary);
}
export function decodeBinary(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
}
export type SyncStatus = "connecting" | "saved" | "saving" | "offline" | "blocked" | "restored";
export type SyncSnapshot = {
  status: SyncStatus;
  permission: DocumentPermission;
  revision: number;
  pending: boolean;
  error?: string;
  presence: { userId: string; name: string }[];
};

/** One request at a time; acknowledge only the updates included in that request. */
export class DocumentSyncProvider {
  readonly doc: Y.Doc;
  readonly awareness: Awareness;
  readonly sessionId = crypto.randomUUID();
  private updates: Uint8Array[] = [];
  private timer: ReturnType<typeof setInterval> | undefined;
  private request: Promise<void> | undefined;
  private destroyed = false;
  private blocked = false;
  private snapshot: SyncSnapshot;
  private listeners = new Set<(state: SyncSnapshot) => void>();
  private events = new Map<string, Set<() => void>>();
  constructor(private url: string, state: string, readonly epoch: number, revision: number, permission: DocumentPermission) {
    this.doc = new Y.Doc();
    if (state) Y.applyUpdate(this.doc, decodeBinary(state), "remote");
    this.awareness = new Awareness(this.doc);
    this.snapshot = { status: "connecting", permission, revision, pending: false, presence: [] };
    this.doc.on("update", this.onUpdate);
  }
  private onUpdate = (update: Uint8Array, origin: unknown) => {
    if (origin === "remote" || this.destroyed) return;
    this.updates.push(update);
    this.publish({ pending: true, status: this.blocked ? this.snapshot.status : "saving" });
  };
  subscribe(listener: (state: SyncSnapshot) => void) {
    this.listeners.add(listener);
    listener(this.snapshot);
    return () => { this.listeners.delete(listener); };
  }
  on(event: string, callback: () => void) {
    const callbacks = this.events.get(event) ?? new Set<() => void>();
    callbacks.add(callback); this.events.set(event, callbacks);
  }
  off(event: string, callback: () => void) { this.events.get(event)?.delete(callback); }
  private publish(patch: Partial<SyncSnapshot>) {
    this.snapshot = { ...this.snapshot, ...patch };
    this.listeners.forEach((listener) => listener(this.snapshot));
  }
  getSnapshot() { return this.snapshot; }
  start() {
    if (this.timer || this.destroyed) return;
    void this.sync().catch(() => {});
    this.timer = setInterval(() => { void this.sync().catch(() => {}); }, 1000);
  }
  sync(): Promise<void> {
    if (this.destroyed || this.blocked) return Promise.reject(new Error("当前文档已停止同步，请保留未保存内容后重新打开。"));
    if (this.request) return this.request;
    this.request = this.performSync().finally(() => { this.request = undefined; });
    return this.request;
  }
  private async performSync() {
    const count = this.updates.length;
    const update = count && this.snapshot.permission === "edit" ? encodeBinary(Y.mergeUpdates(this.updates.slice(0, count))) : undefined;
    if (count) this.publish({ status: "saving" });
    try {
      const result = await documentRequest<DocumentSyncResult>(this.url, {
        method: "POST",
        body: JSON.stringify({ sessionId: this.sessionId, epoch: this.epoch,
          stateVector: encodeBinary(Y.encodeStateVector(this.doc)), update,
          awareness: encodeBinary(encodeAwarenessUpdate(this.awareness, [this.doc.clientID])) }),
      });
      if (this.destroyed) return;
      if (result.epoch !== this.epoch) {
        this.blocked = true;
        this.publish({ status: "restored", pending: this.updates.length > 0,
          error: "其他成员恢复了历史版本。请先复制或下载未保存内容，再重新打开文档。" });
        return;
      }
      if (result.update) Y.applyUpdate(this.doc, decodeBinary(result.update), "remote");
      if (update) this.updates.splice(0, count);
      const activeClients = new Set<number>([this.doc.clientID]);
      for (const person of result.presence) {
        if (person.sessionId === this.sessionId || !person.awareness) continue;
        applyAwarenessUpdate(this.awareness, decodeBinary(person.awareness), "remote");
      }
      // Removed sessions must also lose their cursors immediately.
      const sessions = new Set(result.presence.map((person) => person.sessionId));
      this.awareness.getStates().forEach((state, id) => { if (sessions.has(state.sessionId)) activeClients.add(id); });
      removeAwarenessStates(this.awareness, [...this.awareness.getStates().keys()].filter((id) => !activeClients.has(id)), "remote");
      const lostEdit = this.snapshot.permission === "edit" && result.permission !== "edit";
      if (lostEdit && this.updates.length) this.blocked = true;
      this.publish({ revision: result.revision, permission: result.permission,
        pending: this.updates.length > 0, status: this.blocked ? "blocked" : this.updates.length ? "saving" : "saved",
        error: lostEdit ? "编辑权限已改变。未保存内容可复制或下载，请重新打开确认权限。" : undefined,
        presence: [...new Map(result.presence.map((person) => [person.userId, { userId: person.userId, name: person.name }])).values()] });
      [...(this.events.get("synced") ?? [])].forEach((callback) => callback());
    } catch (error) {
      if (this.destroyed) return;
      const denied = error instanceof DocumentRequestError && [401, 403, 404, 409, 410].includes(error.status);
      if (denied) this.blocked = true;
      this.publish({ status: denied ? error instanceof DocumentRequestError && error.status === 409 ? "restored" : "blocked" : "offline",
        pending: this.updates.length > 0, error: error instanceof Error ? error.message : "连接中断，恢复连接后将继续保存。" });
      throw error;
    }
  }
  async flush() {
    for (let attempt = 0; attempt < 5; attempt++) {
      await this.sync();
      if (this.blocked) throw new Error(this.snapshot.error ?? "同步已停止，请重新打开文档。");
      if (!this.updates.length) return this.snapshot;
    }
    throw new Error("内容仍在同步，请稍等片刻再操作。");
  }
  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    if (this.timer) clearInterval(this.timer);
    this.doc.off("update", this.onUpdate);
    this.awareness.setLocalState(null);
    this.awareness.destroy();
    this.doc.destroy();
    this.listeners.clear();
    this.events.clear();
  }
}
