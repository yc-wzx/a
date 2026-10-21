"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ProjectDoingLimit } from "@/contracts/task-enhancements";
import { setProjectDoingLimitAction } from "@/app/(app)/projects/[projectId]/tasks/enhancement-actions";
import { newRequestId } from "@/lib/request-id";

export function ProjectDoingLimitControl({ data }: { data: ProjectDoingLimit }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(data.doingLimit?.toString() ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  return <div className={`rounded-field border px-3 py-2 text-sm ${data.exceeded ? "border-high/30 bg-high/5" : "border-line bg-sunken"}`}>
    <div className="flex flex-wrap items-center justify-between gap-2"><span className={data.exceeded ? "text-high" : "text-ink-soft"}>
      全项目进行中：<strong>{data.doingCount}</strong> 个主任务{data.doingLimit === null ? " · 未设置数量提醒" : ` / 建议最多 ${data.doingLimit} 个`}
      {data.exceeded && " · 建议先完成已有工作"}
    </span>{data.canManage && <button type="button" className="text-xs text-primary hover:underline" onClick={() => { setValue(data.doingLimit?.toString() ?? ""); setOpen(!open); }}>设置数量提醒</button>}</div>
    {open && data.canManage && <form className="mt-2 flex flex-wrap items-end gap-2" onSubmit={(event) => {
      event.preventDefault(); startTransition(async () => {
        setError(null);
        try {
          const result = await setProjectDoingLimitAction(data.projectId, { requestId: newRequestId(), expectedRevision: data.revision, doingLimit: value.trim() ? Number(value) : null });
          if (!result.ok) { setError(result.error); if (result.code === "CONFLICT") router.refresh(); return; }
          setOpen(false); router.refresh();
        } catch { setError("保存状态暂时无法确认，请刷新后重试"); }
      });
    }}><label className="space-y-1 text-xs text-ink-soft">进行中主任务上限（留空关闭）<input type="number" min={1} max={99} step={1} value={value} disabled={pending} onChange={(event) => setValue(event.target.value)} className="ac-field w-48" /></label><button className="ac-btn-ghost text-sm" disabled={pending}>{pending ? "保存中…" : "保存"}</button></form>}
    {open && <p className="mt-1 text-xs text-ink-faint">按整个项目统计，不受当前筛选影响。只作提醒，仍可移动任务。</p>}
    {error && <p role="alert" className="mt-1 text-xs text-high">{error}</p>}
  </div>;
}
