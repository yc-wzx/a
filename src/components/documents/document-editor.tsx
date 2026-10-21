"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import Collaboration, { isChangeOrigin } from "@tiptap/extension-collaboration";
import UniqueID from "@tiptap/extension-unique-id";
import CollaborationCaret from "@tiptap/extension-collaboration-caret";
import Placeholder from "@tiptap/extension-placeholder";
import { Bold, Italic, List, ListOrdered, CheckSquare, Quote, Code2, Table2, Link2, ImageIcon, Undo2, Redo2, MessageSquare, ListTree, Sparkles, Copy, X, FileText, Plus } from "lucide-react";
import type { DocumentDetail, DocumentReferenceItem, DocumentSummary } from "@/contracts/documents";
import { baseDocumentExtensions } from "./extensions";
import { DocumentSyncProvider, type SyncSnapshot } from "./sync-provider";
import { documentOutline, documentBlockHash, readDocumentBlockHash, findSlashRange, matchesCommand, type SlashRange } from "./editor-interactions";
import { DocumentAnchorHighlight, documentAnchorHighlightKey } from "./anchor-highlight";
import { InteractiveDocumentReference, InteractiveDocumentToggle } from "./knowledge-extensions";
import { DocumentReferencePicker } from "./document-reference-picker";
import { TextSelection } from "@tiptap/pm/state";
import { DocumentFind, DocumentFindHighlight } from "./document-find";
import { DocumentMentions, mentionChoices, type MentionChoice } from "./document-mentions";
import { documentMutation, documentRequest } from "./http";
import type { DocumentCollaboration, DocumentMentionTarget } from "@/contracts/document-collaboration";
import { openTaskPreview } from "@/lib/task-navigation";
import { GripVertical, Search, Upload, AtSign } from "lucide-react";
import { InteractiveDocumentMention, InteractiveDocumentTask, InteractiveDocumentAttachment } from "./knowledge-extensions";
import { dropDocumentBlock, moveDocumentBlock } from "./block-movement";
import { snapshotText } from "./document-snapshot";
import "./documents.css";

export type DocumentEditorHandle = { editor: Editor; provider: DocumentSyncProvider };
type DocumentEditorProps = {
  initial: DocumentDetail;
  editable: boolean;
  canComment: boolean;
  onReady: (handle: DocumentEditorHandle | null) => void;
  onSync: (state: SyncSnapshot) => void;
  onComment: (editor: Editor) => void;
  onAi: () => void;
  references: DocumentReferenceItem[];
  canCreateTask: boolean;
  onCreateTask: (editor: Editor) => void;
};
const insertCommands = [
  { label: "一级标题", aliases: ["h1", "heading1", "title1"], action: (current: Editor) => current.chain().focus().setHeading({ level: 1 }).run() },
  { label: "二级标题", aliases: ["h2", "heading2", "title2"], action: (current: Editor) => current.chain().focus().setHeading({ level: 2 }).run() },
  { label: "三级标题", aliases: ["h3", "heading3", "title3"], action: (current: Editor) => current.chain().focus().setHeading({ level: 3 }).run() },
  { label: "正文", aliases: ["text", "paragraph"], action: (current: Editor) => current.chain().focus().setParagraph().run() },
  { label: "检查清单", aliases: ["todo", "task", "checklist"], action: (current: Editor) => current.chain().focus().toggleTaskList().run() },
  { label: "无序列表", aliases: ["bullet", "ul"], action: (current: Editor) => current.chain().focus().toggleBulletList().run() },
  { label: "有序列表", aliases: ["number", "ol"], action: (current: Editor) => current.chain().focus().toggleOrderedList().run() },
  { label: "引用", aliases: ["quote"], action: (current: Editor) => current.chain().focus().toggleBlockquote().run() },
  { label: "表格", aliases: ["table"], action: (current: Editor) => current.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run() },
  { label: "代码块", aliases: ["code"], action: (current: Editor) => current.chain().focus().toggleCodeBlock().run() },
  { label: "分隔线", aliases: ["divider", "hr"], action: (current: Editor) => current.chain().focus().setHorizontalRule().run() },
  { label: "折叠内容", aliases: ["toggle", "fold"], action: (current: Editor) => current.chain().focus().insertContent({ type: "documentToggle", content: [{ type: "toggleSummary", content: [{ type: "text", text: "点击填写折叠标题" }] }, { type: "toggleContent", content: [{ type: "paragraph", content: [{ type: "text", text: "在这里补充详细内容。" }] }] }] }).run() },
  ...([{ kind: "note", label: "提示块" }, { kind: "question", label: "待确认块" }, { kind: "risk", label: "风险提示块" }] as const).map(item => ({ label: item.label, aliases: ["callout", item.kind], action: (current: Editor) => current.chain().focus().insertContent({ type: "documentCallout", attrs: { kind: item.kind }, content: [{ type: "paragraph", content: [{ type: "text", text: "填写需要强调的内容。" }] }] }).run() })),
];
const selectionMenuOptions = { placement: "top" as const, offset: 8, shift: { padding: 12 } };
const appendSelectionMenu = () => document.body;
export default function DocumentEditor(props: DocumentEditorProps) {
  const { initial } = props;
  const [provider, setProvider] = useState<DocumentSyncProvider | null>(null);
  useEffect(() => {
    // Create and dispose the external Yjs resource in an effect so Strict Mode
    // never leaks an Awareness interval from a discarded render.
    const resource = new DocumentSyncProvider(`/api/projects/${initial.projectId}/documents/${initial.id}/sync`, initial.state, initial.epoch, initial.revision, initial.permission,
      { scope: { actorId: initial.actorId, projectId: initial.projectId, documentId: initial.id }, preview: () => snapshotText(initial.content) });
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setProvider(resource);
    return () => resource.destroy();
  }, [initial]);
  if (!provider) return <p className="p-8 text-sm text-ink-soft">正在准备协作连接…</p>;
  return <DocumentEditorCore key={provider.sessionId} {...props} provider={provider} />;
}
function DocumentEditorCore({ initial, editable, canComment, onReady, onSync, onComment, onAi, provider, references, canCreateTask, onCreateTask }: DocumentEditorProps & { provider: DocumentSyncProvider }) {
  const [resources, setResources] = useState<DocumentCollaboration>({ members: [], tasks: [], attachments: [] });
  const [documents, setDocuments] = useState<DocumentReferenceItem[]>([]);
  const [mention, setMention] = useState<DocumentMentionTarget | null>(null);
  const [mentionIndex, setMentionIndex] = useState(0);
  const [mentionFilter, setMentionFilter] = useState("all");
  const [notifyMention, setNotifyMention] = useState(true);
  const [pendingMentions, setPendingMentions] = useState<string[]>([]);
  const [findOpen, setFindOpen] = useState(false);
  const [uploadState, setUploadState] = useState<{ busy: boolean; file?: File; requestId?: string; at?: string; error?: string }>({ busy: false });
  const uploadRef = useRef<(file: File, requestId?: string, at?: string) => void>(() => {});
  const uploadInput = useRef<HTMLInputElement>(null);
  const [dragHandle, setDragHandle] = useState<{ id: string; left: number; top: number } | null>(null);
  const dragId = useRef("");
  const dragCleanup = useRef<(() => void) | null>(null);
  useEffect(() => () => dragCleanup.current?.(), []);
  const base = `/api/projects/${initial.projectId}/documents/${initial.id}`;
  const reloadResources = useCallback(async () => { const next = await documentRequest<DocumentCollaboration>(`${base}/collaboration`); setResources(next); }, [base]);
  useEffect(() => {
    let alive = true;
    void documentRequest<DocumentCollaboration>(`${base}/collaboration`).then(next => { if (alive) setResources(next); }).catch(() => {});
    void documentRequest<{ items: DocumentSummary[] }>(`/api/projects/${initial.projectId}/documents`).then(result => { if (alive) setDocuments(result.items.filter(d => d.id !== initial.id).map(d => ({ id: d.id, title: d.title, folder: d.folder, href: `/projects/${initial.projectId}/documents/${d.id}` }))); }).catch(() => {});
    const timer = setInterval(() => { if (document.visibilityState === "visible") void reloadResources().catch(() => {}); }, 12000);
    return () => { alive = false; clearInterval(timer); };
  }, [base, initial.id, initial.projectId, reloadResources]);
  const [slash, setSlash] = useState<SlashRange | null>(null);
  const [commandIndex, setCommandIndex] = useState(0);
  const [outlineOpen, setOutlineOpen] = useState(true);
  const [linkNotice, setLinkNotice] = useState("");
  const [activeBlock, setActiveBlock] = useState<string | null>(null);
  const dismissedSlash = useRef("");
  const keyHandler = useRef<(event: KeyboardEvent) => boolean>(() => false);
  const shellRef = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const appliedHash = useRef("");
  const [urlType, setUrlType] = useState<"image" | "link" | null>(null);
  const [url, setUrl] = useState("");
  const [urlError, setUrlError] = useState("");
  const [referenceRange, setReferenceRange] = useState<{ from: number; to: number; prefix: string } | null>(null);
  const readyRef = useRef(onReady);
  const syncRef = useRef(onSync);
  const editorRef = useRef<Editor | null>(null);
  // BubbleMenu dispatches a transaction when these options change. Keep them
  // stable across editor transactions to avoid an options/render feedback loop.
  const showSelectionMenu = useCallback(({ editor: current, element, from, to }: { editor: Editor; element: HTMLElement; from: number; to: number }) =>
    !urlType && !referenceRange && (current.isFocused || element.contains(document.activeElement)
      || (!current.isEditable && (canComment || canCreateTask) && current.view.dom.contains(window.getSelection()?.anchorNode ?? null))) && from !== to
      && Boolean(current.state.doc.textBetween(from, to).trim()) && (current.isEditable || canComment || canCreateTask), [urlType, referenceRange, canComment, canCreateTask]);
  useEffect(() => { readyRef.current = onReady; syncRef.current = onSync; }, [onReady, onSync]);
  const editor = useEditor({
    immediatelyRender: false,
    shouldRerenderOnTransaction: true,
    extensions: [...baseDocumentExtensions().filter(extension => !["documentReference", "documentToggle", "documentMention", "documentTaskReference", "documentAttachment"].includes(extension.name)), InteractiveDocumentReference, InteractiveDocumentToggle, InteractiveDocumentMention, InteractiveDocumentTask, InteractiveDocumentAttachment, DocumentAnchorHighlight, DocumentFindHighlight,
      Placeholder.configure({ placeholder: "写下项目内容；输入 @ 引用成员、文档或任务，输入 / 插入内容块…" }),
      Collaboration.configure({ document: provider.doc, field: "default" }),
      CollaborationCaret.configure({ provider, user: { id: initial.actorId, name: initial.actorName, color: "#b26140" } }),
      UniqueID.configure({ types: ["paragraph", "heading", "blockquote", "codeBlock", "table", "bulletList", "orderedList", "taskList", "image", "horizontalRule", "documentCallout", "documentToggle", "toggleSummary", "documentAttachment"],
        filterTransaction: (transaction) => !isChangeOrigin(transaction) && provider.getSnapshot().permission === "edit" && !["blocked", "restored"].includes(provider.getSnapshot().status) }),
    ],
    editable,
    editorProps: { attributes: { class: "document-prose", "aria-label": "文档正文编辑器", "data-document-editor": "true" },
      handleKeyDown: (_view, event) => keyHandler.current(event),
      handlePaste: (view, event) => { if (!view.editable) return false; const file = Array.from(event.clipboardData?.files ?? [])[0]; if (!file) return false; event.preventDefault(); uploadRef.current(file); return true; },
      handleDrop: (view, event) => {
        if (!view.editable) return false;
        const file = event.dataTransfer?.files[0];
        if (file) { event.preventDefault(); const point = view.posAtCoords({ left: event.clientX, top: event.clientY }); if (point) view.dispatch(view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(point.pos)))); uploadRef.current(file); return true; }
        const source = event.dataTransfer?.getData("application/x-agilecampus-block");
        if (source) { for (const node of view.dom.querySelectorAll(".document-block-drop-target")) node.classList.remove("document-block-drop-target"); event.preventDefault(); const target = (event.target as HTMLElement).closest<HTMLElement>("[data-block-id]"); if (!target?.dataset.blockId) return true; const rect = target.getBoundingClientRect(); const tr = dropDocumentBlock(view.state, source, target.dataset.blockId, event.clientY > rect.top + rect.height / 2); if (tr) view.dispatch(tr); return true; }
        return false;
      },
      handleDOMEvents: { dragover: (view, event) => { if (!view.editable || !dragId.current) return false; event.preventDefault(); for (const node of view.dom.querySelectorAll(".document-block-drop-target")) node.classList.remove("document-block-drop-target"); const target = (event.target as HTMLElement).closest("[data-block-id]"); target?.classList.add("document-block-drop-target"); return true; }, dragend: view => { for (const node of view.dom.querySelectorAll(".document-block-drop-target")) node.classList.remove("document-block-drop-target"); return false; }, click: (_view, event) => { const anchor = (event.target as HTMLElement).closest<HTMLAnchorElement>("a[data-task-reference]"); if (anchor && !event.ctrlKey && !event.metaKey && !event.shiftKey) { event.preventDefault(); void provider.flush().then(() => openTaskPreview(anchor.getAttribute("href")!)).catch(error => setLinkNotice(error instanceof Error ? error.message : "请等待文档保存后重试")); return true; } return false; } },
    },
    onUpdate: ({ editor: current }) => {
      provider.updateRecoveryPreview(current.getText());
      const { $from } = current.state.selection;
      if (current.isEditable && $from.parent.type.name !== "codeBlock" && current.state.selection.empty && $from.parent.textBetween(0, $from.parentOffset).endsWith("[[")) setReferenceRange({ from: $from.pos - 2, to: $from.pos, prefix: "[[" });
      const typedMention = current.isEditable && current.state.selection.empty && ["paragraph", "heading"].includes($from.parent.type.name) ? /@([^@\s]{0,80})$/u.exec($from.parent.textBetween(0, $from.parentOffset)) : null;
      setMention(typedMention ? { from: $from.pos - typedMention[1].length - 1, to: $from.pos, query: typedMention[1] } : null); setMentionIndex(0);
      const next = findSlashRange($from.parent.textBetween(0, $from.parentOffset), $from.pos, current.state.selection.empty, $from.parent.type.name);
      setSlash(next && JSON.stringify(next) !== dismissedSlash.current ? next : null); setCommandIndex(0);
    },
    onSelectionUpdate: ({ editor: current }) => {
      const { $from } = current.state.selection;
      const typedMention = current.isEditable && current.state.selection.empty && ["paragraph", "heading"].includes($from.parent.type.name) ? /@([^@\s]{0,80})$/u.exec($from.parent.textBetween(0, $from.parentOffset)) : null;
      setMention(typedMention ? { from: $from.pos - typedMention[1].length - 1, to: $from.pos, query: typedMention[1] } : null); setMentionIndex(0);
      const next = findSlashRange($from.parent.textBetween(0, $from.parentOffset), $from.pos, current.state.selection.empty, $from.parent.type.name);
      setSlash(next && JSON.stringify(next) !== dismissedSlash.current ? next : null); setCommandIndex(0);
    },
  });
  useEffect(() => {
    editorRef.current = editor;
  }, [editor]);
  useEffect(() => {
    if (!editor) return;
    const updateReferences = () => {
      for (const node of editor.view.dom.querySelectorAll<HTMLElement>("[data-document-reference]")) {
        const target = [...references, ...documents].find(item => item.id === node.dataset.documentReference);
        const signature = JSON.stringify(target ?? null); if (node.dataset.resolvedSignature === signature) continue; node.dataset.resolvedSignature = signature;
        node.replaceChildren();
        if (target) { const anchor = document.createElement("a"); anchor.href = target.href; anchor.textContent = target.title; node.append(anchor); }
        else node.textContent = "引用文档不可用";
      }
    };
    updateReferences(); editor.on("update", updateReferences);
    const updateNodes = () => {
      for (const element of editor.view.dom.querySelectorAll<HTMLElement>("[data-document-mention]")) { const member = resources.members.find(m => m.id === element.dataset.documentMention); const signature = JSON.stringify(member ?? null); if (element.dataset.resolvedSignature === signature) continue; element.dataset.resolvedSignature = signature; element.replaceChildren(); if (member) { const a = document.createElement("a"); a.href = `/people/${member.id}`; a.textContent = `@${member.name}`; element.append(a); } else element.textContent = "@成员不可用"; }
      for (const element of editor.view.dom.querySelectorAll<HTMLElement>("[data-document-task]")) { const task = resources.tasks.find(t => t.id === element.dataset.documentTask); const signature = JSON.stringify(task ?? null); if (element.dataset.resolvedSignature === signature) continue; element.dataset.resolvedSignature = signature; element.replaceChildren(); if (task) { const a = document.createElement("a"); a.href = `/projects/${initial.projectId}?task=${task.id}`; a.dataset.taskReference = "true"; a.textContent = `${task.title} · ${{ todo: "待办", doing: "进行中", review: "待检查", done: "已完成" }[task.status] ?? task.status}${task.assigneeName ? ` · ${task.assigneeName}` : ""}${task.dueDate ? ` · ${task.dueDate}` : ""}`; element.append(a); } else element.textContent = "项目任务不可用"; }
      for (const element of editor.view.dom.querySelectorAll<HTMLElement>("[data-document-attachment]")) { const file = resources.attachments.find(a => a.id === element.dataset.documentAttachment); const signature = JSON.stringify(file ?? null); if (element.dataset.resolvedSignature === signature) continue; element.dataset.resolvedSignature = signature; element.replaceChildren(); if (file) { const href = `/api/attachments/${file.id}`; const a = document.createElement("a"); a.href = href; a.target = "_blank"; a.rel = "noopener noreferrer"; a.textContent = `${file.filename} · ${(file.size / 1048576).toFixed(2)} MB`; if (file.mediaType.startsWith("image/")) { const img = document.createElement("img"); img.src = href; img.alt = file.filename; img.loading = "lazy"; element.append(img); } element.append(a); const download = document.createElement("a"); download.href = href + "?download=1"; download.textContent = "下载"; download.className = "document-inline-download"; element.append(download); } else element.textContent = "附件已删除或无权访问"; }
    };
    updateNodes(); editor.on("update", updateNodes);
    return () => { editor.off("update", updateReferences); editor.off("update", updateNodes); };
  }, [editor, references, resources, initial.projectId, documents]);
  useEffect(() => {
    provider.awareness.setLocalStateField("sessionId", provider.sessionId);
    const unsubscribe = provider.subscribe((state) => {
      syncRef.current(state);
      if (["blocked", "restored"].includes(state.status) || state.permission !== "edit") editorRef.current?.setEditable(false);
    });
    provider.start();
    function preventLoss(event: BeforeUnloadEvent) {
      if (provider.getSnapshot().pending) { event.preventDefault(); event.returnValue = ""; }
    }
    window.addEventListener("beforeunload", preventLoss);
    return () => { unsubscribe(); window.removeEventListener("beforeunload", preventLoss); };
  }, [provider]);
  useEffect(() => {
    editor?.setEditable(editable && !["blocked", "restored"].includes(provider.getSnapshot().status));
  }, [editable, editor, provider]);
  useEffect(() => {
    readyRef.current(editor ? { editor, provider } : null);
    return () => { readyRef.current(null); };
  }, [editor, provider]);
  useEffect(() => { if (!editor) return; const openFind = (event: KeyboardEvent) => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f" && shellRef.current?.closest("[data-document-workspace]")?.contains(document.activeElement)) { event.preventDefault(); setFindOpen(true); } }; document.addEventListener("keydown", openFind); return () => document.removeEventListener("keydown", openFind); }, [editor]);
  async function uploadFile(file: File, requestId = crypto.randomUUID(), at?: string) {
    if (!editor?.isEditable || uploadState.busy) return;
    if (file.size > 20 * 1048576) { setLinkNotice("单个附件不能超过 20 MB。"); return; }
    let anchor = at;
    if (!anchor) { const { $from } = editor.state.selection; for (let d = $from.depth; d > 0; d--) if ($from.node(d).attrs.id) { anchor = String($from.node(d).attrs.id); break; } }
    setUploadState({ busy: true, file, requestId, at: anchor });
    try {
      const data = new FormData(); for (const [key, value] of Object.entries({ projectId: initial.projectId, targetType: "document", targetId: initial.id, requestId })) data.set(key, value); data.set("file", file);
      const response = await fetch("/api/attachments", { method: "POST", body: data }); const result = await response.json(); if (!response.ok) throw Error(result.error ?? "上传失败");
      await reloadResources();
      if (editor.isDestroyed || !editor.isEditable) throw Error("文件已上传，编辑权限已改变，请在附件列表中查看。");
      let position: number | null = null;
      editor.state.doc.descendants((node, pos) => { if (node.attrs.id === anchor) { position = pos + node.nodeSize; return false; } });
      if (position === null) throw Error("文件已上传，原段落已删除；请从附件列表复制链接或重新选择插入位置。");
      editor.chain().focus().insertContentAt(position, { type: "documentAttachment", attrs: { attachmentId: result.id } }).run();
      setUploadState({ busy: false }); window.dispatchEvent(new Event("agilecampus-attachments-updated")); setLinkNotice("附件已插入正文。");
    } catch (error) { setUploadState({ busy: false, file, requestId, at: anchor, error: error instanceof Error ? error.message : "上传失败，可重试" }); }
  }
  useEffect(() => { uploadRef.current = (file, requestId, at) => { void uploadFile(file, requestId, at); }; });
  const choices = useMemo(() => mentionChoices(resources, documents, mention?.query ?? "").filter(item => mentionFilter === "all" || item.kind === mentionFilter), [resources, documents, mention?.query, mentionFilter]);
  const chooseMention = useCallback((item: MentionChoice) => {
    if (!editor?.isEditable || !mention) return;
    const expected = "@" + mention.query;
    if (mention.to > editor.state.doc.content.size || editor.state.doc.textBetween(mention.from, mention.to) !== expected) { setMention(null); setLinkNotice("插入位置已改变，请重新输入 @。"); return; }
    editor.chain().focus().insertContentAt({ from: mention.from, to: mention.to }, [{ type: item.kind === "person" ? "documentMention" : item.kind === "document" ? "documentReference" : "documentTaskReference", attrs: { [item.kind === "person" ? "userId" : item.kind === "document" ? "documentId" : "taskId"]: item.id } }, { type: "text", text: " " }]).run();
    if (item.kind === "person" && notifyMention && item.id !== initial.actorId) setPendingMentions(ids => [...new Set([...ids, item.id])]);
    if (item.kind === "document") void documentRequest<DocumentReferenceItem[]>(`${base}/references`).catch(() => {});
    setMention(null);
  }, [editor, mention, notifyMention, initial.actorId, base]);
  async function sendMentionNotifications() {
    if (!editor?.isEditable) return;
    try {
      await provider.flush(); const revision = provider.getSnapshot().revision;
      const blocks = new Map<string, Set<string>>();
      editor.state.doc.descendants((node, pos) => { if (node.type.name !== "documentMention" || !pendingMentions.includes(node.attrs.userId)) return; const resolved = editor.state.doc.resolve(pos); let id = ""; for (let d = resolved.depth; d > 0; d--) if (resolved.node(d).attrs.id) { id = resolved.node(d).attrs.id; break; } if (id) { if (!blocks.has(id)) blocks.set(id, new Set()); blocks.get(id)!.add(node.attrs.userId); } });
      for (const [blockId, userIds] of blocks) await documentMutation(`${base}/mentions`, "POST", { expectedRevision: revision, epoch: initial.epoch, blockId, userIds: [...userIds] });
      setPendingMentions([]); setLinkNotice(blocks.size ? "已提醒被 @ 的成员，可从通知定位到正文。" : "提及已删除，没有发送提醒。");
    } catch (error) { setLinkNotice(error instanceof Error ? error.message : "提醒失败，请重试"); }
  }
  const run = useCallback((command: (current: Editor) => void) => {
    if (!editor || !editor.isEditable) return;
    if (slash) {
      const { $from } = editor.state.selection;
      const current = findSlashRange($from.parent.textBetween(0, $from.parentOffset), $from.pos, editor.state.selection.empty, $from.parent.type.name);
      if (!current) return;
      editor.chain().focus().deleteRange({ from: current.from, to: current.to }).run();
      setSlash(null);
    }
    command(editor);
  }, [editor, slash]);
  const filteredCommands = useMemo(() => slash ? insertCommands.filter(command => matchesCommand(slash.query, command.label, command.aliases)) : [], [slash]);
  const selectedIndex = Math.min(commandIndex, Math.max(0, filteredCommands.length - 1));
  useEffect(() => {
    keyHandler.current = (event) => {
      if (editor?.isEditable && !event.isComposing && event.altKey && event.shiftKey && ["ArrowUp", "ArrowDown"].includes(event.key)) {
        const transaction = moveDocumentBlock(editor.state, event.key === "ArrowUp" ? -1 : 1);
        if (transaction) editor.view.dispatch(transaction);
        event.preventDefault(); return true;
      }
      if (mention && editor?.isEditable && !event.isComposing && !editor.view.composing) {
        if (event.key === "Escape") { setMention(null); return true; }
        if (["ArrowDown", "ArrowUp"].includes(event.key)) { setMentionIndex((mentionIndex + (event.key === "ArrowDown" ? 1 : -1) + Math.max(choices.length, 1)) % Math.max(choices.length, 1)); return true; }
        if (event.key === "Enter" && choices.length) { chooseMention(choices[Math.min(mentionIndex, choices.length - 1)]); return true; }
      }
      if (!slash || !editor?.isEditable || event.isComposing || editor.view.composing) return false;
      if (event.key === "Escape") { dismissedSlash.current = JSON.stringify(slash); setSlash(null); return true; }
      if (["ArrowDown", "ArrowUp"].includes(event.key)) {
        if (filteredCommands.length) setCommandIndex((selectedIndex + (event.key === "ArrowDown" ? 1 : -1) + filteredCommands.length) % filteredCommands.length);
        return true;
      }
      if (event.key === "Enter" && filteredCommands.length) { run(filteredCommands[selectedIndex].action); return true; }
      return false;
    };
  }, [slash, editor, filteredCommands, selectedIndex, run, mention, choices, mentionIndex, chooseMention]);
  useEffect(() => { menuRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" }); }, [selectedIndex, slash]);
  const revealBlock = useCallback((id: string) => {
    const block = Array.from(shellRef.current?.querySelectorAll<HTMLElement>("[data-block-id]") ?? []).find(node => node.dataset.blockId === id);
    if (!block) return false;
    for (let parent = block.parentElement; parent; parent = parent.parentElement) if (parent instanceof HTMLDetailsElement) parent.open = true;
    block.scrollIntoView({ behavior: "smooth", block: "center" });
    // A ProseMirror decoration survives remote updates; a manually added DOM
    // class would disappear when the collaborative editor redraws this block.
    editor?.view.dispatch(editor.state.tr.setMeta(documentAnchorHighlightKey, id));
    setActiveBlock(id); return true;
  }, [editor]);
  useEffect(() => {
    if (!editor) return;
    const jump = () => {
      const id = readDocumentBlockHash(window.location.hash);
      if (id && appliedHash.current !== window.location.hash && revealBlock(id)) appliedHash.current = window.location.hash;
    };
    const timer = setTimeout(jump, 100);
    editor.on("update", jump); window.addEventListener("hashchange", jump);
    return () => { clearTimeout(timer); editor.off("update", jump); window.removeEventListener("hashchange", jump); };
  }, [editor, revealBlock]);
  async function copyBlock() {
    if (!editor) return;
    const { $from } = editor.state.selection;
    let id: string | null = null;
    for (let depth = $from.depth; depth > 0; depth--) {
      if ($from.node(depth).attrs.id) { id = String($from.node(depth).attrs.id); break; }
    }
    if (!id) { setLinkNotice("此段落尚未生成链接，请等待文档保存。"); return; }
    try {
      if (provider.getSnapshot().pending) await provider.flush();
      const link = new URL(window.location.href); link.hash = documentBlockHash(id);
      await navigator.clipboard.writeText(link.href); setLinkNotice("段落链接已复制。对方仍需登录并具有文档权限。");
    } catch { setLinkNotice("暂时无法复制链接，请确认内容已保存，并允许浏览器访问剪贴板。"); }
  }
  function insertUrl() {
    try {
      const parsed = new URL(url);
      if (!["https:", "http:"].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error();
      run((current) => urlType === "image" ? current.chain().focus().setImage({ src: parsed.href, alt: "项目文档图片" }).run() : current.chain().focus().extendMarkRange("link").setLink({ href: parsed.href, target: "_blank", rel: "noopener noreferrer" }).run());
      setUrlType(null); setUrl(""); setUrlError("");
    } catch { setUrlError("请输入完整的 HTTP 或 HTTPS 链接。"); }
  }
  function insertReference(item: DocumentSummary) {
    if (!editor || !referenceRange || !editor.isEditable) return;
    if (referenceRange.to > editor.state.doc.content.size || editor.state.doc.textBetween(referenceRange.from, referenceRange.to) !== referenceRange.prefix) { setLinkNotice("插入位置已改变，请重新选择文档引用位置。"); setReferenceRange(null); return; }
    editor.chain().focus().insertContentAt({ from: referenceRange.from, to: referenceRange.to }, { type: "documentReference", attrs: { documentId: item.id } }).run();
    setReferenceRange(null);
  }
  if (!editor) return <p className="p-8 text-sm text-ink-soft">正在准备协作编辑器…</p>;
  const outline = documentOutline(editor.state.doc);
  const caret = slash && editor.isEditable ? editor.view.coordsAtPos(editor.state.selection.from) : null;
  return <div className="document-editor-shell" ref={shellRef} onMouseMove={event => {
    if (!editor.isEditable || dragId.current) return;
    const target = (event.target as HTMLElement).closest<HTMLElement>("[data-block-id]"); if (!target || !editor.view.dom.contains(target)) return;
    let top = target; while (top.parentElement && top.parentElement !== editor.view.dom) top = top.parentElement;
    if (!top.dataset.blockId || top.parentElement !== editor.view.dom) return;
    const rect = top.getBoundingClientRect(), shell = shellRef.current!.getBoundingClientRect();
    setDragHandle({ id: top.dataset.blockId, top: rect.top - shell.top + 3, left: Math.max(2, rect.left - shell.left - 27) });
  }}>
    {editor.isEditable && dragHandle && <button type="button" aria-label="拖动当前内容块" className="document-block-grip" style={{ left: dragHandle.left, top: dragHandle.top }} onPointerDown={event => {
      if (event.button !== 0) return;
      event.preventDefault(); dragId.current = dragHandle.id; event.currentTarget.setPointerCapture(event.pointerId);
      const clear = () => { for (const node of editor.view.dom.querySelectorAll(".document-block-drop-target")) node.classList.remove("document-block-drop-target"); };
      const targetAt = (e: PointerEvent) => { let element = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>("[data-block-id]"); if (!element || !editor.view.dom.contains(element)) return null; while (element.parentElement && element.parentElement !== editor.view.dom) element = element.parentElement; return element.parentElement === editor.view.dom ? element : null; };
      const move = (e: PointerEvent) => { clear(); targetAt(e)?.classList.add("document-block-drop-target"); };
      const cleanup = () => { clear(); dragId.current = ""; window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", finish); window.removeEventListener("pointercancel", cleanup); dragCleanup.current = null; };
      const finish = (e: PointerEvent) => { const target = targetAt(e); if (target?.dataset.blockId && editor.isEditable) { const rect = target.getBoundingClientRect(); const tr = dropDocumentBlock(editor.state, dragId.current, target.dataset.blockId, e.clientY > rect.top + rect.height / 2); if (tr) editor.view.dispatch(tr); } cleanup(); setDragHandle(null); };
      dragCleanup.current?.(); dragId.current = dragHandle.id; dragCleanup.current = cleanup;
      window.addEventListener("pointermove", move); window.addEventListener("pointerup", finish); window.addEventListener("pointercancel", cleanup);
    }}><GripVertical size={16} /></button>}
    <div className="document-reading-tools"><button type="button" onClick={() => setFindOpen(v => !v)}><Search size={14} />查找正文</button>{!editor.isEditable && <button type="button" onClick={() => setOutlineOpen(v => !v)}><ListTree size={14} />正文目录</button>}{pendingMentions.length > 0 && editor.isEditable && <button type="button" onClick={() => void sendMentionNotifications()}><AtSign size={14} />保存并提醒 {pendingMentions.length} 人</button>}</div>
    {findOpen && <DocumentFind editor={editor} onClose={() => setFindOpen(false)} />}
    {editor.isEditable && <div className="document-toolbar flex flex-wrap items-center gap-1 border-b border-line bg-canvas/60 p-2" aria-label="文档格式工具">
      <select aria-label="插入文档块" disabled={!editor.isEditable} value="" className="rounded-md border border-line bg-surface px-2 py-1.5 text-xs" onChange={(event) => { const command = insertCommands.find((item) => item.label === event.target.value); if (command) run(command.action); }}><option value="">插入…</option>{insertCommands.map((command) => <option key={command.label} value={command.label}>{command.label}</option>)}</select>
      {[{ label: "加粗", icon: Bold, active: "bold", command: (current: Editor) => current.chain().focus().toggleBold().run() },
        { label: "斜体", icon: Italic, active: "italic", command: (current: Editor) => current.chain().focus().toggleItalic().run() },
        { label: "无序列表", icon: List, active: "bulletList", command: (current: Editor) => current.chain().focus().toggleBulletList().run() },
        { label: "有序列表", icon: ListOrdered, active: "orderedList", command: (current: Editor) => current.chain().focus().toggleOrderedList().run() },
        { label: "检查清单", icon: CheckSquare, active: "taskList", command: (current: Editor) => current.chain().focus().toggleTaskList().run() },
        { label: "引用", icon: Quote, active: "blockquote", command: (current: Editor) => current.chain().focus().toggleBlockquote().run() },
        { label: "代码块", icon: Code2, active: "codeBlock", command: (current: Editor) => current.chain().focus().toggleCodeBlock().run() },
        { label: "插入表格", icon: Table2, active: "table", command: (current: Editor) => current.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run() },
        { label: "撤销", icon: Undo2, active: "", command: (current: Editor) => current.chain().focus().undo().run() },
        { label: "重做", icon: Redo2, active: "", command: (current: Editor) => current.chain().focus().redo().run() },
      ].filter(item => !["有序列表", "引用", "代码块"].includes(item.label)).map((item) => <button key={item.label} aria-label={item.label} title={item.label} disabled={!editor.isEditable} onMouseDown={(event) => event.preventDefault()} onClick={() => run(item.command)} className={`rounded-md p-2 disabled:opacity-35 ${item.active && editor.isActive(item.active) ? "bg-primary-soft text-primary" : "text-ink-soft hover:bg-primary-soft"}`}><item.icon size={15} /></button>)}
      <button aria-label="插入链接" title="插入链接" disabled={!editor.isEditable} onMouseDown={(event) => event.preventDefault()} onClick={() => { setUrlType("link"); setUrl(editor.getAttributes("link").href || ""); }} className="rounded-md p-2 text-ink-soft hover:bg-primary-soft disabled:opacity-35"><Link2 size={15} /></button>
      <button type="button" aria-label="上传并插入正文" title="上传图片或附件（也可粘贴、拖入）" disabled={!editor.isEditable || uploadState.busy} onMouseDown={e => e.preventDefault()} onClick={() => uploadInput.current?.click()}><Upload size={15} /></button><input ref={uploadInput} type="file" aria-label="正文上传文件" className="sr-only" accept=".png,.jpg,.jpeg,.gif,.webp,.pdf,.ppt,.pptx,.doc,.docx,.xls,.xlsx,.txt,.md,.csv" onChange={e => { const file = e.target.files?.[0]; e.target.value = ""; if (file) void uploadFile(file); }} />
      <button type="button" aria-label="正文提及与引用" title="@ 成员、文档或任务" onMouseDown={e => e.preventDefault()} onClick={() => editor.chain().focus().insertContent("@").run()}><AtSign size={15} /></button>
      <details className="document-format-more"><summary aria-label="更多文档格式">更多 ▾</summary><div>
      <button aria-label="有序列表" disabled={!editor.isEditable} onMouseDown={event => event.preventDefault()} onClick={() => run(current => current.chain().focus().toggleOrderedList().run())}><ListOrdered size={15} />有序列表</button>
      <button aria-label="引用" disabled={!editor.isEditable} onMouseDown={event => event.preventDefault()} onClick={() => run(current => current.chain().focus().toggleBlockquote().run())}><Quote size={15} />引用</button>
      <button aria-label="代码块" disabled={!editor.isEditable} onMouseDown={event => event.preventDefault()} onClick={() => run(current => current.chain().focus().toggleCodeBlock().run())}><Code2 size={15} />代码块</button>
      <button aria-label="插入图片链接" title="插入图片链接" disabled={!editor.isEditable} onClick={() => { setUrlType("image"); setUrl(""); }} className="rounded-md p-2 text-ink-soft hover:bg-primary-soft disabled:opacity-35"><ImageIcon size={15} />插入图片链接</button>
      <button aria-label="引用项目文档" title="引用项目文档（或输入 [[）" disabled={!editor.isEditable || editor.isActive("codeBlock")} onMouseDown={event => event.preventDefault()} onClick={() => { const from = editor.state.selection.from; setReferenceRange({ from, to: from, prefix: "" }); }} className="rounded-md p-2 text-ink-soft hover:bg-primary-soft disabled:opacity-35"><FileText size={15} />引用项目文档</button>
      {([-1, 1] as const).map(direction => <button key={direction} aria-label={direction < 0 ? "内容块上移" : "内容块下移"} title={`${direction < 0 ? "内容块上移" : "内容块下移"}（Alt+Shift+${direction < 0 ? "↑" : "↓"}）`} disabled={!editor.isEditable || !moveDocumentBlock(editor.state, direction)} onMouseDown={event => event.preventDefault()} onClick={() => { const tr = moveDocumentBlock(editor.state, direction); if (tr) { editor.view.dispatch(tr); editor.view.focus(); } }} className="rounded-md px-2 py-1.5 text-xs text-ink-soft hover:bg-primary-soft disabled:opacity-35">{direction < 0 ? "↑ 上移" : "↓ 下移"}</button>)}
      <button className="rounded-md p-2 text-ink-soft hover:bg-primary-soft" aria-label="复制当前段落链接" title="复制当前段落链接" onMouseDown={(event) => event.preventDefault()} onClick={() => void copyBlock()}><Copy size={15} />复制段落链接</button>
      </div></details>
      <button className="flex items-center gap-1 rounded-md p-2 text-xs text-ink-soft hover:bg-primary-soft" aria-expanded={outlineOpen} onClick={() => setOutlineOpen(!outlineOpen)}><ListTree size={14} />正文目录</button>
      <button className="ml-auto flex items-center gap-1 rounded-md p-2 text-xs text-primary hover:bg-primary-soft" disabled={!canComment} onMouseDown={(event) => event.preventDefault()} onClick={() => onComment(editor)}><MessageSquare size={14} />评论当前段落</button>
    </div>
    }
    {editor.isActive("table") && editor.isEditable && <div className="flex flex-wrap gap-2 border-b border-line px-4 py-2 text-xs text-primary"><button onClick={() => editor.chain().focus().addRowAfter().run()}>增加一行</button><button onClick={() => editor.chain().focus().addColumnAfter().run()}>增加一列</button><button onClick={() => editor.chain().focus().deleteRow().run()}>删除当前行</button><button onClick={() => editor.chain().focus().deleteColumn().run()}>删除当前列</button><button onClick={() => editor.chain().focus().deleteTable().run()}>删除表格</button></div>}
    {urlType && <form className="flex flex-wrap gap-2 border-b border-line bg-primary-soft/40 p-3" onSubmit={(event) => { event.preventDefault(); insertUrl(); }}><input aria-label={urlType === "image" ? "图片地址" : "链接地址"} autoFocus placeholder="https://…" className="min-w-0 flex-1 rounded border border-line bg-surface p-2 text-sm" value={url} onChange={(event) => setUrl(event.target.value)} /><button className="ac-btn-ghost">插入</button><button className="ac-btn-ghost" type="button" onClick={() => setUrlType(null)}>取消</button>{urlError && <p className="w-full text-xs text-red-700">{urlError}</p>}</form>}
    {(uploadState.busy || uploadState.error) && <div role={uploadState.error ? "alert" : "status"} className="document-upload-status">{uploadState.busy ? `正在上传 ${uploadState.file?.name}…` : uploadState.error}{!uploadState.busy && uploadState.file && <button type="button" onClick={() => void uploadFile(uploadState.file!, uploadState.requestId, uploadState.at)}>重试上传</button>}</div>}
    {mention && editor.isEditable && <DocumentMentions filter={mentionFilter} setFilter={value => { setMentionFilter(value); setMentionIndex(0); }} items={choices} active={Math.min(mentionIndex, Math.max(0, choices.length - 1))} onActive={setMentionIndex} onChoose={chooseMention} onClose={() => setMention(null)} notify={notifyMention} onNotify={setNotifyMention} left={Math.max(12, Math.min(editor.view.coordsAtPos(editor.state.selection.from).left, window.innerWidth - 390))} top={Math.max(80, Math.min(editor.view.coordsAtPos(editor.state.selection.from).bottom + 8, window.innerHeight - 400))} />}
    {linkNotice && <p role="status" className="document-actions border-b border-line px-4 py-2 text-xs text-primary">{linkNotice}</p>}
    {slash && caret && <div className="document-slash-menu" style={{ left: Math.max(12, Math.min(caret.left, window.innerWidth - 290)), top: Math.max(80, Math.min(caret.bottom + 8, window.innerHeight - 390)) }}>
      <div className="flex justify-between gap-2 border-b border-line p-3 text-xs"><span>输入名称筛选 · ↑↓ 选择 · Enter 插入</span><button aria-label="关闭快捷插入" onMouseDown={event => event.preventDefault()} onClick={() => { dismissedSlash.current = JSON.stringify(slash); setSlash(null); }}><X size={13} /></button></div>
      <div ref={menuRef} role="listbox" aria-label="快捷插入" className="max-h-72 overflow-auto p-1">{filteredCommands.length ? filteredCommands.map((command, index) => <button key={command.label} role="option" aria-selected={index === selectedIndex} className={`block w-full rounded p-2 text-left text-sm ${index === selectedIndex ? "bg-primary-soft text-primary" : "hover:bg-canvas"}`} onMouseDown={event => event.preventDefault()} onClick={() => run(command.action)}>{command.label}</button>) : <p className="p-3 text-sm text-ink-soft">未找到匹配项，按 Esc 继续输入正文。</p>}</div>
    </div>}
    <BubbleMenu editor={editor} pluginKey="documentSelectionMenu" appendTo={appendSelectionMenu} updateDelay={80} options={selectionMenuOptions}
      shouldShow={showSelectionMenu}
      className="document-selection-menu">
      <div className="flex items-center gap-0.5" role="toolbar" aria-label="选中文字操作">
      {editor.isEditable && <><button aria-label="选区加粗" aria-pressed={editor.isActive("bold")} onMouseDown={event => event.preventDefault()} onClick={() => run(current => current.chain().focus().toggleBold().run())}><Bold size={15} /></button><button aria-label="选区斜体" aria-pressed={editor.isActive("italic")} onMouseDown={event => event.preventDefault()} onClick={() => run(current => current.chain().focus().toggleItalic().run())}><Italic size={15} /></button><button aria-label="为选区添加链接" onMouseDown={event => event.preventDefault()} onClick={() => { setUrlType("link"); setUrl(editor.getAttributes("link").href || ""); }}><Link2 size={15} /></button></>}
      {canComment && <button onMouseDown={event => event.preventDefault()} onClick={() => onComment(editor)}><MessageSquare size={14} />评论选区</button>}
      <button onMouseDown={event => event.preventDefault()} onClick={() => void copyBlock()}><Copy size={14} />段落链接</button>
      {editor.isEditable && <button onMouseDown={event => event.preventDefault()} onClick={onAi}><Sparkles size={14} />AI 辅助</button>}
      {canCreateTask && <button onMouseDown={event => event.preventDefault()} onClick={() => onCreateTask(editor)}><Plus size={14} />创建任务</button>}
      </div>
    </BubbleMenu>
    <div className={outlineOpen ? "document-body-with-outline" : ""}>
      {outlineOpen && <nav className="document-outline" aria-label="正文目录"><p className="mb-3 text-xs font-semibold text-ink-soft">正文目录 <span className="font-normal text-ink-faint">{outline.length}</span></p>{outline.length ? outline.map(item => <button key={item.id || item.position} aria-current={activeBlock === item.id && item.id ? "location" : undefined} className="block w-full rounded py-1.5 pr-2 text-left text-xs hover:bg-primary-soft" style={{ paddingLeft: 8 + (Math.min(item.level, 4) - 1) * 10 }} onClick={() => {
        const block = item.id ? null : editor.view.nodeDOM(item.position);
        if (item.id) { revealBlock(item.id); const link = new URL(window.location.href); link.hash = documentBlockHash(item.id); window.history.replaceState(window.history.state, "", link); appliedHash.current = link.hash; }
        else if (block instanceof HTMLElement) block.scrollIntoView({ behavior: "smooth", block: "center" });
      }} title={item.title}>{item.title}</button>) : <p className="text-xs leading-relaxed text-ink-faint">插入标题后，目录会自动出现。</p>}</nav>}
      <EditorContent editor={editor} />
    </div>
    {referenceRange && <DocumentReferencePicker projectId={initial.projectId} documentId={initial.id} query="" onChoose={insertReference} onClose={() => setReferenceRange(null)} />}
  </div>;
}
