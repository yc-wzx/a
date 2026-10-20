/** Local recovery is opt-in on reopen. Only unacknowledged local deltas persist. */
export type LocalDraftScope = { actorId: string; projectId: string; documentId: string };
export type LocalDocumentDraft = LocalDraftScope & {
  version: 1; key: string; sessionId: string; epoch: number; revision: number;
  update: string; preview: string; savedAt: number;
};
const PREFIX = "agilecampus.document-draft.v1:";
const TTL = 14 * 24 * 60 * 60 * 1000;
const MAX_BYTES = 1800000;
export function draftPrefix(scope: LocalDraftScope) { return `${PREFIX}${scope.actorId}:${scope.projectId}:${scope.documentId}:`; }
export function draftKey(scope: LocalDraftScope, epoch: number, sessionId: string) { return `${draftPrefix(scope)}${epoch}:${sessionId}`; }
function parseDraft(raw: string | null, scope: LocalDraftScope, key: string): LocalDocumentDraft | null {
  try {
    const row = JSON.parse(raw ?? "null") as LocalDocumentDraft;
    if (!row || row.version !== 1 || row.actorId !== scope.actorId || row.projectId !== scope.projectId || row.documentId !== scope.documentId
      || row.key !== key || key !== draftKey(scope, row.epoch, row.sessionId) || !Number.isSafeInteger(row.epoch) || row.epoch < 1
      || !Number.isSafeInteger(row.revision) || row.revision < 1 || typeof row.update !== "string" || !row.update || row.update.length > MAX_BYTES
      || typeof row.preview !== "string" || row.preview.length > 200000 || !Number.isFinite(row.savedAt) || Date.now() - row.savedAt > TTL) return null;
    return row;
  } catch { return null; }
}
export function listLocalDocumentDrafts(scope: LocalDraftScope, storage: Storage = localStorage): LocalDocumentDraft[] {
  const rows: LocalDocumentDraft[] = [];
  const prefix = draftPrefix(scope);
  for (const key of Object.keys(storage)) {
    if (!key.startsWith(prefix)) continue;
    const draft = parseDraft(storage.getItem(key), scope, key);
    if (draft) rows.push(draft); else storage.removeItem(key);
  }
  return rows.sort((a, b) => b.savedAt - a.savedAt);
}
export function saveLocalDocumentDraft(draft: LocalDocumentDraft, storage: Storage = localStorage) {
  const encoded = JSON.stringify(draft);
  if (encoded.length > MAX_BYTES) throw new Error("本地草稿较大，请复制或下载副本；不要关闭当前页面。");
  storage.setItem(draft.key, encoded);
}
export function removeLocalDocumentDraft(key: string, storage: Storage = localStorage) {
  if (key.startsWith(PREFIX)) storage.removeItem(key);
}
export function removeRecoveredDraftIfUnchanged(draft: LocalDocumentDraft, storage: Storage = localStorage) {
  const current = parseDraft(storage.getItem(draft.key), draft, draft.key);
  // Another still-open tab may have appended a new local update after this
  // recovery started. Only clear the exact delta acknowledged by the server.
  if (current?.update === draft.update) storage.removeItem(draft.key);
}
