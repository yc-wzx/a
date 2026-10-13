"use client";
import { useRef, useState, useTransition } from "react";
import { markAllNotificationsReadAction, markNotificationReadAction } from "./actions";

export function ReadControl({ id, beforeCreatedAt, requestId, projectId, label }: {
  id?: string; beforeCreatedAt?: string; requestId?: string; projectId?: string; label?: string;
}) {
  const [pending, startTransition] = useTransition(), [error, setError] = useState("");
  const locked = useRef(false);
  return <div>
    <button className="ac-btn-ghost" disabled={pending} onClick={() => {
      if (locked.current) return;
      locked.current = true; setError("");
      startTransition(async () => {
        try {
          if (!id && (!requestId || !beforeCreatedAt)) throw Error("通知界线暂时不可用，请刷新后重试");
          const result = id ? await markNotificationReadAction(id) : await markAllNotificationsReadAction({
            requestId: requestId!, beforeCreatedAt: beforeCreatedAt!, ...(projectId ? { projectId } : {}),
          });
          if (!result.ok) setError(result.error);
        } catch (failure) { setError(failure instanceof Error && failure.name === "Error" ? failure.message : "未能确认已读状态，请刷新核对后重试"); }
        finally { locked.current = false; }
      });
    }}>{pending ? "处理中…" : id ? "标记已读" : label ?? "全部已读"}</button>
    {error && <p role="alert" className="text-sm text-high">{error}</p>}
  </div>;
}
