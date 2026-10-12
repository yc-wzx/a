"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import Collaboration, { isChangeOrigin } from "@tiptap/extension-collaboration";
import UniqueID from "@tiptap/extension-unique-id";
import CollaborationCaret from "@tiptap/extension-collaboration-caret";
import Placeholder from "@tiptap/extension-placeholder";
import { Bold, Italic, List, ListOrdered, CheckSquare, Quote, Code2, Table2, Link2, ImageIcon, Undo2, Redo2, MessageSquare } from "lucide-react";
import type { DocumentDetail } from "@/contracts/documents";
import { baseDocumentExtensions } from "./extensions";
import { DocumentSyncProvider, type SyncSnapshot } from "./sync-provider";
import "./documents.css";

export type DocumentEditorHandle = { editor: Editor; provider: DocumentSyncProvider };
type DocumentEditorProps = {
  initial: DocumentDetail;
  editable: boolean;
  canComment: boolean;
  onReady: (handle: DocumentEditorHandle | null) => void;
  onSync: (state: SyncSnapshot) => void;
  onComment: (editor: Editor) => void;
};
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
function DocumentEditorCore({ initial, editable, canComment, onReady, onSync, onComment, provider }: DocumentEditorProps & { provider: DocumentSyncProvider }) {
  const [slash, setSlash] = useState(false);
  const [urlType, setUrlType] = useState<"image" | "link" | null>(null);
  const [url, setUrl] = useState("");
  const [urlError, setUrlError] = useState("");
  const readyRef = useRef(onReady);
  const syncRef = useRef(onSync);
  const editorRef = useRef<Editor | null>(null);
  useEffect(() => { readyRef.current = onReady; syncRef.current = onSync; }, [onReady, onSync]);
  const editor = useEditor({
    immediatelyRender: false,
    shouldRerenderOnTransaction: true,
    extensions: [...baseDocumentExtensions(),
      Placeholder.configure({ placeholder: "写下项目内容，或输入 / 插入标题、表格、检查项…" }),
      Collaboration.configure({ document: provider.doc, field: "default" }),
      CollaborationCaret.configure({ provider, user: { id: initial.actorId, name: initial.actorName, color: "#b26140" } }),
      UniqueID.configure({ types: ["paragraph", "heading", "blockquote", "codeBlock", "table", "bulletList", "orderedList", "taskList", "image", "horizontalRule"],
        filterTransaction: (transaction) => !isChangeOrigin(transaction) && provider.getSnapshot().permission === "edit" && !["blocked", "restored"].includes(provider.getSnapshot().status) }),
    ],
    editable,
    editorProps: { attributes: { class: "document-prose", "aria-label": "文档正文编辑器", "data-document-editor": "true" } },
    onUpdate: ({ editor: current }) => {
      const { $from } = current.state.selection;
      setSlash(/^\/$/.test($from.parent.textBetween(0, $from.parentOffset)));
    },
    onSelectionUpdate: ({ editor: current }) => {
      const { $from } = current.state.selection;
      setSlash(/^\/$/.test($from.parent.textBetween(0, $from.parentOffset)));
    },
  });
  useEffect(() => {
    editorRef.current = editor;
  }, [editor]);
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
      editor.chain().focus().deleteRange({ from: $from.start(), to: $from.pos }).run();
      setSlash(false);
    }
    command(editor);
  }, [editor, slash]);
  const insertCommands = [
    { label: "一级标题", action: (current: Editor) => current.chain().focus().toggleHeading({ level: 1 }).run() },
    { label: "二级标题", action: (current: Editor) => current.chain().focus().toggleHeading({ level: 2 }).run() },
    { label: "三级标题", action: (current: Editor) => current.chain().focus().toggleHeading({ level: 3 }).run() },
    { label: "正文", action: (current: Editor) => current.chain().focus().setParagraph().run() },
    { label: "检查清单", action: (current: Editor) => current.chain().focus().toggleTaskList().run() },
    { label: "表格", action: (current: Editor) => current.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run() },
    { label: "代码块", action: (current: Editor) => current.chain().focus().toggleCodeBlock().run() },
    { label: "分隔线", action: (current: Editor) => current.chain().focus().setHorizontalRule().run() },
  ];
  function insertUrl() {
    try {
      const parsed = new URL(url);
      if (!["https:", "http:"].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error();
      run((current) => urlType === "image" ? current.chain().focus().setImage({ src: parsed.href, alt: "项目文档图片" }).run() : current.chain().focus().extendMarkRange("link").setLink({ href: parsed.href, target: "_blank", rel: "noopener noreferrer" }).run());
      setUrlType(null); setUrl(""); setUrlError("");
    } catch { setUrlError("请输入完整的 HTTP 或 HTTPS 链接。"); }
  }
  if (!editor) return <p className="p-8 text-sm text-ink-soft">正在准备协作编辑器…</p>;
  return <div className="document-editor-shell">
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
      <button className="ml-auto flex items-center gap-1 rounded-md p-2 text-xs text-primary hover:bg-primary-soft" disabled={!canComment} onMouseDown={(event) => event.preventDefault()} onClick={() => onComment(editor)}><MessageSquare size={14} />评论当前段落</button>
    </div>
    {editor.isActive("table") && editor.isEditable && <div className="flex flex-wrap gap-2 border-b border-line px-4 py-2 text-xs text-primary"><button onClick={() => editor.chain().focus().addRowAfter().run()}>增加一行</button><button onClick={() => editor.chain().focus().addColumnAfter().run()}>增加一列</button><button onClick={() => editor.chain().focus().deleteRow().run()}>删除当前行</button><button onClick={() => editor.chain().focus().deleteColumn().run()}>删除当前列</button><button onClick={() => editor.chain().focus().deleteTable().run()}>删除表格</button></div>}
    {urlType && <form className="flex flex-wrap gap-2 border-b border-line bg-primary-soft/40 p-3" onSubmit={(event) => { event.preventDefault(); insertUrl(); }}><input aria-label={urlType === "image" ? "图片地址" : "链接地址"} autoFocus placeholder="https://…" className="min-w-0 flex-1 rounded border border-line bg-surface p-2 text-sm" value={url} onChange={(event) => setUrl(event.target.value)} /><button className="ac-btn-ghost">插入</button><button className="ac-btn-ghost" type="button" onClick={() => setUrlType(null)}>取消</button>{urlError && <p className="w-full text-xs text-red-700">{urlError}</p>}</form>}
    {slash && editor.isEditable && <div className="flex flex-wrap gap-2 border-b border-line bg-primary-soft p-3" aria-label="快捷插入"><span className="self-center text-xs text-ink-soft">插入</span>{insertCommands.map((command) => <button key={command.label} className="rounded-md bg-surface px-2 py-1 text-xs hover:text-primary" onMouseDown={(event) => event.preventDefault()} onClick={() => run(command.action)}>{command.label}</button>)}<button className="ml-auto text-xs text-ink-soft" onClick={() => setSlash(false)}>收起</button></div>}
    <EditorContent editor={editor} />
  </div>;
}
