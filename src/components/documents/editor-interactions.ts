import type { Node as ProseMirrorNode } from "@tiptap/pm/model";

export type SlashRange = { from: number; to: number; query: string };
export function findSlashRange(textBeforeCursor: string, cursor: number, empty: boolean, blockType: string): SlashRange | null {
  if (!empty || !["paragraph", "heading"].includes(blockType)) return null;
  const match = /(?:^|\s)\/([^\s/]{0,32})$/u.exec(textBeforeCursor);
  return match ? { from: cursor - match[1].length - 1, to: cursor, query: match[1] } : null;
}
export function matchesCommand(query: string, label: string, aliases: string[]) {
  const needle = query.normalize("NFKC").toLocaleLowerCase();
  return [label, ...aliases].some(value => value.normalize("NFKC").toLocaleLowerCase().includes(needle));
}
export type OutlineItem = { id: string | null; position: number; level: number; title: string };
export function documentOutline(doc: ProseMirrorNode): OutlineItem[] {
  const items: OutlineItem[] = [];
  doc.descendants((node, position) => {
    if (node.type.name === "heading") items.push({ id: typeof node.attrs.id === "string" ? node.attrs.id : null,
      position, level: Number(node.attrs.level) || 1, title: node.textContent.trim() || "未命名标题" });
  });
  return items;
}
export function documentBlockHash(id: string) { return `#block=${encodeURIComponent(id)}`; }
export function readDocumentBlockHash(hash: string): string | null {
  const value = new URLSearchParams(hash.replace(/^#/, "")).get("block");
  return value && /^[A-Za-z0-9_-]{1,100}$/.test(value) ? value : null;
}
