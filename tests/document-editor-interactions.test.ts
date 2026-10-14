import { describe, expect, it } from "vitest";
import { getSchema } from "@tiptap/core";
import { baseDocumentExtensions } from "@/components/documents/extensions";
import { documentBlockHash, documentOutline, findSlashRange, matchesCommand, readDocumentBlockHash } from "@/components/documents/editor-interactions";
import { courseDocumentTemplates, courseTemplateContent } from "@/components/documents/course-templates";
import { validateDocumentContent } from "@/lib/documents-content";
import { EditorState } from "@tiptap/pm/state";
import type { DecorationSet } from "@tiptap/pm/view";
import { documentAnchorHighlightKey, documentAnchorHighlightPlugin } from "@/components/documents/anchor-highlight";

describe("document editor interactions", () => {
  it("replaces only the slash query, preserving text before a spaced command", () => {
    expect(findSlashRange("已有说明 /表格", 20, true, "paragraph")).toEqual({ from: 17, to: 20, query: "表格" });
    expect(findSlashRange("/h2", 4, true, "heading")).toEqual({ from: 1, to: 4, query: "h2" });
  });
  it("does not treat URLs, paths, code blocks or selected text as commands", () => {
    for (const text of ["https://example.com/table", "说明/h2", "/two words", "//h1"]) expect(findSlashRange(text, text.length + 1, true, "paragraph")).toBeNull();
    expect(findSlashRange("/h2", 4, false, "paragraph")).toBeNull();
    expect(findSlashRange("/h2", 4, true, "codeBlock")).toBeNull();
    expect(findSlashRange("/" + "a".repeat(33), 35, true, "paragraph")).toBeNull();
  });
  it("matches Chinese, English aliases and full width input", () => {
    expect(matchesCommand("标题", "二级标题", ["h2"])).toBe(true);
    expect(matchesCommand("Ｈ２", "二级标题", ["h2"])).toBe(true);
    expect(matchesCommand("TABLE", "表格", ["table"])).toBe(true);
    expect(matchesCommand("unknown", "表格", ["table"])).toBe(false);
  });
  it("keeps stable identities for duplicate headings and updates titles from current content", () => {
    const schema = getSchema(baseDocumentExtensions());
    const doc = schema.nodeFromJSON({ type: "doc", content: [
      { type: "heading", attrs: { id: "first", level: 1 }, content: [{ type: "text", text: "相同标题" }] },
      { type: "paragraph", content: [{ type: "text", text: "正文" }] },
      { type: "heading", attrs: { id: "second", level: 3 }, content: [{ type: "text", text: "相同标题" }] },
      { type: "heading", attrs: { level: 2 } },
    ] });
    const items = documentOutline(doc);
    expect(items.map(item => [item.id, item.level, item.title])).toEqual([["first", 1, "相同标题"], ["second", 3, "相同标题"], [null, 2, "未命名标题"]]);
    expect(new Set(items.map(item => item.position)).size).toBe(3);
  });
  it("parses only safe bounded document block anchors", () => {
    expect(readDocumentBlockHash(documentBlockHash("abc-123_def"))).toBe("abc-123_def");
    for (const hash of ["#comment=123", '#block=%22%5Dscript', "#block=" + "x".repeat(101)]) expect(readDocumentBlockHash(hash)).toBeNull();
  });
  it("keeps the shared block highlighted when preceding content is inserted or its text changes", () => {
    const schema = getSchema(baseDocumentExtensions());
    const doc = schema.nodeFromJSON({ type: "doc", content: [{ type: "paragraph", attrs: { id: "shared" }, content: [{ type: "text", text: "原内容" }] }] });
    const plugin = documentAnchorHighlightPlugin();
    let state = EditorState.create({ schema, doc, plugins: [plugin] });
    state = state.apply(state.tr.setMeta(documentAnchorHighlightKey, "shared"));
    state = state.apply(state.tr.insert(0, schema.nodes.paragraph.create({ id: "preceding" }, schema.text("新增段落"))));
    state = state.apply(state.tr.insertText("协作补充", state.doc.firstChild!.nodeSize + 1));
    const decorations = plugin.props.decorations!.call(plugin, state) as DecorationSet;
    const match = decorations.find()[0];
    expect(state.doc.nodeAt(match.from)!.attrs.id).toBe("shared");
    expect(state.doc.nodeAt(match.from)!.textContent).toContain("协作补充");
  });
  it("does not highlight a different block after the linked paragraph is deleted", () => {
    const schema = getSchema(baseDocumentExtensions());
    const doc = schema.nodeFromJSON({ type: "doc", content: [{ type: "paragraph", attrs: { id: "shared" } }, { type: "paragraph", attrs: { id: "other" } }] });
    const plugin = documentAnchorHighlightPlugin();
    let state = EditorState.create({ schema, doc, plugins: [plugin] });
    state = state.apply(state.tr.setMeta(documentAnchorHighlightKey, "shared"));
    state = state.apply(state.tr.delete(0, state.doc.firstChild!.nodeSize));
    expect((plugin.props.decorations!.call(plugin, state) as DecorationSet).find()).toHaveLength(0);
  });
  it("produces valid independent course templates without shared block identities", () => {
    for (const template of courseDocumentTemplates) {
      const first = courseTemplateContent(template.id)!;
      expect(validateDocumentContent(first)).toEqual(first);
      first.content![0].attrs!.id = "should-not-spread";
      expect(courseTemplateContent(template.id)!.content![0].attrs!.id).toBeUndefined();
    }
    expect(courseTemplateContent("unknown")).toBeUndefined();
  });
});
