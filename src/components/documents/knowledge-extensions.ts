import { DocumentReference, DocumentToggle, DocumentMention, DocumentTaskReference, DocumentAttachment } from "@/lib/document-nodes";

export const InteractiveDocumentMention = DocumentMention.extend({ addNodeView() { return ({ node }) => { const dom = document.createElement("span"); dom.dataset.documentMention = node.attrs.userId; dom.className = "document-reference"; dom.contentEditable = "false"; return { dom, ignoreMutation: () => true }; }; } });
export const InteractiveDocumentTask = DocumentTaskReference.extend({ addNodeView() { return ({ node }) => { const dom = document.createElement("span"); dom.dataset.documentTask = node.attrs.taskId; dom.className = "document-reference document-task-reference"; dom.contentEditable = "false"; return { dom, ignoreMutation: () => true }; }; } });
export const InteractiveDocumentAttachment = DocumentAttachment.extend({ addNodeView() { return ({ node }) => { const dom = document.createElement("div"); dom.dataset.documentAttachment = node.attrs.attachmentId; if (node.attrs.id) dom.dataset.blockId = node.attrs.id; dom.className = "document-attachment-card"; dom.contentEditable = "false"; return { dom, ignoreMutation: () => true }; }; } });

export const InteractiveDocumentReference = DocumentReference.extend({
  addNodeView() {
    return ({ node }) => {
      const dom = document.createElement("span");
      dom.dataset.documentReference = String(node.attrs.documentId);
      dom.className = "document-reference"; dom.contentEditable = "false";
      dom.textContent = "引用文档";
      return { dom, ignoreMutation: () => true };
    };
  },
});
export const InteractiveDocumentToggle = DocumentToggle.extend({
  addNodeView() {
    return ({ node }) => {
      const dom = document.createElement("details");
      dom.dataset.documentToggle = "true";
      let id = String(node.attrs.id ?? "");
      if (id) dom.dataset.blockId = id;
      const key = () => `agilecampus:fold:${window.location.pathname}:${id}`;
      try { dom.open = localStorage.getItem(key()) !== "closed"; } catch { dom.open = true; }
      dom.addEventListener("toggle", () => { if (id) try { localStorage.setItem(key(), dom.open ? "open" : "closed"); } catch { /* Reading remains usable without storage. */ } });
      return { dom, contentDOM: dom,
        update: next => { if (next.type.name !== "documentToggle") return false; id = String(next.attrs.id ?? ""); if (id) dom.dataset.blockId = id; return true; },
        ignoreMutation: mutation => mutation.type === "attributes" && mutation.target === dom && mutation.attributeName === "open",
      };
    };
  },
});
