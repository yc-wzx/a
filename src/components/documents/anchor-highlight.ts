import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

export const documentAnchorHighlightKey = new PluginKey<string | null>("documentAnchorHighlight");
export function documentAnchorHighlightPlugin() {
  return new Plugin<string | null>({
    key: documentAnchorHighlightKey,
    state: { init: () => null, apply: (transaction, previous) => {
      const next: unknown = transaction.getMeta(documentAnchorHighlightKey);
      return next === null || typeof next === "string" ? next : previous;
    } },
    props: { decorations(state) {
      const id = documentAnchorHighlightKey.getState(state);
      if (!id) return null;
      const matches: Decoration[] = [];
      state.doc.descendants((node, position) => {
        if (node.attrs.id === id) matches.push(Decoration.node(position, position + node.nodeSize, { class: "document-highlight" }));
      });
      return DecorationSet.create(state.doc, matches);
    } },
  });
}
export const DocumentAnchorHighlight = Extension.create({
  name: "documentAnchorHighlight",
  addProseMirrorPlugins() { return [documentAnchorHighlightPlugin()]; },
});
