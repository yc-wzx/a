"use client";

import dynamic from "next/dynamic";
import { TaskLink as Link } from "@/components/tasks/task-link";
import { displayDateTime } from "@/lib/display-time";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Editor } from "@tiptap/react";
import { ArrowLeft, Check, Download, History, Link2, MessageSquare, Printer, Settings2, Sparkles, Trash2, X, Users, Copy } from "lucide-react";
import type { DocumentDetail, DocumentNode, DocumentPermission, DocumentVersion } from "@/contracts/documents";
import { documentMutation, documentRequest, errorMessage } from "./http";
import type { DocumentEditorHandle } from "./document-editor";
import type { SyncSnapshot } from "./sync-provider";

const EditorView = dynamic(() => import("./document-editor"), { ssr: false, loading: () => <p className="p-8 text-sm text-ink-soft">正在加载编辑器…</p> });
const permissionNames = { read: "可阅读", comment: "可评论", edit: "可编辑" };
const statusNames = { connecting: "连接中…", saving: "保存中…", saved: "已保存", offline: "连接中断 · 正文保留在此页面", blocked: "同步已停止", restored: "历史版本已恢复，请重新打开" };
type VersionDetail = { version: DocumentVersion; content: DocumentNode; markdown: string };
type AiPreview = { text: string; operation: string; epoch: number; revision: number; from: number; to: number; selection: string };
type CommentTarget = { blockId: string | null; quote: string };
type ReplyTarget = { id: string; authorName: string };

function downloadText(text: string, filename: string) {
  const link = document.createElement("a");
  const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
  link.href = url; link.download = filename; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function safeFilename(value: string) { return value.replace(/[\\/:*?"<>|]/g, "-").slice(0, 100) || "项目文档"; }
function metadataKey(value: DocumentDetail) {
  return JSON.stringify([value.title, value.folder, value.visibility, value.defaultPermission,
    value.grants.map((grant) => `${grant.userId}:${grant.permission}`).sort()]);
}
export function DocumentWorkspace({ initial }: { initial: DocumentDetail }) {
  const router = useRouter();
  const [detail, setDetail] = useState(initial);
  const [sync, setSync] = useState<SyncSnapshot>({ status: "connecting", permission: initial.permission, revision: initial.revision, pending: false, presence: [] });
  const [tab, setTab] = useState<"comments" | "versions" | "links" | "ai" | "settings" | null>("comments");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [title, setTitle] = useState(initial.title);
  const [folder, setFolder] = useState(initial.folder);
  const [visibility, setVisibility] = useState(initial.visibility);
  const [defaultPermission, setDefaultPermission] = useState(initial.defaultPermission);
  const [grants, setGrants] = useState(initial.grants);
  const [settingsBasis, setSettingsBasis] = useState(metadataKey(initial));
  const [versionLabel, setVersionLabel] = useState("");
  const [version, setVersion] = useState<VersionDetail | null>(null);
  const [compareId, setCompareId] = useState("");
  const [comparison, setComparison] = useState("");
  const [comment, setComment] = useState("");
  const [commentTarget, setCommentTarget] = useState<CommentTarget>({ blockId: null, quote: "" });
  const [replyTarget, setReplyTarget] = useState<ReplyTarget | null>(null);
  const commentInput = useRef<HTMLTextAreaElement | null>(null);
  const [showResolved, setShowResolved] = useState(false);
  const [taskId, setTaskId] = useState("");
  const [aiOperation, setAiOperation] = useState<"polish" | "summarize" | "suggest">("polish");
  const [aiPreview, setAiPreview] = useState<AiPreview | null>(null);
  const [selectedText, setSelectedText] = useState("");
  const [deleteOpen, setDeleteOpen] = useState(false);
  const editorHandle = useRef<DocumentEditorHandle | null>(null);
  const selectionCleanup = useRef<(() => void) | null>(null);
  const [initialEditor] = useState(initial);
  const base = `/api/projects/${initial.projectId}/documents/${initial.id}`;
  const canEdit = detail.canEdit && sync.permission === "edit" && !["blocked", "restored"].includes(sync.status);
  const canComment = detail.canComment && ["edit", "comment"].includes(sync.permission) && !["blocked", "restored"].includes(sync.status);
  const refresh = useCallback(async () => {
    const next = await documentRequest<DocumentDetail>(base);
    setDetail(next);
    return next;
  }, [base]);
  const onSync = useCallback((state: SyncSnapshot) => {
    setSync(state);
  }, []);
  const onReady = useCallback((handle: DocumentEditorHandle | null) => {
    selectionCleanup.current?.();
    selectionCleanup.current = null;
    editorHandle.current = handle;
    if (!handle) return;
    const selection = () => {
      const { from, to } = handle.editor.state.selection;
      setSelectedText(handle.editor.state.doc.textBetween(from, to, "\n"));
    };
    handle.editor.on("selectionUpdate", selection);
    selectionCleanup.current = () => { handle.editor.off("selectionUpdate", selection); };
  }, []);
  useEffect(() => {
    let active = true;
    const timer = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      void refresh().catch((failure) => { if (active) setError(errorMessage(failure)); });
    }, 8000);
    return () => { active = false; clearInterval(timer); };
  }, [refresh]);
  async function action(operation: () => Promise<void>) {
    if (busy) return;
    setBusy(true); setError(""); setNotice("");
    try { await operation(); }
    catch (failure) { setError(errorMessage(failure)); }
    finally { setBusy(false); }
  }
  async function flushedRevision() {
    if (!editorHandle.current) throw new Error("编辑器正在加载，请稍候。");
    return (await editorHandle.current.provider.flush()).revision;
  }
  function targetComment(editor: Editor) {
    setReplyTarget(null);
    const { $from, from, to } = editor.state.selection;
    let blockId: string | null = null;
    for (let depth = $from.depth; depth > 0; depth--) {
      if ($from.node(depth).attrs.id) { blockId = String($from.node(depth).attrs.id); break; }
    }
    const quote = (editor.state.doc.textBetween(from, to, "\n") || $from.parent.textContent).slice(0, 500);
    setCommentTarget({ blockId, quote }); setTab("comments");
  }
  async function saveMetadata() {
    const current = await refresh();
    if (metadataKey(current) !== settingsBasis) throw new Error("其他成员已调整标题、目录或权限。请先重新载入设置，再保存，避免覆盖他人的修改。");
    const revision = await flushedRevision();
    await documentMutation(base, "PATCH", { expectedRevision: revision, title: title.trim(), folder: folder.trim() || "未分类", visibility, defaultPermission,
      grants: grants.map(({ userId, permission }) => ({ userId, permission })) });
    const next = await refresh(); setSettingsBasis(metadataKey(next)); setNotice("标题、目录与权限已保存。");
  }
  function loadSettings(value = detail) {
    setTitle(value.title); setFolder(value.folder); setVisibility(value.visibility);
    setDefaultPermission(value.defaultPermission); setGrants(value.grants); setSettingsBasis(metadataKey(value));
  }
  async function saveVersion() {
    const revision = await flushedRevision();
    await documentMutation(`${base}/versions`, "POST", { expectedRevision: revision, label: versionLabel.trim() || "阶段版本" });
    setVersionLabel(""); await refresh(); setNotice("历史版本已保存。");
  }
  async function openVersion(id: string) {
    const result = await documentRequest<VersionDetail>(`${base}/versions/${id}`);
    setVersion(result); setComparison(""); setCompareId("");
  }
  async function compareVersion() {
    if (!version) return;
    let other: VersionDetail;
    if (compareId) other = await documentRequest<VersionDetail>(`${base}/versions/${compareId}`);
    else {
      await flushedRevision();
      const response = await fetch(`${base}/export`, { cache: "no-store" });
      if (!response.ok) throw new Error("无法读取当前文档，请刷新后重试。");
      other = { ...version, markdown: await response.text() };
    }
    const { diffLines } = await import("diff");
    const changes = diffLines(version.markdown, other.markdown);
    const lines = changes.flatMap((change) => {
      const values = change.value.split(/\r?\n/);
      if (values.at(-1) === "") values.pop();
      return values.map((line) => `${change.added ? "+ " : change.removed ? "− " : "  "}${line}`);
    });
    const changed = changes.some((change) => change.added || change.removed);
    setComparison(`历史版本：${version.version.label}\n比较对象：${compareId ? other.version.label : "当前文档"}\n\n${changed ? lines.join("\n") : "没有发现正文差异。"}`);
  }
  async function restoreVersion() {
    if (!version || !window.confirm(`恢复「${version.version.label}」？当前正文会先留存为历史版本，在线成员需要重新打开。`)) return;
    const revision = await flushedRevision();
    await documentMutation(`${base}/versions/${version.version.id}`, "POST", { expectedRevision: revision, epoch: detail.epoch });
    window.location.reload();
  }
  async function exportMarkdown() {
    await flushedRevision();
    const response = await fetch(`${base}/export`, { cache: "no-store" });
    if (!response.ok) throw new Error("导出失败，请重新打开文档再试。");
    downloadText(await response.text(), `${safeFilename(detail.title)}.md`);
  }
  async function requestAi() {
    const handle = editorHandle.current;
    if (!handle) throw new Error("编辑器正在加载。");
    const { from, to } = handle.editor.state.selection;
    const selection = handle.editor.state.doc.textBetween(from, to, "\n");
    if (!selection.trim()) throw new Error("请先在文档正文中选中要处理的文字。");
    if (selection.length > 8000) throw new Error("一次最多处理 8000 个字符，请缩小选区。");
    const revision = await flushedRevision();
    const result = await documentRequest<{ text: string; operation: string; epoch: number; revision: number }>(`${base}/ai`, {
      method: "POST", body: JSON.stringify({ operation: aiOperation, selection, epoch: detail.epoch, revision }) });
    setAiPreview({ ...result, from, to, selection });
  }
  async function applyAi() {
    const handle = editorHandle.current;
    if (!handle || !aiPreview || !canEdit) throw new Error("请先生成预览，并确认有编辑权限。");
    await flushedRevision();
    if (aiPreview.epoch !== handle.provider.epoch || aiPreview.revision !== handle.provider.getSnapshot().revision ||
      handle.editor.state.doc.textBetween(aiPreview.from, aiPreview.to, "\n") !== aiPreview.selection) {
      throw new Error("正文已发生变化，请重新选择文字并生成预览，避免覆盖其他成员的修改。");
    }
    const content = aiPreview.text.split(/\r?\n/).map((text) => ({ type: "paragraph", ...(text ? { content: [{ type: "text", text }] } : {}) }));
    handle.editor.chain().focus().insertContentAt({ from: aiPreview.from, to: aiPreview.to }, content).run();
    await handle.provider.flush(); setAiPreview(null); setNotice("已应用并保存 AI 修改。");
  }
  const sideButtons = [{ id: "comments", label: "评论", icon: MessageSquare }, { id: "versions", label: "版本", icon: History }, { id: "links", label: "任务", icon: Link2 }, { id: "ai", label: "AI", icon: Sparkles }, { id: "settings", label: "设置", icon: Settings2 }] as const;
  return <main className="space-y-4 py-4" data-document-workspace>
    <div className="flex items-center justify-between"><Link href={`/projects/${detail.projectId}/documents`} className="inline-flex items-center gap-1 text-sm text-ink-soft hover:text-primary" onClick={(event) => {
      if (sync.pending && !window.confirm("还有未保存内容。离开后可能丢失，确定离开？")) event.preventDefault();
    }}><ArrowLeft size={14} />项目文档</Link><span className="text-xs text-ink-soft">{permissionNames[sync.permission]} · {detail.visibility === "private" ? "个人草稿" : "项目共享"}</span></div>
    <header className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><p className="text-xs text-ink-faint">{detail.folder || "未分类"}</p><h1 className="mt-1 break-words font-display text-2xl font-semibold">{detail.title}</h1><div className="mt-2 flex flex-wrap items-center gap-3 text-xs"><span className={sync.status === "offline" ? "text-amber-700" : "text-ink-soft"} role="status">{statusNames[sync.status]}</span><span className="inline-flex items-center gap-1 text-ink-soft"><Users size={12} />{sync.presence.length} 人在线</span>{sync.presence.map((person) => <span key={person.userId} className="rounded bg-primary-soft px-1.5 py-0.5 text-primary">{person.name}</span>)}</div></div>
      <div className="document-actions flex gap-2"><button className="ac-btn-ghost" disabled={busy} onClick={() => void action(exportMarkdown)}><Download size={14} />导出</button><button className="ac-btn-ghost" disabled={busy} onClick={() => void action(async () => { await flushedRevision(); window.print(); })}><Printer size={14} />打印</button></div>
    </header>
    {(error || sync.error) && <p role="alert" className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">{error || sync.error}</p>}
    {notice && <p role="status" className="rounded-lg bg-primary-soft p-3 text-sm text-primary">{notice}</p>}
    {(["blocked", "restored"].includes(sync.status) || sync.pending && sync.status === "offline") && <div className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-surface p-3 text-sm"><span>先保留当前页面的内容：</span><button className="ac-btn-ghost" onClick={() => void action(async () => { await navigator.clipboard.writeText(editorHandle.current?.editor.getText() ?? ""); setNotice("当前正文已复制。"); })}><Copy size={13} />复制正文</button><button className="ac-btn-ghost" onClick={() => downloadText(JSON.stringify(editorHandle.current?.editor.getJSON(), null, 2), `${safeFilename(detail.title)}-未保存副本.json`)}>下载副本</button><button className="ac-btn-ghost" onClick={() => { if (!sync.pending || window.confirm("请确认已复制或下载未保存内容。现在重新打开？")) window.location.reload(); }}>重新打开</button></div>}
    <nav className="document-actions flex flex-wrap gap-2" aria-label="文档协作面板">{sideButtons.map((button) => <button key={button.id} className={tab === button.id ? "ac-btn" : "ac-btn-ghost"} onClick={() => { if (button.id === "settings" && tab !== "settings") loadSettings(); setTab(tab === button.id ? null : button.id); }} aria-expanded={tab === button.id}><button.icon size={14} />{button.label}{button.id === "comments" && detail.comments.filter((item) => !item.resolvedAt).length > 0 && ` ${detail.comments.filter((item) => !item.resolvedAt).length}`}</button>)}</nav>
    <div className={`grid items-start gap-4 ${tab ? "grid-cols-[minmax(0,1fr)_270px]" : "grid-cols-1"}`}>
      <section className="ac-card min-w-0 overflow-hidden" data-document-print><h2 className="hidden print:block text-xl font-semibold">{detail.title}</h2><EditorView initial={initialEditor} editable={canEdit} canComment={canComment} onReady={onReady} onSync={onSync} onComment={targetComment} /></section>
      {tab && <aside className="document-sidebar ac-card min-w-0 space-y-4 p-4" aria-label="文档协作面板内容">
        <div className="flex justify-between"><h2 className="font-semibold">{sideButtons.find((button) => button.id === tab)?.label}</h2><button aria-label="关闭文档侧栏" onClick={() => setTab(null)} className="text-ink-soft"><X size={15} /></button></div>
        {tab === "comments" && <>
          {canComment && <form className="space-y-2" onSubmit={(event) => { event.preventDefault(); void action(async () => {
            if (canEdit) await flushedRevision();
            await documentMutation(`${base}/comments`, "POST", { body: comment.trim(), ...(replyTarget ? { replyToId: replyTarget.id } : commentTarget) });
            setComment(""); setCommentTarget({ blockId: null, quote: "" }); setReplyTarget(null); await refresh();
          }); }}>
            {replyTarget && <div className="flex items-center justify-between gap-2 rounded-lg bg-primary-soft p-2 text-xs text-primary"><span>回复 {replyTarget.authorName}</span><button type="button" onClick={() => { setReplyTarget(null); setCommentTarget({ blockId: null, quote: "" }); }}>取消回复</button></div>}
            {!replyTarget && commentTarget.quote && <div className="rounded border-l-2 border-primary bg-canvas p-2 text-xs text-ink-soft"><p className="line-clamp-4">{commentTarget.quote}</p><button type="button" className="mt-1 text-primary" onClick={() => setCommentTarget({ blockId: null, quote: "" })}>取消段落定位</button></div>}
            <label className="block text-xs text-ink-soft">{replyTarget ? "回复内容" : commentTarget.blockId ? "段落评论" : "文档评论"}<textarea ref={commentInput} aria-label="评论内容" required maxLength={3000} value={comment} onChange={(event) => setComment(event.target.value)} placeholder={replyTarget ? "回复这条反馈…" : "留下具体的反馈…"} className="mt-1 min-h-24 w-full rounded-lg border border-line bg-canvas p-2 text-sm" /></label><button className="ac-btn w-full" disabled={busy || !comment.trim()}>{replyTarget ? "发布回复" : "发布评论"}</button>
          </form>}
          <label className="flex items-center gap-2 text-xs text-ink-soft"><input type="checkbox" checked={showResolved} onChange={(event) => setShowResolved(event.target.checked)} />显示已解决评论</label>
          {detail.comments.filter((item) => showResolved || !item.resolvedAt).map((item) => <article key={item.id} data-document-comment={item.id} className={`space-y-2 rounded-lg border border-line p-3 ${item.replyToId ? "ml-3 border-l-2" : ""}`}><div className="flex justify-between text-xs text-ink-soft"><span>{item.authorName}</span>{item.resolvedAt && <span className="inline-flex items-center gap-1"><Check size={11} />已解决</span>}</div>{item.replyToId && <p className="text-[11px] text-ink-faint">{item.replyToAuthorName ? `回复 ${item.replyToAuthorName}` : "原评论已删除"}</p>}{item.quote && (!item.replyToId || item.replyToAuthorName) && <button className="block w-full border-l-2 border-line pl-2 text-left text-xs text-ink-faint" onClick={() => {
            const anchor = item.blockId && document.querySelector(`[data-block-id="${CSS.escape(item.blockId)}"], [data-id="${CSS.escape(item.blockId)}"]`);
            if (anchor) { anchor.scrollIntoView({ behavior: "smooth", block: "center" }); anchor.classList.add("document-highlight"); setTimeout(() => anchor.classList.remove("document-highlight"), 1800); }
            else setNotice("原段落已删除或无法定位；评论引用仍保留。");
          }}>{item.quote}</button>}<p className="whitespace-pre-wrap break-words text-sm">{item.body}</p><p className="text-[10px] text-ink-faint">{displayDateTime(item.createdAt)}</p><div className="flex flex-wrap gap-3 text-xs text-primary">{canComment && <button disabled={busy} onClick={() => { setReplyTarget({ id: item.id, authorName: item.authorName }); setCommentTarget({ blockId: item.blockId, quote: item.quote }); commentInput.current?.focus(); }}>回复</button>}{canComment && (item.authorId === detail.actorId || canEdit) && <button disabled={busy} onClick={() => void action(async () => { await documentMutation(`${base}/comments`, "PATCH", { commentId: item.id, resolved: !item.resolvedAt }); await refresh(); })}>{item.resolvedAt ? "重新打开" : "标记已解决"}</button>}{item.canDelete && <button disabled={busy} onClick={() => void action(async () => { if (window.confirm("删除这条评论？")) { await documentMutation(`${base}/comments`, "DELETE", { commentId: item.id }); await refresh(); } })}>删除</button>}</div></article>)}
          {!detail.comments.length && <p className="text-sm text-ink-soft">选中正文或点击段落，再使用“评论当前段落”。</p>}
        </>}
        {tab === "versions" && <>
          {canEdit && <form className="space-y-2" onSubmit={(event) => { event.preventDefault(); void action(saveVersion); }}><input aria-label="历史版本名称" maxLength={80} placeholder="如：阶段展示版" value={versionLabel} onChange={(event) => setVersionLabel(event.target.value)} className="w-full rounded-lg border border-line bg-canvas p-2 text-sm" /><button className="ac-btn w-full" disabled={busy}>保存当前版本</button></form>}
          {detail.versions.map((item) => <button key={item.id} onClick={() => void action(() => openVersion(item.id))} className="block w-full rounded-lg border border-line p-3 text-left hover:bg-canvas"><span className="block text-sm font-medium">{item.label}</span><span className="mt-1 block text-xs text-ink-soft">{item.authorName} · {displayDateTime(item.createdAt)}</span><span className="mt-1 block text-[10px] text-ink-faint">{item.kind === "manual" ? "手动保存" : item.kind === "restore" ? "恢复前留存" : "自动留存"}</span></button>)}
          {!detail.versions.length && <p className="text-sm text-ink-soft">保存阶段版本，方便展示前回看与比较。</p>}
        </>}
        {tab === "links" && <>
          {canEdit && <form className="space-y-2" onSubmit={(event) => { event.preventDefault(); void action(async () => { await documentMutation(`${base}/links`, "POST", { taskId }); setTaskId(""); await refresh(); }); }}><label className="block text-xs text-ink-soft">关联现有任务<select required aria-label="选择关联任务" value={taskId} onChange={(event) => setTaskId(event.target.value)} className="mt-1 w-full rounded-lg border border-line bg-canvas p-2 text-sm"><option value="">请选择任务</option>{detail.tasks.filter((item) => !detail.links.some((link) => link.taskId === item.id)).map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label><button className="ac-btn w-full" disabled={busy || !taskId}>关联任务</button></form>}
          {detail.links.map((item) => <div key={item.taskId} className="rounded-lg border border-line p-3"><Link className="block break-words text-sm text-primary hover:underline" href={item.href}>{item.title}</Link><div className="mt-2 flex justify-between text-xs text-ink-soft"><span>{item.status === "done" ? "已完成" : item.status === "doing" ? "进行中" : "待办"}</span>{canEdit && <button disabled={busy} onClick={() => void action(async () => { await documentMutation(`${base}/links`, "DELETE", { taskId: item.taskId }); await refresh(); })}>解除关联</button>}</div></div>)}
          {!detail.links.length && <p className="text-sm text-ink-soft">把需求、设计或试用记录关联到实际任务，任务详情也会显示文档入口。</p>}
        </>}
        {tab === "ai" && <>
          <p className="text-xs leading-relaxed text-ink-soft">使用你本人配置的 AI 助手，只发送选中文字。先预览，再确认修改。</p><Link href="/settings#my-ai" className="inline-block text-xs text-primary hover:underline">配置我的 AI 助手 ↗</Link>
          {canEdit ? <><label className="block text-xs text-ink-soft">处理方式<select value={aiOperation} onChange={(event) => setAiOperation(event.target.value as typeof aiOperation)} className="mt-1 w-full rounded-lg border border-line bg-canvas p-2 text-sm"><option value="polish">润色表达</option><option value="summarize">总结选区</option><option value="suggest">提出修改建议</option></select></label><p className="text-xs text-ink-soft">已选中 {selectedText.length} 个字符</p><button className="ac-btn w-full" disabled={busy || !selectedText.trim()} onMouseDown={(event) => event.preventDefault()} onClick={() => void action(requestAi)}>{busy ? "处理中…" : "生成预览"}</button></> : <p className="text-xs text-ink-soft">需要编辑权限才能使用辅助写作。</p>}
          {aiPreview && <div className="space-y-3 rounded-lg border border-line bg-canvas p-3"><p className="text-xs font-medium">AI 预览</p><p className="whitespace-pre-wrap break-words text-sm">{aiPreview.text}</p><div className="flex flex-wrap gap-2"><button className="ac-btn" disabled={busy || !canEdit} onClick={() => void action(applyAi)}>{aiPreview.operation === "suggest" ? "确认替换为建议" : "确认替换选区"}</button><button className="ac-btn-ghost" onClick={() => void action(async () => { await navigator.clipboard.writeText(aiPreview.text); setNotice("AI 预览已复制。"); })}>复制</button><button className="ac-btn-ghost" onClick={() => setAiPreview(null)}>取消</button></div></div>}
        </>}
        {tab === "settings" && <>
          {detail.canManage ? <form className="space-y-3" onSubmit={(event) => { event.preventDefault(); void action(saveMetadata); }}>
            <label className="block text-xs text-ink-soft">标题<input required maxLength={120} value={title} onChange={(event) => setTitle(event.target.value)} className="mt-1 w-full rounded-lg border border-line bg-canvas p-2 text-sm" /></label><label className="block text-xs text-ink-soft">目录<input maxLength={50} value={folder} onChange={(event) => setFolder(event.target.value)} className="mt-1 w-full rounded-lg border border-line bg-canvas p-2 text-sm" /></label>
            <label className="block text-xs text-ink-soft">访问范围<select value={visibility} onChange={(event) => setVisibility(event.target.value as typeof visibility)} className="mt-1 w-full rounded-lg border border-line bg-canvas p-2 text-sm"><option value="project">项目共享</option><option value="private">个人草稿，仅本人及指定成员</option></select></label>
            {visibility === "project" && <label className="block text-xs text-ink-soft">项目成员默认权限<select value={defaultPermission} onChange={(event) => setDefaultPermission(event.target.value as DocumentPermission)} className="mt-1 w-full rounded-lg border border-line bg-canvas p-2 text-sm">{Object.entries(permissionNames).map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>}
            <div className="space-y-2"><p className="text-xs font-medium">指定成员权限</p>{detail.members.filter((member) => member.id !== detail.ownerId).map((member) => <label key={member.id} className="flex items-center justify-between gap-2 text-xs"><span className="min-w-0 truncate">{member.name}</span><select aria-label={`${member.name}的文档权限`} value={grants.find((grant) => grant.userId === member.id)?.permission ?? ""} onChange={(event) => {
              const remaining = grants.filter((grant) => grant.userId !== member.id);
              setGrants(event.target.value ? [...remaining, { userId: member.id, name: member.name, permission: event.target.value as DocumentPermission }] : remaining);
            }} className="rounded border border-line bg-canvas p-1"><option value="">{visibility === "private" ? "不分享" : "默认"}</option>{Object.entries(permissionNames).map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>)}</div><button className="ac-btn w-full" disabled={busy}>保存设置</button>
          </form> : <div className="space-y-2 text-xs text-ink-soft"><p>作者：{detail.ownerName}</p><p>你的权限：{permissionNames[sync.permission]}</p><p>标题、目录和分享范围由文档作者或项目管理者调整。</p></div>}
          {detail.canManage && <div className="border-t border-line pt-3"><button className="flex items-center gap-1 text-xs text-red-700" disabled={busy} onClick={() => setDeleteOpen(true)}><Trash2 size={13} />移到回收站</button></div>}
        </>}
      </aside>}
    </div>
    {deleteOpen && <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/30 p-6" role="dialog" aria-modal="true" aria-labelledby="delete-document-title"><div className="ac-card max-w-sm space-y-4 p-6"><h2 id="delete-document-title" className="font-semibold">将文档移到回收站？</h2><p className="text-sm text-ink-soft">成员将无法打开此文档，可在项目文档的回收站恢复。正文、评论和版本会保留。</p><div className="flex justify-end gap-2"><button className="ac-btn-ghost" disabled={busy} onClick={() => setDeleteOpen(false)}>取消</button><button className="ac-btn" disabled={busy} onClick={() => void action(async () => { const revision = await flushedRevision(); await documentMutation(base, "DELETE", { expectedRevision: revision }); router.push(`/projects/${detail.projectId}/documents`); })}>移到回收站</button></div></div></div>}
    {version && <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/30 p-6" role="dialog" aria-modal="true" aria-labelledby="document-version-title"><div className="ac-card flex max-h-[85vh] w-full max-w-3xl flex-col gap-4 p-6"><div className="flex justify-between gap-3"><h2 id="document-version-title" className="font-semibold">{version.version.label}</h2><button aria-label="关闭版本查看" onClick={() => setVersion(null)}><X size={18} /></button></div><div className="flex flex-wrap gap-2"><select aria-label="比较的文档版本" className="min-w-0 rounded border border-line bg-canvas p-2 text-sm" value={compareId} onChange={(event) => setCompareId(event.target.value)}><option value="">与当前正文比较</option>{detail.versions.filter((item) => item.id !== version.version.id).map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select><button className="ac-btn-ghost" disabled={busy} onClick={() => void action(compareVersion)}>查看差异</button><button className="ac-btn-ghost" onClick={() => downloadText(version.markdown, `${safeFilename(detail.title)}-${safeFilename(version.version.label)}.md`)}>导出此版本</button>{canEdit && <button className="ac-btn" disabled={busy} onClick={() => void action(restoreVersion)}>恢复此版本</button>}</div>{error && <p role="alert" className="text-sm text-red-700">{error}</p>}<pre className="min-h-0 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-line bg-canvas p-4 text-xs leading-relaxed">{comparison || version.markdown || "空文档"}</pre>{comparison && <p className="text-xs text-ink-soft">以 − 开头的行为旧内容，+ 开头的行为新内容。</p>}</div></div>}
  </main>;
}
