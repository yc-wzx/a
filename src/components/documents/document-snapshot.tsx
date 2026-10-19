import type { DocumentNode } from "@/contracts/documents";
export function snapshotText(node: DocumentNode): string {
  if (node.type === "text") return node.text ?? "";
  if (node.type === "hardBreak") return "\n";
  if (node.type === "image") return `[图片：${String(node.attrs?.alt ?? "")} ]`;
  const text = (node.content ?? []).map(snapshotText).join("");
  return text + (["paragraph", "heading", "listItem", "taskItem", "tableRow", "codeBlock", "toggleSummary"].includes(node.type) ? "\n" : "");
}
export function DocumentSnapshot({ content }: { content: DocumentNode }) {
  return <pre className="max-h-[60vh] overflow-auto whitespace-pre-wrap break-words rounded-xl bg-canvas p-6 font-sans text-sm leading-7">{snapshotText(content).trim() || "空文档"}</pre>;
}
