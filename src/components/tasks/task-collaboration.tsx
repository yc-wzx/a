"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { TaskComments } from "@/components/task-comments";
import { readCollaborationAction, sendDiscussionAction, collaborationAction } from "@/app/(app)/projects/[projectId]/tasks/collaboration-actions";
import { createTaskCommentAction } from "@/app/(app)/projects/[projectId]/tasks/comments/actions";
import { newRequestId } from "@/lib/request-id";
import { SourceTaskButton } from "./source-task";
import { useSearchParams } from "next/navigation";
type Data = Extract<Awaited<ReturnType<typeof readCollaborationAction>>, { ok: true }>["data"];
export function TaskCollaboration({ projectId, taskId, onDirtyChange }: { projectId: string; taskId: string; onDirtyChange?: (key: string, dirty: boolean) => void }) {
  const search = useSearchParams(), focusDiscussion = search.get("discussion");
  const [tab, setTab] = useState<"team" | "discussion">(focusDiscussion ? "discussion" : "team");
  const [data, setData] = useState<Data | null>(null), [error, setError] = useState("");
  const [body, setBody] = useState(""), [replyTo, setReplyTo] = useState<string | null>(null), [mentions, setMentions] = useState<string[]>([]);
  const [pending, setPending] = useState(false), [older, setOlder] = useState<Data["messages"]>([]);
  const [conclusion, setConclusion] = useState<string | null>(null), [publicVersion, setPublicVersion] = useState(0);
  const request = useRef(newRequestId()), conclusionRequest = useRef(newRequestId());
  useEffect(() => { onDirtyChange?.("discussion", !!body.trim() || !!conclusion?.trim()); }, [body, conclusion, onDirtyChange]);
  const scroll = useRef<HTMLDivElement>(null), atBottom = useRef(true), lastCount = useRef(0);
  const [newCount, setNewCount] = useState(0);
  const refresh = useCallback(async () => {
    try {
      const r = await readCollaborationAction(projectId, taskId);
      if (r.ok) { setData(r.data); setError(""); if (!r.data.canDiscuss) { setBody(""); setOlder([]); setReplyTo(null); } }
      else { setData(null); setOlder([]); setError(r.error); }
    } catch { setError("连接中断，正在重连；未发送的内容已保留"); }
  }, [projectId, taskId]);
  useEffect(() => {
    let disposed = false, timer: ReturnType<typeof setTimeout>;
    const poll = async () => { if (!document.hidden) await refresh(); if (!disposed) timer = setTimeout(poll, 1800); };
    void poll(); return () => { disposed = true; clearTimeout(timer); };
  }, [refresh]);
  useEffect(() => {
    if (!data || tab !== "discussion") return;
    if (atBottom.current) { scroll.current?.scrollTo({ top: scroll.current.scrollHeight }); lastCount.current = data.messages.length; }
    else if (data.messages.length > lastCount.current) setNewCount(data.messages.length - lastCount.current);
  }, [data, tab]);
  const canRead = data !== null && (tab === "team" || data.canDiscuss), lastMessage = data?.messages.at(-1)?.id, teamUnread = data?.unread.team;
  useEffect(() => { if (canRead) void collaborationAction(projectId, taskId, { op: "read", channel: tab }); }, [projectId, taskId, tab, canRead, lastMessage, teamUnread]); // mark only the visible channel
  async function send() {
    if (!body.trim() || pending) return; setPending(true); setError("");
    try {
      const r = await sendDiscussionAction(projectId, taskId, { requestId: request.current, body, replyToId: replyTo, mentionedUserIds: mentions });
      if (!r.ok) setError(r.error); else { setBody(""); setReplyTo(null); setMentions([]); request.current = newRequestId(); atBottom.current = true; await refresh(); }
    } catch { setError("发送结果未确认，请重试；同一消息不会重复发送"); } finally { setPending(false); }
  }
  return <section className="flex h-full min-h-0 flex-col" aria-label="任务沟通">
    <div className="flex gap-2 border-b border-line pb-3" role="tablist" aria-label="沟通范围">
      <button role="tab" aria-selected={tab === "team"} className={tab === "team" ? "ac-btn" : "ac-btn-ghost"} onClick={() => setTab("team")}>团队评论{data?.unread.team ? ` (${data.unread.team})` : ""}</button>
      <button role="tab" aria-selected={tab === "discussion"} className={tab === "discussion" ? "ac-btn" : "ac-btn-ghost"} onClick={() => setTab("discussion")}>任务讨论{data?.unread.discussion ? ` (${data.unread.discussion})` : ""}</button>
    </div>
    {error && <p role="alert" className="py-2 text-sm text-high">{error} <button onClick={() => void refresh()}>重连</button></p>}
    <div hidden={tab !== "team"} className="min-h-0 flex-1 overflow-y-auto pt-2">
      <p className="text-xs text-ink-faint">全队可见 · 老师和非执行成员也可参与</p>
      <TaskComments refreshVersion={publicVersion} projectId={projectId} taskId={taskId} onDirtyChange={value => onDirtyChange?.("comments", value)} />
    </div>
    {tab === "discussion" && (!data ? <p className="p-4 text-sm">正在核对讨论权限…</p> : !data.canDiscuss ? <div className="my-5 rounded-xl bg-sunken p-5 text-sm"><strong>仅任务讨论成员可见</strong><p className="mt-2">你可以在“团队评论”中交流，或请任务发起人邀请你加入讨论。</p></div> : <>
      <div className="py-3 text-xs text-ink-soft">仅 {data.participants.map(m => m.name).join("、")} 可见</div>
      <div ref={scroll} onScroll={e => { const el = e.currentTarget; atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60; if (atBottom.current) { setNewCount(0); lastCount.current = data.messages.length; } }} className="min-h-48 flex-1 space-y-3 overflow-y-auto rounded-xl bg-sunken/50 p-3" aria-live="polite">
        {data.hasMore && <button className="text-xs text-primary" onClick={async () => { const before = older[0]?.createdAt ?? data.messages[0]?.createdAt; const r = await readCollaborationAction(projectId, taskId, before); if (r.ok) setOlder(o => [...r.data.messages, ...o].filter((v, i, a) => a.findIndex(m => m.id === v.id) === i)); }}>加载更早消息</button>}
        {[...older, ...data.messages].filter((v, i, a) => a.findIndex(m => m.id === v.id) === i).map(m => <article key={m.id} className="rounded-lg border border-line bg-surface p-3">
          <p className="text-xs text-ink-faint">{m.authorName} · {new Date(m.createdAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}</p>
          {m.replyToId && <p className="mt-1 border-l-2 border-line pl-2 text-xs text-ink-faint">回复：{[...older, ...data.messages].find(x => x.id === m.replyToId)?.body.slice(0, 80) ?? "较早的讨论消息"}</p>}
          <p id={`discussion-${m.id}`} className="my-2 whitespace-pre-wrap break-words text-sm">{m.body}</p>
          {data.canWrite && <SourceTaskButton projectId={projectId} sourceType="discussion" sourceId={m.id} revision={m.createdAt} text={m.body} />}
          {m.mentionedUserIds.length > 0 && <p className="text-xs text-primary">{m.mentionedUserIds.map(id => "@" + (data.participants.find(p => p.id === id)?.name ?? "原成员")).join(" ")}</p>}
          <div className="flex gap-3 text-xs text-ink-soft"><button disabled={!data.canWrite} onClick={() => setReplyTo(m.id)}>回复</button><button disabled={!data.canWrite} onClick={async () => { const r = await collaborationAction(projectId, taskId, { op: "react", channel: "discussion", messageId: m.id, enabled: !data.reactions.some(x => x.messageId === m.id && x.userId === data.actorId) }); if (!r.ok) setError(r.error); await refresh(); }}>收到 {data.reactions.filter(r => r.messageId === m.id).length || ""}</button></div>
        </article>)}
        {!data.messages.length && <p className="text-sm text-ink-faint">任务已建立讨论空间，可以开始协商分工。</p>}
      </div>
      {newCount > 0 && <button className="py-1 text-xs text-primary" onClick={() => { atBottom.current = true; scroll.current?.scrollTo({ top: scroll.current.scrollHeight }); setNewCount(0); }}>有新消息 · 查看最新</button>}
      {data.canWrite ? <div className="space-y-2 pt-3">
        {replyTo && <p className="text-xs">回复已选消息 <button onClick={() => setReplyTo(null)}>取消</button></p>}
        <textarea disabled={pending} aria-label="任务讨论消息" className="ac-field w-full" rows={3} maxLength={10000} placeholder="与执行成员协商；内容不会自动公开" value={body} onChange={e => { setBody(e.target.value); request.current = newRequestId(); }} />
        <details><summary className="cursor-pointer text-xs text-ink-faint">@ 讨论成员 / 管理成员</summary><div className="my-2 flex flex-wrap gap-3">{data.participants.filter(m => m.id !== data.actorId).map(m => <label key={m.id} className="text-xs"><input type="checkbox" checked={mentions.includes(m.id)} onChange={e => { setMentions(a => e.target.checked ? [...a, m.id] : a.filter(id => id !== m.id)); request.current = newRequestId(); }} /> {m.name}</label>)}</div>{data.canManageDiscussion && <div className="my-2 space-y-1">{data.invitedUserIds.map(id => <p key={id} className="text-xs">{data.members.find(m => m.id === id)?.name} <button type="button" className="text-high" onClick={async () => { const r = await collaborationAction(projectId, taskId, { op: "invite", userId: id, enabled: false }); if (!r.ok) setError(r.error); await refresh(); }}>移出讨论</button></p>)}</div>}<select disabled={!data.canManageDiscussion} aria-label="邀请讨论成员" className="ac-field text-xs" defaultValue="" onChange={async e => { if (!e.target.value) return; const r = await collaborationAction(projectId, taskId, { op: "invite", userId: e.target.value, enabled: true }); if (!r.ok) setError(r.error); await refresh(); }}><option value="">发起人可邀请团队成员…</option>{data.members.filter(m => !data.participants.some(p => p.id === m.id)).map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</select></details>
        <div className="flex items-center justify-between gap-2"><button className="text-xs text-primary" onClick={() => { conclusionRequest.current = newRequestId(); setConclusion(""); }}>向全队发布结论</button><button className="ac-btn" disabled={pending || !body.trim()} onClick={() => void send()}>{pending ? "发送中…" : "发送"}</button></div>
      </div> : <p className="py-3 text-xs text-ink-faint">项目已归档，仅可查看讨论历史。</p>}
      {conclusion !== null && <div className="mt-3 rounded-xl border border-primary bg-surface p-3"><strong className="text-sm">确认公开到团队评论</strong><p className="my-2 text-xs text-ink-faint">请自行整理结论，全队和老师都能查看。不会自动复制讨论内容。</p><textarea aria-label="公开结论" className="ac-field w-full" rows={3} value={conclusion} onChange={e => { setConclusion(e.target.value); conclusionRequest.current = newRequestId(); }} /><div className="mt-2 flex justify-end gap-3"><button onClick={() => setConclusion(null)}>取消</button><button className="ac-btn" disabled={pending || !conclusion.trim()} onClick={async () => { setPending(true); try { const r = await createTaskCommentAction(projectId, taskId, { requestId: conclusionRequest.current, body: conclusion, mentionedUserIds: [] }); if (!r.ok) setError(r.error); else { setConclusion(null); setPublicVersion(v => v + 1); setTab("team"); } } catch { setError("公开结果未确认，请核对后重试"); } finally { setPending(false); } }}>确认公开</button></div></div>}
    </>)}
  </section>;
}
