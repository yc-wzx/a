import { z } from "zod";
import type { DocumentDetail, DocumentNode } from "@/contracts/documents";
import { ValidationError } from "./errors";

export type DocumentAnswerSource = { sourceId: string; documentId: string; title: string; blockId: string; text: string };
const normalize = (text: string) => text.replace(/\s+/g, " ").trim();
const inlineText = (node: DocumentNode): string => node.type === "documentReference" ? "[引用文档]" : node.text ?? node.content?.map(inlineText).join("") ?? "";

export function selectDocumentAnswerSources(documents: DocumentDetail[], question: string) {
  const words = [...new Intl.Segmenter("zh-CN", { granularity: "word" }).segment(question.toLocaleLowerCase())]
    .filter(item => item.isWordLike).map(item => item.segment);
  const blocks: Omit<DocumentAnswerSource, "sourceId">[] = [];
  for (const doc of documents) {
    const visit = (node: DocumentNode) => {
      if (["paragraph", "heading", "codeBlock", "toggleSummary"].includes(node.type) && typeof node.attrs?.id === "string") {
        const text = normalize(inlineText(node));
        if (text) blocks.push({ documentId: doc.id, title: doc.title, blockId: node.attrs.id, text });
      } else node.content?.forEach(visit);
    };
    visit(doc.content);
  }
  const scored = blocks.map((item, index) => ({ item, index, score: words.reduce((score, word) => score + (item.text.toLocaleLowerCase().includes(word) ? word.length : 0), 0) }));
  scored.sort((a, b) => b.score - a.score || a.index - b.index);
  const sources: DocumentAnswerSource[] = []; let remaining = 12000;
  for (const { item } of scored) {
    if (sources.length >= 24 || remaining < 80) break;
    const text = item.text.slice(0, Math.min(2400, remaining));
    sources.push({ ...item, text, sourceId: `S${sources.length + 1}` }); remaining -= text.length;
  }
  return { sources, limited: sources.length < blocks.length || sources.some(s => blocks.some(b => b.blockId === s.blockId && b.documentId === s.documentId && b.text.length > s.text.length)) };
}

const answerSchema = z.object({ found: z.boolean(), answer: z.string().trim().max(5000), citations: z.array(z.object({ sourceId: z.string(), quote: z.string().trim().min(1).max(800) })).max(12) }).strict();
export function verifyDocumentAnswer(raw: string, sources: DocumentAnswerSource[], projectId: string) {
  const clean = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  let value: z.infer<typeof answerSchema>;
  try { value = answerSchema.parse(JSON.parse(clean)); }
  catch { throw new ValidationError("助手未返回可核对的资料回答，请重试或缩小问题范围"); }
  if (!value.found) return { answer: "所选资料未提供足够依据。请补充相关文档，或缩小问题范围。", citations: [] };
  if (!value.answer || !value.citations.length) throw new ValidationError("回答缺少原文出处，未予展示，请重新提问");
  const citations = value.citations.map(item => {
    const source = sources.find(s => s.sourceId === item.sourceId);
    if (!source || !normalize(source.text).includes(normalize(item.quote))) throw new ValidationError("回答的引用无法与原文对应，未予展示，请重试");
    return { sourceId: source.sourceId, documentId: source.documentId, title: source.title, quote: item.quote,
      href: `/projects/${projectId}/documents/${source.documentId}#block=${encodeURIComponent(source.blockId)}` };
  });
  return { answer: value.answer, citations };
}
