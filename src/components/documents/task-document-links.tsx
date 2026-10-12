"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { FileText } from "lucide-react";
import type { DocumentList } from "@/contracts/documents";
import type { Result } from "@/contracts/p0-p2";

export function TaskDocumentLinks({ projectId, taskId }: { projectId: string; taskId: string }) {
  const [documents, setDocuments] = useState<DocumentList | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/projects/${projectId}/documents?taskId=${taskId}`, { signal: controller.signal, cache: "no-store" }).then(r => r.json()).then((result: Result<DocumentList>) => { if (result.ok) setDocuments(result.data); else setError(result.error); }).catch(e => { if (e.name !== "AbortError") setError("文档暂时无法加载"); });
    return () => controller.abort();
  }, [projectId, taskId]);
  return <section className="space-y-2 rounded-lg border border-slate-200 p-3">
    <h3 className="flex items-center gap-2 text-sm font-medium"><FileText size={15} />关联文档</h3>
    {error ? <p className="text-xs text-red-600">{error}</p> : documents ? documents.items.length ? <ul className="space-y-1">{documents.items.map(d => <li key={d.id}><Link className="text-sm text-indigo-700 hover:underline" href={`/projects/${projectId}/documents/${d.id}`}>{d.title}</Link></li>)}</ul> : <p className="text-xs text-slate-500">暂无关联文档。在项目文档中选择本任务即可关联。</p> : <p className="text-xs text-slate-500">加载中…</p>}
    <Link href={`/projects/${projectId}/documents`} className="text-xs text-indigo-700 hover:underline">打开项目文档</Link>
  </section>;
}
