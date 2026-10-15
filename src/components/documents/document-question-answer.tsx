"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import type { DocumentSummary } from "@/contracts/documents";
import type { DocumentAnswer } from "@/contracts/document-answers";
import { DocumentReferencePicker } from "./document-reference-picker";

export function DocumentQuestionAnswer({ projectId }: { projectId: string }) {
  const [selected, setSelected] = useState<DocumentSummary[]>([]);
  const [picking, setPicking] = useState(false);
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<DocumentAnswer | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const serial = useRef(0);
  function invalidate() { serial.current++; setAnswer(null); setError(""); }
  async function ask() {
    if (pending || !question.trim() || !selected.length) return;
    const current = ++serial.current; setPending(true); setAnswer(null); setError("");
    try {
      // Refresh source versions at the moment of asking; the server checks
      // them again after the personal model returns.
      const documents = await Promise.all(selected.map(async doc => {
        const res = await fetch(`/api/projects/${projectId}/documents/${doc.id}`, { cache: "no-store" }); const result = await res.json();
        if (!res.ok || !result.ok) throw new Error(result.error || "资料暂时不可访问，请重新选择");
        return { id: doc.id, revision: result.data.revision, epoch: result.data.epoch };
      }));
      const res = await fetch(`/api/projects/${projectId}/documents/ask`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question: question.trim(), documents }) });
      const result = await res.json();
      if (!res.ok || !result.ok) throw new Error(result.error || "资料问答失败");
      if (current === serial.current) setAnswer(result.data);
    } catch (e) { if (current === serial.current) setError(e instanceof Error ? e.message : "网络异常，请重试"); }
    finally { setPending(false); }
  }
  return <div className="space-y-3" aria-label="项目资料问答">
    <p className="text-xs leading-5 text-ink-soft">选择本项目最多 3 篇文档，回答附原文段落链接。使用你自己的 AI 配置，问答仅在当前页面展示。</p>
    <div className="flex flex-wrap items-center gap-2">
      {selected.map(doc => <span key={doc.id} className="inline-flex max-w-full items-center gap-2 rounded-lg bg-sunken px-2 py-1 text-xs"><span className="truncate">{doc.title}</span><button disabled={pending} aria-label={`移除资料：${doc.title}`} onClick={() => { invalidate(); setSelected(list => list.filter(item => item.id !== doc.id)); }}>×</button></span>)}
      <button className="ac-btn-ghost text-xs" disabled={pending || selected.length >= 3} onClick={() => setPicking(true)}>选择资料（{selected.length}/3）</button>
    </div>
    <div className="flex flex-wrap gap-2">{["本轮需求有哪些？", "这个功能的验收要求是什么？", "老师提出了哪些修改意见？"].map(text => <button className="text-xs text-primary underline decoration-dotted underline-offset-4 disabled:opacity-50" disabled={pending} key={text} onClick={() => { invalidate(); setQuestion(text); }}>{text}</button>)}</div>
    <label className="block text-sm text-ink">问题<textarea className="ac-field mt-1 min-h-20 w-full text-sm" aria-label="资料问题" value={question} maxLength={1200} disabled={pending} onChange={event => { invalidate(); setQuestion(event.target.value); }} placeholder="例如：本次试用需要验证哪些任务流程？" /></label>
    <div className="flex items-center justify-between gap-2"><Link href="/settings#my-ai" className="text-xs text-primary underline">配置我的 AI 助手</Link><button disabled={pending || !question.trim() || !selected.length} className="ac-btn px-3 py-2 text-sm" onClick={() => void ask()}>{pending ? "正在查阅资料…" : "根据资料回答"}</button></div>
    {error && <p role="alert" className="text-sm text-high">{error}</p>}
    {answer && <div className="space-y-3 rounded-xl border border-line bg-primary-soft/30 p-3" aria-live="polite">
      <p className="whitespace-pre-wrap text-sm leading-6 text-ink">{answer.answer}</p>
      {answer.limited && <p className="text-xs text-ink-soft">资料较长，本次使用与问题相关的部分段落；请通过出处核对上下文。</p>}
      {answer.citations.length > 0 && <div className="space-y-2 border-t border-line pt-2"><p className="text-xs font-medium text-ink">原文出处</p>{answer.citations.map((cite, index) => <div key={`${cite.sourceId}-${index}`} className="text-xs"><Link href={cite.href} className="text-primary underline">[{cite.sourceId}] {cite.title} · 查看原文</Link><blockquote className="mt-1 border-l-2 border-primary/30 pl-2 leading-5 text-ink-soft">{cite.quote}</blockquote></div>)}<p className="text-xs text-ink-soft">AI 回答供参考，请以原文和师生确认的要求为准。</p></div>}
    </div>}
    {picking && <DocumentReferencePicker projectId={projectId} query="" title="选择问答资料" onChoose={doc => { invalidate(); setSelected(list => list.some(item => item.id === doc.id) ? list : [...list, doc].slice(0, 3)); setPicking(false); }} onClose={() => setPicking(false)} />}
  </div>;
}
