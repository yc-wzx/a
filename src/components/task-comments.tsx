"use client";
import { useEffect, useRef, useState, useTransition } from "react";
import { useSearchParams } from "next/navigation";
import {
  createTaskCommentAction,
  deleteTaskCommentAction,
  getTaskCommentsAction,
  updateTaskCommentAction,
} from "@/app/(app)/projects/[projectId]/tasks/comments/actions";
import { collaborationAction } from "@/app/(app)/projects/[projectId]/tasks/collaboration-actions";
import { newRequestId } from "@/lib/request-id";
import { SourceTaskButton } from "@/components/tasks/source-task";
type Loaded = Extract<
  Awaited<ReturnType<typeof getTaskCommentsAction>>,
  { ok: true }
>["data"];

export function TaskComments({
  projectId,
  taskId,
  onDirtyChange, refreshVersion = 0,
}: {
  projectId: string;
  taskId: string;
  onDirtyChange?: (dirty: boolean) => void;
  refreshVersion?: number;
}) {
  const search = useSearchParams(),
    focus = search.get("comment") ?? undefined;
  const focused = useRef<string | undefined>(undefined);
  const followLatest = useRef(!focus);
  const [data, setData] = useState<Loaded | null>(null),
    [error, setError] = useState("");
  const [body, setBody] = useState(""),
    [mentioned, setMentioned] = useState<string[]>([]),
    [editing, setEditing] = useState<string | null>(null);
  useEffect(() => { onDirtyChange?.(!!body.trim()); }, [body, onDirtyChange]);
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [requestId, setRequestId] = useState(newRequestId),
    [offset, setOffset] = useState(0);
  useEffect(() => {
    let active = true;
    getTaskCommentsAction(
      projectId,
      taskId,
      { offset, limit: 20 },
      focused.current !== focus ? focus : undefined,
    )
      .then((result) => {
        if (!active) return;
        if (result.ok) {
          focused.current = focus;
          if (focus) followLatest.current = false;
          if (followLatest.current && result.data.page.nextOffset !== null)
            setOffset(Math.floor((result.data.page.total - 1) / 20) * 20);
          setData(result.data);
          setError("");
        } else setError(result.error);
      })
      .catch(() => {
        if (active) setError("评论加载失败，请重试");
      });
    return () => {
      active = false;
    };
  }, [projectId, taskId, offset, focus, refreshVersion]);
  useEffect(() => {
    if (data && focus)
      document
        .getElementById(`comment-${focus}`)
        ?.scrollIntoView({ block: "center" });
  }, [data, focus]);
  async function reload() {
    try {
      const result = await getTaskCommentsAction(projectId, taskId, {
        offset: data?.page.offset ?? offset,
        limit: 20,
      });
      if (result.ok) {
        setData(result.data);
        setError("");
      } else setError(result.error);
    } catch {
      setError("评论加载失败，请重试");
    }
  }
  useEffect(() => {
    let active = true, timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      if (!document.hidden) try {
        const result = await getTaskCommentsAction(projectId, taskId, { offset, limit: 20 });
        if (active) { if (result.ok) { setData(result.data); setError(""); if (followLatest.current && result.data.page.nextOffset !== null) setOffset(Math.floor((result.data.page.total - 1) / 20) * 20); } else { setData(null); setError(result.error); } }
      } catch { if (active) setError("评论连接中断，正在重连；输入已保留"); }
      if (active) timer = setTimeout(poll, 1800);
    };
    timer = setTimeout(poll, 1800);
    return () => { active = false; clearTimeout(timer); };
  }, [projectId, taskId, offset]);
  return (
    <section
      className="space-y-3 border-t border-line pt-4 [overflow-wrap:anywhere]"
      aria-label="团队评论"
    >
      <h3 className="font-semibold">团队评论</h3>
      {error && (
        <p role="alert" className="text-sm text-high">
          {error}{" "}
          <button type="button" onClick={() => start(reload)}>
            重试
          </button>
        </p>
      )}
      {!data && !error && <p>加载评论…</p>}
      {data?.focusUnavailable && (
        <p className="text-sm text-ink-soft">目标评论已删除或不可访问</p>
      )}
      {data?.page.items.map((item) => (
        <article
          id={`comment-${item.id}`}
          key={item.id}
          className="space-y-2 rounded border border-line p-3"
        >
          <p className="text-xs text-ink-soft">
            {item.authorName} ·{" "}
            {new Date(item.updatedAt).toLocaleString("zh-CN", {
              timeZone: "Asia/Shanghai",
            })}
            {item.revision > 1 && " · 已编辑"}
          </p>
          {item.replyToId && <p className="border-l-2 border-line pl-2 text-xs text-ink-faint">回复：{data.page.items.find(m => m.id === item.replyToId)?.body.slice(0, 80) ?? "较早的团队评论"}</p>}
          <p className="whitespace-pre-wrap">{item.body}</p>
          {data.canWrite && data.role !== "teacher" && <SourceTaskButton projectId={projectId} sourceType="comment" sourceId={item.id} revision={String(item.revision)} text={item.body} />}
          <div className="flex gap-3 text-xs text-primary"><button type="button" disabled={!data.canWrite} onClick={() => { setReplyTo(item.id); setEditing(null); }}>回复</button><button type="button" disabled={!data.canWrite} onClick={async () => { const enabled = !data.reactions.some(r => r.messageId === item.id && r.userId === data.actorId); const r = await collaborationAction(projectId, taskId, { op: "react", channel: "team", messageId: item.id, enabled }); if (!r.ok) setError(r.error); else await reload(); }}>收到 {data.reactions.filter(r => r.messageId === item.id).length || ""}</button></div>
          {item.mentionedUserIds.length > 0 && (
            <p className="text-xs text-primary">
              提及：
              {item.mentionedUserIds
                .map(
                  (id) =>
                    data.members.find((m) => m.id === id)?.name ?? "已离组成员",
                )
                .join("、")}
            </p>
          )}
          {data.canWrite && (item.authorId === data.actorId || data.role === "admin") && (
            <div className="flex gap-3 text-xs">
              <button
                type="button"
                disabled={pending}
                onClick={() => {
                  setEditing(item.id);
                  setBody(item.body);
                  setMentioned(
                    item.mentionedUserIds.filter((id) =>
                      data.members.some((m) => m.id === id),
                    ),
                  );
                  setRequestId(newRequestId());
                }}
              >
                编辑
              </button>
              <button
                type="button"
                disabled={pending}
                onClick={() =>
                  start(async () => {
                    try {
                      const result = await deleteTaskCommentAction(
                        projectId,
                        taskId,
                        item.id,
                        {
                          requestId: newRequestId(),
                          expectedRevision: item.revision,
                        },
                      );
                      if (result.ok) await reload();
                      else setError(result.error);
                    } catch {
                      setError("删除未确认，请重试或重新加载评论");
                    }
                  })
                }
              >
                删除
              </button>
            </div>
          )}
        </article>
      ))}
      {data && (
        <>
          {data.page.total === 0 && (
            <p className="text-sm text-ink-soft">暂无评论</p>
          )}
          <nav className="flex gap-3 text-sm">
            {data.page.nextOffset !== null && <button type="button" onClick={() => { followLatest.current = true; setOffset(Math.floor((data.page.total - 1) / 20) * 20); }}>查看最新评论</button>}
            {data.page.offset > 0 && (
              <button
                type="button"
                disabled={pending}
                onClick={() => { followLatest.current = false; setOffset(Math.max(0, data.page.offset - 20)); }}
              >
                上一页
              </button>
            )}
            {data.page.nextOffset !== null && (
              <button
                type="button"
                disabled={pending}
                onClick={() => { followLatest.current = data.page.nextOffset! + 20 >= data.page.total; setOffset(data.page.nextOffset!); }}
              >
                下一页
              </button>
            )}
            <span>共 {data.page.total} 条</span>
          </nav>
          <form
            hidden={!data.canWrite}
            className="sticky bottom-0 space-y-2 border-t border-line bg-surface p-3 shadow-sm"
            onSubmit={(e) => {
              e.preventDefault();
              if (pending) return;
              start(async () => {
                try {
                  const item = data.page.items.find((i) => i.id === editing);
                  const result = item
                    ? await updateTaskCommentAction(
                        projectId,
                        taskId,
                        item.id,
                        {
                          requestId,
                          expectedRevision: item.revision,
                          body,
                          mentionedUserIds: mentioned,
                        },
                      )
                    : await createTaskCommentAction(projectId, taskId, {
                        requestId,
                        replyToId: replyTo,
                        body,
                        mentionedUserIds: mentioned,
                      });
                  if (result.ok) {
                    setBody("");
                    setMentioned([]);
                    setEditing(null);
                    setReplyTo(null);
                    setRequestId(newRequestId());
                    setError("");
                    await reload();
                  } else setError(result.error);
                } catch {
                  setError("保存未确认，请保留内容并重试");
                }
              });
            }}
          >
            {replyTo && <p className="text-xs">回复已选评论 <button type="button" onClick={() => setReplyTo(null)}>取消回复</button></p>}
            <label className="block text-sm">
              {editing ? "编辑评论" : "发表评论"}
              <textarea
                className="ac-field mt-1 w-full"
                maxLength={10000}
                value={body}
                required
                onChange={(e) => {
                  setBody(e.target.value);
                  setRequestId(newRequestId());
                }}
              />
            </label>
            <details><summary className="cursor-pointer text-xs text-ink-faint">@ 提及成员</summary><label className="block text-sm">
              @ 提及成员
              <select
                aria-label="@ 提及成员"
                multiple
                className="ac-field mt-1 w-full"
                value={mentioned}
                onChange={(e) => {
                  setMentioned(
                    Array.from(e.target.selectedOptions, (o) => o.value),
                  );
                  setRequestId(newRequestId());
                }}
              >
                {data.members
                  .filter((m) => m.id !== data.actorId)
                  .map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
              </select>
            </label></details>
            <div className="flex gap-2">
              <button type="submit" className="ac-btn" disabled={pending}>
                {pending ? "保存中…" : editing ? "保存评论" : "发布评论"}
              </button>
              {editing && (
                <button
                  type="button"
                  className="ac-btn-ghost"
                  onClick={() => {
                    setEditing(null);
                    setBody("");
                    setMentioned([]);
                    setRequestId(newRequestId());
                  }}
                >
                  取消编辑
                </button>
              )}
            </div>
          </form>
        </>
      )}
    </section>
  );
}
