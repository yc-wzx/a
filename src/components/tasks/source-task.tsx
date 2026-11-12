"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { TaskLink } from "./task-link";

type SourceType = "comment" | "discussion" | "retrospective" | "meeting";
type Member = { id: string; name: string };

export function SourceTaskButton({
  projectId, sourceType, sourceId, revision, text, disabled = false, members = [],
}: {
  projectId: string; sourceType: SourceType; sourceId: string; revision: string;
  text: string; disabled?: boolean; members?: Member[];
}) {
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const requestId = useRef("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [assigneeId, setAssigneeId] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [shared, setShared] = useState(false);
  const privateSource = sourceType === "discussion";

  function open() {
    setTitle(sourceType === "meeting" ? "" : text.split(/\r?\n/).find(line => line.trim())?.slice(0, 100) || "处理讨论事项");
    setDescription(privateSource || sourceType === "meeting" ? "" : text);
    setAssigneeId(""); setDueDate(""); setShared(false); setError("");
    requestId.current = crypto.randomUUID();
    dialog.current?.showModal();
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/projects/${projectId}/source-tasks`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId: requestId.current, sourceType, sourceId,
          expectedSourceRevision: revision, title, description, confirmShare: shared,
          ...(assigneeId ? { assigneeId } : {}), ...(dueDate ? { dueDate } : {}),
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "创建失败，请重试");
      setResult(data.href); dialog.current?.close(); router.refresh();
    } catch (error) {
      setError(error instanceof Error ? error.message : "创建失败，请重试");
    } finally { setBusy(false); }
  }

  return <>
    <button type="button" disabled={disabled} className="text-xs text-primary" onClick={open}>
      {sourceType === "meeting" ? "添加后续任务" : "转为任务"}
    </button>
    {result && <TaskLink className="ml-3 text-xs text-primary" href={result}>查看已创建任务</TaskLink>}
    <dialog ref={dialog} aria-label="整理为下一步任务"
      className="m-auto max-h-[88dvh] w-[600px] max-w-[90vw] rounded-xl border border-line bg-surface p-6 text-ink shadow-xl backdrop:bg-black/40"
      onKeyDown={event => { if (event.key === "Escape") event.stopPropagation(); }}
      onCancel={event => { if (busy) event.preventDefault(); }}>
      <form className="space-y-4" onSubmit={submit} onChange={() => { requestId.current = crypto.randomUUID(); }}>
        <h3 className="font-semibold">{sourceType === "meeting" ? "会议后续任务" : "整理为下一步任务"}</h3>
        <p className="max-h-28 overflow-auto whitespace-pre-wrap rounded bg-sunken p-3 text-sm">{text}</p>
        {privateSource && <p className="text-sm text-high">新任务对全队和老师可见，请整理可以公开的内容。</p>}
        <label className="block text-sm">任务标题<input autoFocus required className="ac-field block w-full" maxLength={200} value={title} onChange={event => setTitle(event.target.value)} /></label>
        <label className="block text-sm">任务说明<textarea className="ac-field block w-full" rows={3} maxLength={10000} value={description} onChange={event => setDescription(event.target.value)} /></label>
        <div className="grid grid-cols-2 gap-4">
          {members.length > 0 && <label className="block text-sm">负责人<select className="ac-field w-full" value={assigneeId} onChange={event => setAssigneeId(event.target.value)}><option value="">暂不指定</option>{members.map(member => <option key={member.id} value={member.id}>{member.name}</option>)}</select></label>}
          <label className="block text-sm">截止日期<input type="date" className="ac-field w-full" value={dueDate} onChange={event => setDueDate(event.target.value)} /></label>
        </div>
        {privateSource && <label className="flex gap-2 text-sm"><input type="checkbox" checked={shared} onChange={event => setShared(event.target.checked)} />我确认将整理的标题与说明公开给全队</label>}
        {error && <p role="alert" className="text-sm text-high">{error}</p>}
        <div className="flex justify-end gap-3"><button type="button" disabled={busy} onClick={() => dialog.current?.close()}>取消</button><button className="ac-btn" disabled={busy || !title.trim() || privateSource && !shared}>{busy ? "创建中…" : "确认创建任务"}</button></div>
      </form>
    </dialog>
  </>;
}

export function TaskOrigin({ projectId, taskId }: { projectId: string; taskId: string }) {
  const [data, setData] = useState<{ label: string; href: string | null } | null>(null);
  useEffect(() => {
    let active = true;
    fetch(`/api/projects/${projectId}/source-tasks?taskId=${taskId}`, { cache: "no-store" })
      .then(async response => { if (response.ok && active) setData(await response.json()); }).catch(() => {});
    return () => { active = false; };
  }, [projectId, taskId]);
  return data ? <p className="text-sm">{data.href ? <Link href={data.href} className="text-primary underline">{data.label}</Link> : data.label}</p> : null;
}
