import { Extension } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import { TableKit } from "@tiptap/extension-table";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import { MarkdownManager } from "@tiptap/markdown";
import type { DocumentNode } from "@/contracts/documents";

export const BlockAnchor = Extension.create({
  name: "blockAnchor",
  addGlobalAttributes() {
    return [{ types: ["paragraph", "heading", "blockquote", "codeBlock", "table", "bulletList", "orderedList", "taskList", "image"],
      attributes: { id: { default: null, parseHTML: (element) => element.getAttribute("data-block-id"),
        renderHTML: (attributes) => attributes.id ? { "data-block-id": attributes.id } : {} } } }];
  },
});
export function baseDocumentExtensions() {
  return [StarterKit.configure({ undoRedo: false, link: { openOnClick: false, protocols: ["https", "http"],
    isAllowedUri: (url, context) => /^https?:/i.test(url) && context.defaultValidate(url) } }),
    Image.configure({ allowBase64: false }), TableKit.configure({ table: { resizable: true } }),
    TaskList, TaskItem.configure({ nested: true }), BlockAnchor];
}
export function importDocumentMarkdown(markdown: string): DocumentNode {
  // Markdown is data; HTML tags remain literal rather than becoming executable DOM.
  const safe = markdown.replace(/<\/?[a-zA-Z][^>]*>/g, (tag) => tag.replaceAll("<", "&lt;").replaceAll(">", "&gt;"));
  const manager = new MarkdownManager({ extensions: baseDocumentExtensions() });
  const parsed = manager.parse(safe) as DocumentNode;
  function safeUrl(value: unknown) {
    if (typeof value !== "string") return false;
    try { const url = new URL(value); return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password; }
    catch { return false; }
  }
  function clean(node: DocumentNode, parent = "doc"): DocumentNode {
    if (node.type === "image" && (!safeUrl(node.attrs?.src) || parent === "paragraph" || parent === "heading")) {
      const text: DocumentNode = { type: "text", text: `[图片：${String(node.attrs?.alt || node.attrs?.src || "未提供地址")}]` };
      return parent === "paragraph" || parent === "heading" ? text : { type: "paragraph", content: [text] };
    }
    return { ...node,
      ...(node.marks ? { marks: node.marks.filter((mark) => mark.type !== "link" || safeUrl(mark.attrs?.href)) } : {}),
      ...(node.content ? { content: node.content.map((child) => clean(child, node.type)) } : {}),
    };
  }
  return clean(parsed);
}
