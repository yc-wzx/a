import * as Y from "yjs";
import { prosemirrorJSONToYDoc, yDocToProsemirrorJSON } from "y-prosemirror";
import { getSchema } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import { TableKit } from "@tiptap/extension-table";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import { Extension } from "@tiptap/core";
import type { DocumentNode } from "@/contracts/documents";
import { ValidationError } from "./errors";
import { knowledgeDocumentNodes } from "./document-nodes";

const blocks = ["paragraph", "heading", "blockquote", "codeBlock", "bulletList", "orderedList", "taskList", "table", "image", "horizontalRule", "documentCallout", "documentToggle", "toggleSummary", "documentAttachment"];
const ids = Extension.create({ name: "documentBlockIds", addGlobalAttributes() {
  return [{ types: blocks, attributes: { id: { default: null } } }];
} });
export const documentSchema = getSchema([StarterKit.configure({ undoRedo: false }), Image, TableKit, TaskList, TaskItem, ids, ...knowledgeDocumentNodes()]);
const nodes = new Set([...blocks, "doc", "text", "listItem", "taskItem", "tableRow", "tableCell", "tableHeader", "hardBreak", "toggleContent", "documentReference", "documentMention", "documentTaskReference"]);
const marks = new Set(["bold", "italic", "strike", "underline", "code", "link"]);
export const EMPTY_DOCUMENT: DocumentNode = { type: "doc", content: [{ type: "paragraph" }] };
export function safeDocumentUrl(value: unknown) {
  if (typeof value !== "string" || value.length > 2048) return false;
  if (/^\/api\/attachments\/[0-9a-f-]{36}$/i.test(value)) return true;
  try { const u = new URL(value); return ["https:", "http:"].includes(u.protocol) && !u.username && !u.password && !/[\u0000-\u0020\u007f]/.test(value); } catch { return false; }
}
export function validateDocumentContent(input: unknown): DocumentNode {
  if (!input || typeof input !== "object" || JSON.stringify(input).length > 400000) throw new ValidationError("文档内容过大或格式不正确");
  let count = 0;
  const usedIds = new Set<string>();
  function visit(raw: unknown, depth: number): DocumentNode {
    if (depth > 30 || ++count > 6000 || !raw || typeof raw !== "object") throw new ValidationError("文档结构过大");
    const n = raw as DocumentNode;
    if (!nodes.has(n.type) || (n.text !== undefined && (n.type !== "text" || typeof n.text !== "string"))) throw new ValidationError("文档包含不支持的内容类型");
    const result: DocumentNode = { type: n.type };
    if (n.text !== undefined) result.text = n.text;
    if (n.attrs) {
      const a: Record<string, unknown> = {};
      if (n.attrs.id != null) { if (typeof n.attrs.id !== "string" || !/^[A-Za-z0-9_-]{1,100}$/.test(n.attrs.id) || usedIds.has(n.attrs.id)) throw new ValidationError("段落标识重复或不正确"); usedIds.add(n.attrs.id); a.id = n.attrs.id; }
      if (n.type === "heading") { const level = Number(n.attrs.level); if (![1,2,3,4,5,6].includes(level)) throw new ValidationError("标题层级不正确"); a.level = level; }
      if (n.type === "documentCallout") { if (!["note", "question", "risk"].includes(String(n.attrs.kind ?? "note"))) throw new ValidationError("提示块类型不正确"); a.kind = n.attrs.kind ?? "note"; }
      if (n.type === "documentReference") { if (typeof n.attrs.documentId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(n.attrs.documentId)) throw new ValidationError("引用文档标识不正确"); a.documentId = n.attrs.documentId; }
      if (["documentMention", "documentTaskReference", "documentAttachment"].includes(n.type)) {
        const key = n.type === "documentMention" ? "userId" : n.type === "documentTaskReference" ? "taskId" : "attachmentId";
        if (typeof n.attrs[key] !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(n.attrs[key]))) throw new ValidationError("文档引用标识不正确");
        a[key] = n.attrs[key];
      }
      if (n.type === "image") { if (!safeDocumentUrl(n.attrs.src)) throw new ValidationError("图片需要有效的 HTTP/HTTPS 链接"); a.src = n.attrs.src; for (const k of ["alt", "title"]) if (typeof n.attrs[k] === "string") a[k] = (n.attrs[k] as string).slice(0,500); }
      if (n.type === "taskItem") a.checked = Boolean(n.attrs.checked);
      if (n.type === "orderedList") a.start = Math.min(10000, Math.max(1, Number(n.attrs.start) || 1));
      if (n.type === "codeBlock" && typeof n.attrs.language === "string") a.language = n.attrs.language.slice(0,50);
      if (n.type === "tableCell" || n.type === "tableHeader") { for (const k of ["colspan", "rowspan"]) a[k] = Math.min(50, Math.max(1, Number(n.attrs[k]) || 1)); a.colwidth = Array.isArray(n.attrs.colwidth) ? n.attrs.colwidth.slice(0,50).map(v => Math.min(2000, Math.max(1, Number(v)||100))) : null; }
      result.attrs = a;
    }
    if (["documentMention", "documentTaskReference", "documentAttachment"].includes(n.type) && !result.attrs?.[n.type === "documentMention" ? "userId" : n.type === "documentTaskReference" ? "taskId" : "attachmentId"]) throw new ValidationError("文档引用不能为空");
    if (n.type === "image" && !result.attrs?.src) throw new ValidationError("图片地址不能为空");
    if (n.type === "documentReference" && !result.attrs?.documentId) throw new ValidationError("引用文档不能为空");
    if (n.marks !== undefined) {
      if (!Array.isArray(n.marks) || n.marks.length > 10) throw new ValidationError("文字格式不正确");
      result.marks = n.marks.map(m => { if (!m || typeof m !== "object" || !marks.has(m.type)) throw new ValidationError("不支持的文字格式"); if (m.type === "link") { if (!safeDocumentUrl(m.attrs?.href)) throw new ValidationError("链接必须使用 HTTP/HTTPS"); if (m.attrs?.target != null && m.attrs.target !== "_blank") throw new ValidationError("文档链接需要在新窗口打开"); if (m.attrs?.rel != null && (typeof m.attrs.rel !== "string" || m.attrs.rel.split(/\s+/).some(s => !["", "noopener", "noreferrer", "nofollow"].includes(s)))) throw new ValidationError("文档链接安全属性不正确"); return { type: "link", attrs: { href: m.attrs?.href, target: "_blank", rel: "noopener noreferrer nofollow" } }; } return { type: m.type }; });
    }
    if (n.content !== undefined) { if (!Array.isArray(n.content)) throw new ValidationError("段落格式不正确"); result.content = n.content.map(c => visit(c, depth+1)); }
    return result;
  }
  const result = visit(input, 0);
  if (result.type !== "doc") throw new ValidationError("文档根节点不正确");
  try { documentSchema.nodeFromJSON(result).check(); } catch { throw new ValidationError("文档结构不正确"); }
  return result;
}
export function contentToYState(content: DocumentNode) {
  const ydoc = prosemirrorJSONToYDoc(documentSchema, validateDocumentContent(content), "default");
  try { return Buffer.from(Y.encodeStateAsUpdate(ydoc)).toString("base64"); } finally { ydoc.destroy(); }
}
export function readYState(state: string) {
  const ydoc = new Y.Doc();
  try { Y.applyUpdate(ydoc, decodeDocumentBinary(state, 2400000)); return ydoc; } catch { ydoc.destroy(); throw new ValidationError("文档同步数据不正确"); }
}
export function decodeDocumentBinary(value: string, max = 1400000): Uint8Array {
  if (typeof value !== "string" || value.length > max || !/^[A-Za-z0-9+/]*={0,2}$/.test(value) || value.length % 4 !== 0) throw new ValidationError("同步数据过大或编码不正确");
  return new Uint8Array(Buffer.from(value, "base64"));
}
export function yDocumentContent(ydoc: Y.Doc) {
  if ([...ydoc.share.keys()].some(key => key !== "default")) throw new ValidationError("文档同步包含不支持的数据字段");
  try { return validateDocumentContent(yDocToProsemirrorJSON(ydoc, "default")); } catch (e) { if (e instanceof ValidationError) throw e; throw new ValidationError("文档同步内容不正确"); }
}
export function documentText(node: DocumentNode): string {
  if (node.type === "text") return node.text ?? "";
  if (node.type === "hardBreak") return "\n";
  if (node.type === "documentReference") return "[引用文档]";
  if (node.type === "documentMention") return "[@成员]";
  if (node.type === "documentTaskReference") return "[项目任务]";
  if (node.type === "documentAttachment") return "[文档附件]";
  return (node.content ?? []).map(documentText).join(["paragraph", "heading"].includes(node.type) ? "" : "\n");
}
export function documentBlockExists(node: DocumentNode, id: string): boolean { return node.attrs?.id === id || (node.content ?? []).some(n => documentBlockExists(n,id)); }
function escapeText(text: string) { return text.replace(/([\\`*_\[\]<>])/g,"\\$1"); }
export function documentMarkdown(node: DocumentNode, reference?: (id: string, kind?: string) => string): string {
  const children = (node.content ?? []).map(child => documentMarkdown(child, reference));
  if (node.type === "text") { let s = escapeText(node.text ?? ""); for (const m of node.marks ?? []) { if (m.type === "bold") s = `**${s}**`; else if (m.type === "italic") s = `*${s}*`; else if (m.type === "strike") s = `~~${s}~~`; else if (m.type === "code") s = "`" + (node.text??"").replace(/`/g,"\\`") + "`"; else if (m.type === "link") s = `[${s}](${String(m.attrs?.href).replace(/\)/g,"%29")})`; } return s; }
  const joined = children.join("");
  switch (node.type) {
    case "documentReference": return reference?.(String(node.attrs?.documentId)) ?? "[引用文档]";
    case "documentMention": return reference?.(String(node.attrs?.userId), "member") ?? "[@成员]";
    case "documentTaskReference": return reference?.(String(node.attrs?.taskId), "task") ?? "[项目任务不可用]";
    case "documentAttachment": return reference?.(String(node.attrs?.attachmentId), "attachment") ?? "[文档附件不可用]";
    case "documentCallout": return `> **${({ note: "提示", question: "待确认", risk: "风险" } as Record<string, string>)[String(node.attrs?.kind ?? "note")]}**\n` + children.join("\n\n").split("\n").map(l => "> " + l).join("\n");
    case "documentToggle": return children.join("\n\n");
    case "toggleSummary": return "**" + joined + "**";
    case "toggleContent": return children.join("\n\n");
    case "doc": return children.join("\n\n") + "\n";
    case "paragraph": return joined;
    case "heading": return "#".repeat(Number(node.attrs?.level) || 2) + " " + joined;
    case "hardBreak": return "  \n";
    case "horizontalRule": return "---";
    case "blockquote": return children.join("\n").split("\n").map(l => "> " + l).join("\n");
    case "codeBlock": return "```" + (node.attrs?.language ?? "") + "\n" + documentText(node) + "\n```";
    case "bulletList": return children.map(s => "- " + s.replace(/\n/g,"\n  ")).join("\n");
    case "orderedList": return children.map((s,i) => `${(Number(node.attrs?.start)||1)+i}. ` + s.replace(/\n/g,"\n   ")).join("\n");
    case "taskList": return children.join("\n");
    case "taskItem": return `- [${node.attrs?.checked ? "x":" "}] ` + children.join("\n");
    case "listItem": return children.join("\n");
    case "image": return `![${String(node.attrs?.alt??"").replace(/\]/g,"")}](${String(node.attrs?.src).replace(/\)/g,"%29")})`;
    case "table": { const rows = (node.content??[]).map(row => "| " + (row.content??[]).map(cell => documentText(cell).replace(/\|/g,"\\|").replace(/\n/g," ")).join(" | ") + " |"); if (rows.length) rows.splice(1,0,"| " + (node.content?.[0]?.content??[]).map(()=>"---").join(" | ") + " |"); return rows.join("\n"); }
    default: return joined;
  }
}
