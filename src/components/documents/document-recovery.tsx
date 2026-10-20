"use client";

import { useEffect, useState } from "react";
import { displayDateTime } from "@/lib/display-time";
import type { DocumentDetail } from "@/contracts/documents";
import type { DocumentEditorHandle } from "./document-editor";
import { documentRequest, errorMessage } from "./http";
import { listLocalDocumentDrafts, removeLocalDocumentDraft, type LocalDocumentDraft } from "./local-drafts";

function download(draft: LocalDocumentDraft) {
  const url = URL.createObjectURL(new Blob([draft.preview], { type: "text/plain;charset=utf-8" }));
  const link = document.createElement("a"); link.href = url; link.download = "文档-未保存草稿.txt"; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function DocumentRecovery({ initial, handle }: { initial: DocumentDetail; handle: DocumentEditorHandle | null }) {
  const [drafts, setDrafts] = useState<LocalDocumentDraft[]>([]), [preview, setPreview] = useState<string | null>(null), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const scope = { actorId: initial.actorId, projectId: initial.projectId, documentId: initial.id };
  useEffect(() => {
    function readStoredDrafts() {
      try { setDrafts(listLocalDocumentDrafts({ actorId: initial.actorId, projectId: initial.projectId, documentId: initial.id }).filter(draft => draft.sessionId !== handle?.provider.sessionId)); }
      catch { setError("浏览器不允许读取本地草稿；当前正文仍可正常编辑。"); }
    }
    const timer = setTimeout(readStoredDrafts, 0);
    window.addEventListener("storage", readStoredDrafts);
    return () => { clearTimeout(timer); window.removeEventListener("storage", readStoredDrafts); };
  }, [initial.actorId, initial.projectId, initial.id, handle]);
  async function restore(draft: LocalDocumentDraft) {
    if (!handle || busy) return;
    setBusy(true); setError("");
    try {
      const current = await documentRequest<DocumentDetail>(`/api/projects/${scope.projectId}/documents/${scope.documentId}`);
      if (current.actorId !== scope.actorId || !current.canEdit || current.deletedAt) throw new Error("当前账号没有编辑权限，草稿不会上传。");
      if (current.epoch !== draft.epoch || handle.provider.epoch !== draft.epoch) throw new Error("正文已恢复过历史版本。此草稿只能下载保留，不能直接合并到新版本。");
      if (handle.provider.getSnapshot().pending) throw new Error("请先保存当前页面的修改，再恢复以前的草稿。");
      if (!window.confirm("将此草稿中的未保存修改合并到当前正文？服务器正文若有更新会共同保留，请合并后检查内容。")) return;
      handle.provider.restoreLocalDraft(draft);
      await handle.provider.flush();
      setDrafts(rows => rows.filter(row => row.key !== draft.key)); setPreview(null);
    } catch (failure) { setError(errorMessage(failure)); }
    finally { setBusy(false); }
  }
  if (!drafts.length && !error) return null;
  return <section className="space-y-3 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm" aria-label="本地文档草稿恢复">
    <p className="font-medium">{drafts.length ? `发现 ${drafts.length} 份未确认保存的本地草稿` : "本地恢复副本不可用"}</p>
    {drafts.length > 0 && <p className="text-xs text-ink-soft">仅保存在当前浏览器、当前账号下，保留 14 天。先查看，再选择恢复；不会自动覆盖线上正文。已保存的重复增量合并后不会重复插入。</p>}
    {error && <p role="alert" className="text-red-700">{error}</p>}
    {drafts.map(draft => <div key={draft.key} className="space-y-2 border-t border-amber-200 pt-2"><p className="text-xs">{displayDateTime(new Date(draft.savedAt).toISOString())} · {draft.epoch === initial.epoch ? "当前正文版本" : "较早正文版本，仅供保留"}</p>
      <div className="flex flex-wrap gap-2"><button type="button" className="ac-btn-ghost" onClick={() => setPreview(preview === draft.key ? null : draft.key)}>{preview === draft.key ? "收起" : "查看草稿"}</button><button type="button" className="ac-btn-ghost" onClick={() => download(draft)}>下载副本</button><button type="button" className="ac-btn" disabled={busy || !handle || !initial.canEdit || draft.epoch !== initial.epoch} onClick={() => void restore(draft)}>合并恢复</button><button type="button" className="ac-btn-ghost" disabled={busy} onClick={() => { if (window.confirm("删除这份浏览器本地草稿？此操作无法撤销。")) { try { removeLocalDocumentDraft(draft.key); setDrafts(rows => rows.filter(row => row.key !== draft.key)); } catch { setError("本地草稿删除失败，请重试。"); } } }}>删除草稿</button></div>
      {preview === draft.key && <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-white p-3 text-xs">{draft.preview || "本次修改没有可显示的文字；可能是格式或图片调整。"}</pre>}
    </div>)}
  </section>;
}
