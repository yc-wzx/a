"use client";
import Link from "next/link";
import { useRef, useState } from "react";
import { submitTaskOutcomeAction } from "@/app/(app)/projects/[projectId]/tasks/outcome-actions";
import { newRequestId } from "@/lib/request-id";
export function TaskOutcome({ projectId, taskId, title, canWrite, onSaved }: { projectId: string; taskId: string; title: string; canWrite: boolean; onSaved?: () => void }) {
  const [note, setNote] = useState(""), [url, setUrl] = useState(""), [pending, setPending] = useState(false), [error, setError] = useState("");
  const [submitted, setSubmitted] = useState<string | null>(null), request = useRef(newRequestId());
  return <div className="space-y-4"><h3 className="font-semibold">提交成果</h3><p className="rounded-xl bg-sunken p-3 text-sm">{title}</p><p className="text-sm text-ink-soft">完成说明或成果链接填写一项即可。提交后进入成果审核，不会自动把任务标为完成。</p>
    {!canWrite ? <p className="text-sm">当前仅可查看成果。<Link href={`/projects/${projectId}/deliverables`} className="text-primary">查看成果记录</Link></p> : submitted ? <div role="status" className="space-y-3 rounded-xl bg-done/10 p-4"><p>成果已提交，等待审核。</p><Link className="text-primary underline" href={`/projects/${projectId}/deliverables`}>查看提交及审核记录</Link></div> : <form className="space-y-4" onSubmit={async e => { e.preventDefault(); if (pending) return; setPending(true); setError(""); try { const r = await submitTaskOutcomeAction(projectId, taskId, { requestId: request.current, note, url }); if (!r.ok) setError(r.error); else { setSubmitted(r.data.deliverableId); onSaved?.(); } } catch { setError("提交结果未确认，内容已保留，请重试"); } finally { setPending(false); } }}>
      <label className="block text-sm">完成说明<textarea aria-label="成果完成说明" rows={4} maxLength={10000} className="ac-field mt-2 w-full" placeholder="简述完成了什么，供老师和组员核对" value={note} onChange={e => { setNote(e.target.value); request.current = newRequestId(); }} /></label>
      <label className="block text-sm">成果链接<input type="url" aria-label="成果链接" className="ac-field mt-2 w-full" placeholder="文档、代码仓库或演示网址（可选）" value={url} onChange={e => { setUrl(e.target.value); request.current = newRequestId(); }} /></label>
      <p className="text-xs text-ink-faint">已有文件可在任务资料中关联；需要提交文件时，可从<Link href={`/projects/${projectId}/deliverables`} className="text-primary underline">成果区</Link>选择已有资料。</p>
      {error && <p role="alert" className="text-sm text-high">{error}</p>}<button className="ac-btn" disabled={pending || (!note.trim() && !url.trim())}>{pending ? "提交中…" : "提交审核"}</button>
    </form>}
  </div>;
}
