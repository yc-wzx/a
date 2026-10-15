import { Node, mergeAttributes } from "@tiptap/core";

// Shared by the browser editor and the server's Yjs/JSON schema.
export const DocumentCallout = Node.create({
  name: "documentCallout", group: "block", content: "block+", defining: true,
  addAttributes() { return { kind: { default: "note", parseHTML: el => el.getAttribute("data-callout-kind") } }; },
  parseHTML() { return [{ tag: "aside[data-callout-kind]" }]; },
  renderHTML({ HTMLAttributes }) { return ["aside", mergeAttributes({ "data-callout-kind": HTMLAttributes.kind, class: "document-callout" }, HTMLAttributes), 0]; },
});
export const DocumentToggle = Node.create({
  name: "documentToggle", group: "block", content: "toggleSummary toggleContent", defining: true,
  parseHTML() { return [{ tag: "details[data-document-toggle]" }]; },
  renderHTML({ HTMLAttributes }) { return ["details", mergeAttributes(HTMLAttributes, { "data-document-toggle": "true" }), 0]; },
});
export const ToggleSummary = Node.create({
  name: "toggleSummary", content: "inline*", defining: true,
  parseHTML() { return [{ tag: "summary" }]; },
  renderHTML() { return ["summary", 0]; },
});
export const ToggleContent = Node.create({
  name: "toggleContent", content: "block+", defining: true,
  parseHTML() { return [{ tag: "div[data-toggle-content]" }]; },
  renderHTML() { return ["div", { "data-toggle-content": "true" }, 0]; },
});
export const DocumentReference = Node.create({
  name: "documentReference", group: "inline", inline: true, atom: true,
  addAttributes() { return { documentId: { default: null, parseHTML: el => el.getAttribute("data-document-reference") } }; },
  parseHTML() { return [{ tag: "span[data-document-reference]" }]; },
  renderHTML({ HTMLAttributes }) { return ["span", { "data-document-reference": HTMLAttributes.documentId, class: "document-reference" }, "引用文档"]; },
  renderText() { return "[引用文档]"; },
});
export function knowledgeDocumentNodes() { return [DocumentCallout, DocumentToggle, ToggleSummary, ToggleContent, DocumentReference]; }
