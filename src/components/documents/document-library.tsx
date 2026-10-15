"use client";

import Link from "next/link";
import { displayDateTime } from "@/lib/display-time";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { FileText, Plus, Search, Trash2, Upload, RotateCcw, Lock, Star } from "lucide-react";
import type { DocumentKnowledge, DocumentList, DocumentSummary } from "@/contracts/documents";
import { documentMutation, documentRequest, errorMessage } from "./http";
import { courseDocumentTemplates, courseTemplateContent } from "./course-templates";
import { ProjectDocumentGuide, PersonalDocumentShortcuts } from "./document-knowledge";

const folderOptions = ["调研", "设计", "开发", "测试", "汇报"];
export function DocumentLibrary({ projectId, initial, initialKnowledge, canCreate }: { projectId: string; initial: DocumentList; initialKnowledge: DocumentKnowledge; canCreate: boolean }) {
  const router = useRouter();
  const [list, setList] = useState(initial);
  const [knowledge, setKnowledge] = useState(initialKnowledge);
  const [offset, setOffset] = useState(0);
  const [knownFolders, setKnownFolders] = useState(initial.items.map((item) => item.folder).filter(Boolean));
  const [query, setQuery] = useState("");
  const [folder, setFolder] = useState("");
  const [trash, setTrash] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [newFolder, setNewFolder] = useState("");
  const [privateDraft, setPrivateDraft] = useState(false);
  const [markdown, setMarkdown] = useState<string | null>(null);
  const [importName, setImportName] = useState("");
  const [templateId, setTemplateId] = useState("");
  const file = useRef<HTMLInputElement>(null);
  const requestNumber = useRef(0);
  const base = `/api/projects/${projectId}/documents`;
  async function reloadKnowledge() { setKnowledge(await documentRequest<DocumentKnowledge>(`${base}/knowledge`)); }
  async function bookmark(item: DocumentSummary) {
    if (busy) return;
    setBusy(true); setError("");
    try { await documentMutation(`${base}/${item.id}/bookmark`, "POST", { bookmarked: !item.bookmarked }); await Promise.all([load({ offset }), reloadKnowledge()]); }
    catch(e) { setError(errorMessage(e)); } finally { setBusy(false); }
  }
  async function load(next: { q?: string; folder?: string; trash?: boolean; offset?: number } = {}) {
    const number = ++requestNumber.current;
    setBusy(true); setError("");
    const params = new URLSearchParams({ q: next.q ?? query, folder: next.folder ?? folder,
      trash: String(next.trash ?? trash), offset: String(next.offset ?? 0) });
    try {
      const result = await documentRequest<DocumentList>(`${base}?${params}`);
      if (number === requestNumber.current) {
        setList(result); setOffset(next.offset ?? 0);
        setKnownFolders((current) => [...new Set([...current, ...result.items.map((item) => item.folder).filter(Boolean)])]);
      }
    } catch (e) { if (number === requestNumber.current) setError(errorMessage(e)); }
    finally { if (number === requestNumber.current) setBusy(false); }
  }
  async function create() {
    if (!title.trim()) { setError("请填写文档标题。"); return; }
    setBusy(true); setError("");
    try {
      const content = markdown === null ? courseTemplateContent(templateId) : (await import("./extensions")).importDocumentMarkdown(markdown);
      const result = await documentMutation<DocumentSummary>(base, "POST", {
        title: title.trim(), folder: newFolder.trim() || "未分类", visibility: privateDraft ? "private" : "project", content });
      router.push(`/projects/${projectId}/documents/${result.id}`);
    } catch (e) { setError(errorMessage(e)); setBusy(false); }
  }
  async function restore(document: DocumentSummary) {
    setBusy(true); setError("");
    try { await documentMutation(`${base}/${document.id}`, "POST", { operation: "restore", expectedRevision: document.revision }); await load(); }
    catch (e) { setError(errorMessage(e)); setBusy(false); }
  }
  return <main className="space-y-5 py-5" data-document-library>
    <header className="flex items-start justify-between gap-4">
      <div><h1 className="font-display text-2xl font-semibold text-ink">项目文档</h1><p className="mt-1 text-sm text-ink-soft">一起写清需求、设计与测试，让资料跟着任务走。</p></div>
      {canCreate && <div className="flex gap-2"><button className="ac-btn-ghost" onClick={() => file.current?.click()}><Upload size={15} />导入 Markdown</button><button className="ac-btn" onClick={() => { setCreateOpen(true); setMarkdown(null); setImportName(""); setTemplateId(""); setTitle(""); setNewFolder(folder); setPrivateDraft(false); setError(""); }}><Plus size={15} />新建文档</button></div>}
      <input ref={file} type="file" accept=".md,.markdown,text/markdown,text/plain" className="hidden" onChange={async (event) => {
        const selected = event.target.files?.[0]; if (!selected) return;
        if (selected.size > 300000) { setError("Markdown 文件需小于 300 KB。"); event.target.value = ""; return; }
        try { setMarkdown(await selected.text()); setImportName(selected.name); setTitle(selected.name.replace(/\.(md|markdown)$/i, "")); setTemplateId(""); setNewFolder(folder); setPrivateDraft(false); setError(""); setCreateOpen(true); }
        catch { setError("无法读取文件，请重新选择。"); }
        event.target.value = "";
      }} />
    </header>
    {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}
    <form onSubmit={event => { event.preventDefault(); void load(); }} className="flex gap-2"><label className="flex flex-1 items-center gap-2 rounded-lg border border-line bg-surface px-3"><Search size={16} className="text-ink-faint" /><input aria-label="搜索文档标题或正文" placeholder="搜索标题或正文" value={query} onChange={event => setQuery(event.target.value)} className="w-full bg-transparent py-2.5 text-sm outline-none" /></label><button className="ac-btn-ghost" disabled={busy}>搜索</button></form>
    <div className="grid grid-cols-[minmax(0,1fr)_230px] items-start gap-4">
      <div className="min-w-0 space-y-4">
        {!trash && !query && !folder && <ProjectDocumentGuide projectId={projectId} value={knowledge} onChange={reloadKnowledge} />}
        <nav aria-label="文档目录" className="flex flex-wrap items-center gap-1 border-b border-line pb-2">
          <button onClick={() => { setFolder(""); setTrash(false); void load({ folder: "", trash: false }); }} className={`rounded px-2 py-2 text-xs ${!folder && !trash ? "bg-primary-soft font-medium text-primary" : "text-ink-soft hover:bg-canvas"}`}>全部文档</button>
          {[...new Set([...folderOptions, ...knownFolders])].map(item => <button key={item} onClick={() => { setFolder(item); setTrash(false); void load({ folder: item, trash: false }); }} className={`rounded px-2 py-2 text-xs ${folder === item && !trash ? "bg-primary-soft font-medium text-primary" : "text-ink-soft hover:bg-canvas"}`}>{item}</button>)}
          <button onClick={() => { setTrash(true); setFolder(""); void load({ trash: true, folder: "" }); }} className={`ml-auto inline-flex items-center gap-1 rounded px-2 py-2 text-xs ${trash ? "bg-primary-soft text-primary" : "text-ink-soft"}`}><Trash2 size={12} />回收站</button>
        </nav>
        <section className="min-w-0 space-y-3" aria-label={trash ? "已删除文档" : "文档列表"} aria-busy={busy}>
          <div className="flex justify-between text-xs text-ink-soft"><span>{trash ? "回收站" : folder || "全部文档"} · {list.total} 篇</span><button onClick={() => { void load({ offset }); void reloadKnowledge().catch(e => setError(errorMessage(e))); }} disabled={busy}>{busy ? "加载中…" : "刷新"}</button></div>
          {!list.items.length && <div className="ac-card px-6 py-10 text-center"><FileText className="mx-auto mb-3 text-ink-faint" size={28} /><p className="text-sm font-medium">{trash ? "回收站为空" : query ? "没有找到符合条件的文档" : "从第一份项目文档开始"}</p><p className="mt-2 text-xs text-ink-soft">{trash ? "删除的文档可以在这里恢复。" : "可新建文档，也可导入已有的 Markdown 文件。"}</p></div>}
          {!!list.items.length && <div className="ac-card divide-y divide-line px-4">{list.items.map(item => <article key={item.id} className="flex items-center gap-3 py-4">
            <FileText size={17} className="shrink-0 text-ink-faint" />
            <div className="min-w-0 flex-1">{trash ? <h2 className="break-words text-sm font-medium">{item.title}</h2> : <Link href={`/projects/${projectId}/documents/${item.id}`} className="block break-words text-sm font-medium text-ink hover:text-primary">{item.title}</Link>}<div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-ink-faint"><span>{item.folder || "未分类"}</span>{item.visibility === "private" && <span className="inline-flex items-center gap-1"><Lock size={10} />个人草稿</span>}<span>{item.ownerName}</span><span>{displayDateTime(item.updatedAt)}</span></div>{query && <p className="mt-2 line-clamp-2 break-words text-xs text-ink-soft">{item.excerpt}</p>}</div>
            <span className="shrink-0 text-xs text-ink-soft">{item.permission === "edit" ? "可编辑" : item.permission === "comment" ? "可评论" : "只读"}</span>
            {trash ? item.canManage && <button className="ac-btn-ghost" disabled={busy} onClick={() => void restore(item)}><RotateCcw size={14} />恢复</button> : <button type="button" disabled={busy} aria-label={`${item.bookmarked ? "取消收藏" : "收藏"}${item.title}`} aria-pressed={!!item.bookmarked} onClick={() => void bookmark(item)} className="rounded p-1.5 text-ink-faint hover:bg-primary-soft hover:text-primary"><Star size={16} className={item.bookmarked ? "fill-primary/15 text-primary" : ""} /></button>}
          </article>)}</div>}
          <div className="flex items-center justify-end gap-3">{list.total > 0 && <span className="mr-auto text-xs text-ink-soft">第 {Math.floor(offset / 50) + 1} 页</span>}{offset > 0 && <button className="ac-btn-ghost" onClick={() => void load({ offset: Math.max(0, offset - 50) })} disabled={busy}>上一页</button>}{list.nextOffset !== null && <button className="ac-btn-ghost" onClick={() => void load({ offset: list.nextOffset! })} disabled={busy}>下一页</button>}</div>
        </section>
      </div>
      <PersonalDocumentShortcuts value={knowledge} />
    </div>

    {createOpen && <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/30 p-6" role="dialog" aria-modal="true" aria-labelledby="new-document-title">
      <form onSubmit={(event) => { event.preventDefault(); void create(); }} className="ac-card w-full max-w-md space-y-4 p-6">
        <h2 id="new-document-title" className="text-lg font-semibold">{markdown !== null ? "导入 Markdown" : "新建文档"}</h2>
        {importName && <p className="text-sm text-ink-soft">{importName} · 将转换为可协作编辑的文档</p>}
        {markdown === null && <label className="block text-sm">起始模板<select aria-label="文档模板" value={templateId} onChange={event => {
          const next = courseDocumentTemplates.find(item => item.id === event.target.value);
          setTemplateId(event.target.value); setTitle(next?.title ?? ""); setNewFolder(next?.folder ?? folder);
        }} className="mt-1 w-full rounded-lg border border-line bg-canvas p-2.5"><option value="">空白文档</option>{courseDocumentTemplates.map(item => <option key={item.id} value={item.id}>{item.title} · {item.description}</option>)}</select></label>}
        <label className="block text-sm">标题<input required maxLength={120} autoFocus value={title} onChange={(event) => setTitle(event.target.value)} className="mt-1 w-full rounded-lg border border-line bg-canvas p-2.5" /></label>
        <label className="block text-sm">目录<input list="document-folders" maxLength={50} value={newFolder} onChange={(event) => setNewFolder(event.target.value)} className="mt-1 w-full rounded-lg border border-line bg-canvas p-2.5" placeholder="如：设计" /><datalist id="document-folders">{folderOptions.map((item) => <option key={item} value={item} />)}</datalist></label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={privateDraft} onChange={(event) => setPrivateDraft(event.target.checked)} />先保存为个人草稿</label>
        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
        <div className="flex justify-end gap-2"><button type="button" className="ac-btn-ghost" disabled={busy} onClick={() => setCreateOpen(false)}>取消</button><button className="ac-btn" disabled={busy}>{busy ? "创建中…" : "创建并打开"}</button></div>
      </form>
    </div>}
  </main>;
}
