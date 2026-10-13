"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

export function ReadControl({ id, beforeCreatedAt, requestId, projectId, label }: {
  id?: string; beforeCreatedAt?: string; requestId?: string; projectId?: string; label?: string;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false), [error, setError] = useState("");
  const locked = useRef(false);
  return <div>
    <button className="ac-btn-ghost" disabled={pending} onClick={() => {
      if (locked.current) return;
      locked.current = true; setError(""); setPending(true);
      void (async () => {
        try {
          const response = await fetch(id ? `/api/notifications/${id}/read` : "/api/notifications/read-all", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: id ? undefined : JSON.stringify({ requestId, beforeCreatedAt, ...(projectId ? { projectId } : {}) }),
            signal: AbortSignal.timeout(15000),
          });
          const result = await response.json();
          if (!response.ok) throw Error(result.error || "未能确认已读状态，请重试");
          if (id ? typeof result.readAt !== "string" : typeof result.markedCount !== "number") throw Error("已读结果暂时不可用，请刷新核对");
          router.refresh();
        } catch (failure) { setError(failure instanceof Error && failure.name === "Error" ? failure.message : "未能确认已读状态，请刷新核对后重试"); }
        finally { locked.current = false; setPending(false); }
      })();
    }}>{pending ? "处理中…" : id ? "标记已读" : label ?? "全部已读"}</button>
    {error && <p role="alert" className="text-sm text-high">{error}</p>}
  </div>;
}
