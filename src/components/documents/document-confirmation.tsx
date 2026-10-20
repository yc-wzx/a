"use client";

import { useCallback, useEffect, useState } from "react";
import type { DocumentConfirmation as Confirmation, DocumentDetail } from "@/contracts/documents";
import type { DocumentEditorHandle } from "./document-editor";
import { documentMutation, documentRequest, errorMessage } from "./http";
import { displayDateTime } from "@/lib/display-time";

export function DocumentConfirmationPanel({ detail, handle, revision }: { detail: DocumentDetail; handle: DocumentEditorHandle | null; revision: number }) {
  const [state, setState] = useState<Confirmation | null>(null), [selected, setSelected] = useState<string[]>([]), [choosing, setChoosing] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const base = `/api/projects/${detail.projectId}/documents/${detail.id}/confirmation`;
  const load = useCallback(async () => { const next = await documentRequest<Confirmation>(base); setState(next); }, [base]);
  useEffect(() => { let live = true; const initial = setTimeout(() => { void load().catch(e => { if (live) setError(errorMessage(e)); }); }, 0); const timer = setInterval(() => { if (!document.hidden) void load().catch(() => {}); }, 12000); return () => { live = false; clearTimeout(initial); clearInterval(timer); }; }, [load, revision]);
  async function submit(confirm: boolean) {
    if (!handle || busy) return;
    setBusy(true); setError("");
    try {
      const saved = await handle.provider.flush();
      const fresh = await documentRequest<DocumentDetail>(`/api/projects/${detail.projectId}/documents/${detail.id}`);
      if (saved.revision !== fresh.revision || fresh.epoch !== handle.provider.epoch) throw new Error("正文刚刚更新，请核对当前内容后重试。");
      if (confirm && state?.round) await documentMutation(base, "PATCH", { expectedRevision: fresh.revision, epoch: fresh.epoch, roundId: state.round.id });
      else await documentMutation(base, "POST", { expectedRevision: fresh.revision, epoch: fresh.epoch, reviewerIds: selected });
      await load(); setChoosing(false); setSelected([]);
    } catch(e) { setError(errorMessage(e)); } finally { setBusy(false); }
  }
  const round = state?.round;
  const confirmed = round?.participants.filter(member => member.confirmedAt).length ?? 0;
  return <section id="document-confirmation" className="ac-card space-y-3 p-4" aria-label="文档确认">
    <div className="flex flex-wrap items-center justify-between gap-2"><div><h2 className="text-sm font-semibold">文档确认 <span className={`ml-2 rounded px-2 py-1 text-xs ${round && !round.stale && confirmed === round.participants.length && confirmed > 0 ? "bg-green-50 text-green-800" : "bg-canvas text-ink-soft"}`}>{!round ? "未发起" : round.stale ? "正文已更新 · 待重新确认" : `${confirmed}/${round.participants.length} 人已确认`}</span></h2></div>
      <div className="flex gap-2">{state?.canConfirm && <button type="button" className="ac-btn" disabled={busy || !handle} onClick={() => void submit(true)}>我已核对，确认此版</button>}{state?.canRequest && <button type="button" className="ac-btn-ghost" disabled={busy} onClick={() => setChoosing(value => !value)}>{choosing ? "取消" : round ? "重新发起确认" : "请成员确认"}</button>}</div>
    </div>
    {round && <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-soft">{round.participants.map(member => <span key={member.id}>{member.name} · {round.stale ? "需重新确认" : member.confirmedAt ? `已确认 ${displayDateTime(member.confirmedAt)}` : "待确认"}</span>)}</div>}
    {!round && <p className="text-xs text-ink-soft">需求、设计或展示稿准备好后，请相关成员核对当前正文。确认只代表已核对，不替代成果验收。</p>}
    {choosing && <div className="space-y-3 border-t border-line pt-3"><p className="text-xs text-ink-soft">选择已有访问权限的成员。正文修改后本轮确认失效，并在站内提醒他们重新核对；调整标题或目录不会使正文确认失效。</p><div className="flex flex-wrap gap-3">{state?.candidates.map(member => <label key={member.id} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={selected.includes(member.id)} onChange={event => setSelected(ids => event.target.checked ? [...ids, member.id] : ids.filter(id => id !== member.id))} />{member.name}</label>)}</div><button type="button" className="ac-btn" disabled={busy || !selected.length || !handle} onClick={() => void submit(false)}>发送确认请求</button></div>}
    {error && <p role="alert" className="text-xs text-red-700">{error}</p>}
  </section>;
}
