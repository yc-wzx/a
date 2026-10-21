"use client";
import { useState } from "react";
import type { Editor } from "@tiptap/react";
import { TextSelection } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import type { Node } from "@tiptap/pm/model";
import { yUndoPluginKey } from "@tiptap/y-tiptap";
const key = new PluginKey<string>("documentFind");
export function findDocumentMatches(doc: Node, query: string) {
  const matches: { from: number; to: number }[] = [];
  if (!query) return matches;
  // Match contiguous text within a textblock, across formatting marks, never atoms.
  doc.descendants((node, pos) => {
    if (matches.length >= 1000) return false;
    if (!node.isTextblock) return;
    let text = "";
    node.forEach(child => { text += child.isText ? child.text : "\ufffc".repeat(child.nodeSize); });
    let at = 0;
    while ((at = text.indexOf(query, at)) !== -1) { matches.push({ from: pos + 1 + at, to: pos + 1 + at + query.length }); at += query.length; if (matches.length >= 1000) break; }
    return false;
  });
  return matches;
}
export const DocumentFindHighlight = Extension.create({ name: "documentFindHighlight", addProseMirrorPlugins() {
  return [new Plugin({ key, state: { init: () => "", apply: (tr, previous) => tr.getMeta(key) ?? previous }, props: {
    decorations(state) { const query = key.getState(state); return DecorationSet.create(state.doc, findDocumentMatches(state.doc, query ?? "").map(m => Decoration.inline(m.from, m.to, { class: "document-find-match" }))); },
  } })];
} });
export function DocumentFind({ editor, onClose }: { editor: Editor; onClose: () => void }) {
  const [query, setQuery] = useState(""); const [replacement, setReplacement] = useState(""); const [index, setIndex] = useState(0); const [notice, setNotice] = useState("");
  const matches = findDocumentMatches(editor.state.doc, query);
  function locate(next: number) { if (!matches.length) return; const at = (next + matches.length) % matches.length; setIndex(at); const m = matches[at]; editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, m.from, m.to)).scrollIntoView()); }
  function replace(all: boolean) {
    if (!editor.isEditable || !matches.length) return;
    const selected = all ? matches : [matches[Math.min(index, matches.length - 1)]];
    const undo = yUndoPluginKey.getState(editor.state)?.undoManager;
    undo?.stopCapturing();
    const tr = editor.state.tr;
    for (const m of [...selected].reverse()) { if (replacement) tr.insertText(replacement, m.from, m.to); else tr.delete(m.from, m.to); }
    editor.view.dispatch(tr); undo?.stopCapturing(); setNotice(`已替换 ${selected.length} 处，可用撤销恢复。`); setIndex(0);
  }
  return <section className="document-find-bar" aria-label="文内查找替换"><div className="flex flex-wrap items-center gap-2"><input autoFocus aria-label="文内查找" maxLength={200} value={query} onChange={e => { setQuery(e.target.value); setIndex(0); editor.view.dispatch(editor.state.tr.setMeta(key, e.target.value)); }} onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); locate(index + (e.shiftKey ? -1 : 1)); } if (e.key === "Escape") { editor.view.dispatch(editor.state.tr.setMeta(key, "")); onClose(); } }} placeholder="查找当前正文" /><span className="text-xs text-ink-soft">{matches.length ? Math.min(index + 1, matches.length) : 0} / {matches.length}</span><button disabled={!matches.length} onClick={() => locate(index - 1)}>上一处</button><button disabled={!matches.length} onClick={() => locate(index + 1)}>下一处</button><button aria-label="关闭文内查找" onClick={() => { editor.view.dispatch(editor.state.tr.setMeta(key, "")); onClose(); }}>关闭</button></div>{editor.isEditable && <div className="mt-2 flex flex-wrap items-center gap-2"><input aria-label="替换为" placeholder="替换为…" value={replacement} onChange={e => setReplacement(e.target.value)} /><button disabled={!matches.length} onClick={() => replace(false)}>替换此处</button><button disabled={!matches.length} onClick={() => { if (matches.length <= 1 || window.confirm(`替换正文中的 ${matches.length} 处匹配文字？`)) replace(true); }}>全部替换</button><button onClick={() => editor.chain().focus().undo().run()}>撤销</button></div>}{notice && <p className="text-xs text-primary" role="status">{notice}</p>}</section>;
}
