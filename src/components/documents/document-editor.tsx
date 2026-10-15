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
import { moveDocumentBlock } from "./block-movement";
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
    const resource = new DocumentSyncProvider(`/api/projects/${initial.projectId}/documents/${initial.id}/sync`, initial.state, initial.epoch, initial.revision, initial.permission);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setProvider(resource);
    return () => resource.destroy();
  }, [initial]);
  if (!provider) return <p className="p-8 text-sm text-ink-soft">正在准备协作连接…</p>;
  return <DocumentEditorCore key={provider.sessionId} {...props} provider={provider} />;
}
function DocumentEditorCore({ initial, editable, canComment, onReady, onSync, onComment, onAi, provider, references, canCreateTask, onCreateTask }: DocumentEditorProps & { provider: DocumentSyncProvider }) {
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
    extensions: [...baseDocumentExtensions().filter(extension => !["documentReference", "documentToggle"].includes(extension.name)), InteractiveDocumentReference, InteractiveDocumentToggle, DocumentAnchorHighlight,
      Placeholder.configure({ placeholder: "写下项目内容，或输入 / 插入标题、表格、检查项…" }),
      Collaboration.configure({ document: provider.doc, field: "default" }),
      CollaborationCaret.configure({ provider, user: { id: initial.actorId, name: initial.actorName, color: "#b26140" } }),
      UniqueID.configure({ types: ["paragraph", "heading", "blockquote", "codeBlock", "table", "bulletList", "orderedList", "taskList", "image", "horizontalRule", "documentCallout", "documentToggle", "toggleSummary"],
        filterTransaction: (transaction) => !isChangeOrigin(transaction) && provider.getSnapshot().permission === "edit" && !["blocked", "restored"].includes(provider.getSnapshot().status) }),
    ],
    editable,
    editorProps: { attributes: { class: "document-prose", "aria-label": "文档正文编辑器", "data-document-editor": "true" },
      handleKeyDown: (_view, event) => keyHandler.current(event) },
    onUpdate: ({ editor: current }) => {
      const { $from } = current.state.selection;
      if (current.isEditable && $from.parent.type.name !== "codeBlock" && current.state.selection.empty && $from.parent.textBetween(0, $from.parentOffset).endsWith("[[")) setReferenceRange({ from: $from.pos - 2, to: $from.pos, prefix: "[[" });
      const next = findSlashRange($from.parent.textBetween(0, $from.parentOffset), $from.pos, current.state.selection.empty, $from.parent.type.name);
      setSlash(next && JSON.stringify(next) !== dismissedSlash.current ? next : null); setCommandIndex(0);
    },
    onSelectionUpdate: ({ editor: current }) => {
      const { $from } = current.state.selection;
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
        const target = references.find(item => item.id === node.dataset.documentReference);
        node.replaceChildren();
        if (target) { const anchor = document.createElement("a"); anchor.href = target.href; anchor.textContent = target.title; node.append(anchor); }
        else node.textContent = "引用文档不可用";
      }
    };
    updateReferences(); editor.on("update", updateReferences);
    return () => { editor.off("update", updateReferences); };
  }, [editor, references]);
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
      if (!slash || !editor?.isEditable || event.isComposing || editor.view.composing) return false;
      if (event.key === "Escape") { dismissedSlash.current = JSON.stringify(slash); setSlash(null); return true; }
      if (["ArrowDown", "ArrowUp"].includes(event.key)) {
        if (filteredCommands.length) setCommandIndex((selectedIndex + (event.key === "ArrowDown" ? 1 : -1) + filteredCommands.length) % filteredCommands.length);
        return true;
      }
      if (event.key === "Enter" && filteredCommands.length) { run(filteredCommands[selectedIndex].action); return true; }
      return false;
    };
  }, [slash, editor, filteredCommands, selectedIndex, run]);
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
  return <div className="document-editor-shell" ref={shellRef}>
    <div className="document-toolbar flex flex-wrap items-center gap-1 border-b border-line bg-canvas/60 p-2" aria-label="文档格式工具">
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
      ].map((item) => <button key={item.label} aria-label={item.label} title={item.label} disabled={!editor.isEditable} onMouseDown={(event) => event.preventDefault()} onClick={() => run(item.command)} className={`rounded-md p-2 disabled:opacity-35 ${item.active && editor.isActive(item.active) ? "bg-primary-soft text-primary" : "text-ink-soft hover:bg-primary-soft"}`}><item.icon size={15} /></button>)}
      <button aria-label="插入链接" title="插入链接" disabled={!editor.isEditable} onMouseDown={(event) => event.preventDefault()} onClick={() => { setUrlType("link"); setUrl(editor.getAttributes("link").href || ""); }} className="rounded-md p-2 text-ink-soft hover:bg-primary-soft disabled:opacity-35"><Link2 size={15} /></button>
      <button aria-label="插入图片链接" title="插入图片链接" disabled={!editor.isEditable} onClick={() => { setUrlType("image"); setUrl(""); }} className="rounded-md p-2 text-ink-soft hover:bg-primary-soft disabled:opacity-35"><ImageIcon size={15} /></button>
      <button aria-label="引用项目文档" title="引用项目文档（或输入 [[）" disabled={!editor.isEditable || editor.isActive("codeBlock")} onMouseDown={event => event.preventDefault()} onClick={() => { const from = editor.state.selection.from; setReferenceRange({ from, to: from, prefix: "" }); }} className="rounded-md p-2 text-ink-soft hover:bg-primary-soft disabled:opacity-35"><FileText size={15} /></button>
      {([-1, 1] as const).map(direction => <button key={direction} aria-label={direction < 0 ? "内容块上移" : "内容块下移"} title={`${direction < 0 ? "内容块上移" : "内容块下移"}（Alt+Shift+${direction < 0 ? "↑" : "↓"}）`} disabled={!editor.isEditable || !moveDocumentBlock(editor.state, direction)} onMouseDown={event => event.preventDefault()} onClick={() => { const tr = moveDocumentBlock(editor.state, direction); if (tr) { editor.view.dispatch(tr); editor.view.focus(); } }} className="rounded-md px-2 py-1.5 text-xs text-ink-soft hover:bg-primary-soft disabled:opacity-35">{direction < 0 ? "↑ 上移" : "↓ 下移"}</button>)}
      <button className="rounded-md p-2 text-ink-soft hover:bg-primary-soft" aria-label="复制当前段落链接" title="复制当前段落链接" onMouseDown={(event) => event.preventDefault()} onClick={() => void copyBlock()}><Copy size={15} /></button>
      <button className="flex items-center gap-1 rounded-md p-2 text-xs text-ink-soft hover:bg-primary-soft" aria-expanded={outlineOpen} onClick={() => setOutlineOpen(!outlineOpen)}><ListTree size={14} />正文目录</button>
      <button className="ml-auto flex items-center gap-1 rounded-md p-2 text-xs text-primary hover:bg-primary-soft" disabled={!canComment} onMouseDown={(event) => event.preventDefault()} onClick={() => onComment(editor)}><MessageSquare size={14} />评论当前段落</button>
    </div>
    {editor.isActive("table") && editor.isEditable && <div className="flex flex-wrap gap-2 border-b border-line px-4 py-2 text-xs text-primary"><button onClick={() => editor.chain().focus().addRowAfter().run()}>增加一行</button><button onClick={() => editor.chain().focus().addColumnAfter().run()}>增加一列</button><button onClick={() => editor.chain().focus().deleteRow().run()}>删除当前行</button><button onClick={() => editor.chain().focus().deleteColumn().run()}>删除当前列</button><button onClick={() => editor.chain().focus().deleteTable().run()}>删除表格</button></div>}
    {urlType && <form className="flex flex-wrap gap-2 border-b border-line bg-primary-soft/40 p-3" onSubmit={(event) => { event.preventDefault(); insertUrl(); }}><input aria-label={urlType === "image" ? "图片地址" : "链接地址"} autoFocus placeholder="https://…" className="min-w-0 flex-1 rounded border border-line bg-surface p-2 text-sm" value={url} onChange={(event) => setUrl(event.target.value)} /><button className="ac-btn-ghost">插入</button><button className="ac-btn-ghost" type="button" onClick={() => setUrlType(null)}>取消</button>{urlError && <p className="w-full text-xs text-red-700">{urlError}</p>}</form>}
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
