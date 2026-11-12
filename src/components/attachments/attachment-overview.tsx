"use client";

import { useEffect, useState } from "react";
import { TaskLink } from "@/components/tasks/task-link";
import type { AttachmentOverviewPage } from "@/lib/attachment-overview";

const typeLabels = { project: "项目资料", task: "任务", document: "文档", deliverable: "成果" };
export function AttachmentOverview({ projectId }: { projectId: string }) {
  const [query, setQuery] = useState("");
  const [type, setType] = useState("all");
  const [offset, setOffset] = useState(0);
  const [page, setPage] = useState<AttachmentOverviewPage | null>(null);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(`/api/projects/${projectId}/attachments?${new URLSearchParams({ query, type, offset: String(offset) })}`, { cache: "no-store", signal: controller.signal });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error);
        setPage(result); setError("");
      } catch (error) {
        if (!controller.signal.aborted) setError(error instanceof Error ? error.message : "附件加载失败");
      }
    }, 200);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [projectId, query, type, offset, reload]);
  useEffect(() => {
    const refresh = () => setReload(value => value + 1);
    window.addEventListener("agilecampus-attachments-updated", refresh);
    return () => window.removeEventListener("agilecampus-attachments-updated", refresh);
  }, []);
  return <section className="ac-card space-y-4 p-5" aria-label="项目全部附件">
    <div className="flex items-center justify-between"><h2 className="font-semibold">项目全部附件</h2><button className="text-xs text-primary" onClick={() => setReload(value => value + 1)}>刷新</button></div>
    <div className="flex gap-3"><input aria-label="搜索附件" className="ac-field min-w-0 flex-1" placeholder="搜索文件名、上传人或来源" value={query} onChange={event => { setQuery(event.target.value); setOffset(0); setPage(null); }} />
      <select aria-label="附件来源" className="ac-field w-auto" value={type} onChange={event => { setType(event.target.value); setOffset(0); setPage(null); }}><option value="all">全部来源</option>{Object.entries(typeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div>
    {error ? <p role="alert" className="text-sm text-high">{error}<button className="ml-3 underline" onClick={() => setReload(value => value + 1)}>重试</button></p> : !page ? <p role="status" className="text-sm text-ink-soft">正在读取附件…</p> : <>
      {!page.items.length && <p className="text-sm text-ink-soft">没有符合条件的可见附件。</p>}
      <ul className="divide-y divide-line">{page.items.map(file => <li key={file.id} className="flex items-start justify-between gap-4 py-3">
        <div className="min-w-0"><a className="break-all text-sm font-medium text-primary hover:underline" href={file.href + "?download=1"}>{file.filename}</a>
          <p className="mt-1 text-xs text-ink-soft">{file.uploaderName || "已离组成员"} · {new Date(file.createdAt).toLocaleDateString("zh-CN", { timeZone: "Asia/Shanghai" })} · {file.size < 1024 ? `${file.size} B` : file.size < 1048576 ? `${(file.size / 1024).toFixed(1)} KB` : `${(file.size / 1048576).toFixed(2)} MB`}</p>
          <TaskLink href={file.sourceHref} className="mt-2 block break-words text-xs text-primary">{typeLabels[file.sourceType]} · {file.sourceTitle} ↗</TaskLink>
        </div><a className="shrink-0 text-xs text-primary" href={file.href + "?download=1"}>下载</a>
      </li>)}</ul>
      {(offset > 0 || page.nextOffset !== null) && <nav aria-label="附件分页" className="flex gap-4 text-sm text-primary">
        {offset > 0 && <button onClick={() => { setPage(null); setOffset(Math.max(0, offset - 50)); }}>上一页</button>}
        {page.nextOffset !== null && <button onClick={() => { setPage(null); setOffset(page.nextOffset!); }}>下一页</button>}
      </nav>}
    </>}
  </section>;
}
