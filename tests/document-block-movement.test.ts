import { describe, expect, it } from "vitest";
import { EditorState, TextSelection } from "@tiptap/pm/state";
import { getSchema } from "@tiptap/core";
import { baseDocumentExtensions } from "@/components/documents/extensions";
import { moveDocumentBlock } from "@/components/documents/block-movement";
import { contentToYState, documentMarkdown, readYState, yDocumentContent } from "@/lib/documents-content";
const schema = getSchema(baseDocumentExtensions());
function state() {
  const doc = schema.nodeFromJSON({ type: "doc", content: [
    { type: "paragraph", attrs: { id: "a" }, content: [{ type: "text", text: "任务要求" }] },
    { type: "documentCallout", attrs: { id: "b", kind: "risk" }, content: [{ type: "paragraph", attrs: { id: "b-child" }, content: [{ type: "text", text: "先确认权限" }] }] },
    { type: "documentToggle", attrs: { id: "c" }, content: [{ type: "toggleSummary", attrs: { id: "c-title" }, content: [{ type: "text", text: "讨论依据" }] }, { type: "toggleContent", content: [{ type: "paragraph", attrs: { id: "c-child" }, content: [{ type: "text", text: "保留待确认事项" }] }] }] },
  ] });
  return EditorState.create({ schema, doc, selection: TextSelection.create(doc, doc.child(0).nodeSize + 2) });
}
describe("top-level document block movement", () => {
  it("moves a nested block as a whole while preserving paragraph/comment identities and caret", () => {
    const initial = state(), next = initial.apply(moveDocumentBlock(initial, -1)!);
    expect(next.doc.child(0).attrs.id).toBe("b"); expect(next.doc.child(1).attrs.id).toBe("a");
    expect(next.doc.child(0).child(0).attrs.id).toBe("b-child"); expect(next.selection.$from.parent.textContent).toBe("先确认权限");
    expect(next.apply(moveDocumentBlock(next, 1)!).doc.eq(initial.doc)).toBe(true);
  });
  it("rejects crossing the document edge or moving a selection spanning multiple blocks", () => {
    let current = state(); current = current.apply(moveDocumentBlock(current, -1)!);
    expect(moveDocumentBlock(current, -1)).toBeNull();
    const selection = TextSelection.create(current.doc, 2, current.doc.content.size - 2);
    current = current.apply(current.tr.setSelection(selection));
    expect(moveDocumentBlock(current, 1)).toBeNull();
  });
  it("roundtrips fold/callout nodes and all hidden content through Yjs and Markdown", () => {
    const initial = state(), moved = initial.apply(moveDocumentBlock(initial, 1)!);
    const ydoc = readYState(contentToYState(moved.doc.toJSON()));
    try {
      const restored = yDocumentContent(ydoc);
      expect(restored.content!.map(node => node.attrs!.id)).toEqual(["a", "c", "b"]);
      const markdown = documentMarkdown(restored);
      expect(markdown).toContain("保留待确认事项"); expect(markdown).toContain("先确认权限");
    } finally { ydoc.destroy(); }
  });
});
