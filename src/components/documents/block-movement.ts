import { TextSelection, type EditorState, type Transaction } from "@tiptap/pm/state";

// Move one complete top-level block. Nested lists/tables remain a single unit;
// identities inside the moved node are preserved for comments and source links.
export function moveDocumentBlock(state: EditorState, direction: -1 | 1): Transaction | null {
  const { $from, $to } = state.selection;
  if ($from.depth < 1 || $to.depth < 1 || $from.index(0) !== $to.index(0)) return null;
  const index = $from.index(0), otherIndex = index + direction;
  if (otherIndex < 0 || otherIndex >= state.doc.childCount) return null;
  const node = state.doc.child(index), other = state.doc.child(otherIndex);
  const start = $from.before(1), relative = $from.pos - start;
  const from = direction < 0 ? start - other.nodeSize : start;
  const to = direction < 0 ? start + node.nodeSize : start + node.nodeSize + other.nodeSize;
  const replacement = direction < 0 ? [node, other] : [other, node];
  if (!state.doc.canReplace(Math.min(index, otherIndex), Math.max(index, otherIndex) + 1, state.doc.type.schema.nodes.doc.create(null, replacement).content)) return null;
  const tr = state.tr.replaceWith(from, to, replacement);
  const movedStart = direction < 0 ? from : from + other.nodeSize;
  return tr.setSelection(TextSelection.near(tr.doc.resolve(movedStart + relative))).scrollIntoView();
}

/** Resolve identities at drop time so a remote insertion cannot shift the target. */
export function dropDocumentBlock(state: EditorState, sourceId: string, targetId: string, after: boolean): Transaction | null {
  if (sourceId === targetId) return null;
  let source = -1, target = -1, sourceSize = 0;
  state.doc.forEach((node, pos) => { if (node.attrs.id === sourceId) { source = pos; sourceSize = node.nodeSize; } if (node.attrs.id === targetId) target = pos + (after ? node.nodeSize : 0); });
  if (source < 0 || target < 0 || source === target || source + sourceSize === target) return null;
  const node = state.doc.nodeAt(source); if (!node) return null;
  const tr = state.tr.delete(source, source + sourceSize); const insertion = target > source ? target - sourceSize : target;
  return tr.insert(insertion, node).setSelection(TextSelection.near(tr.doc.resolve(insertion + 1))).scrollIntoView();
}
