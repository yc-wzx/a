import { and, eq } from "drizzle-orm";
import { Document, HeadingLevel, Packer, Paragraph, Table, TableCell, TableRow, TextRun, WidthType } from "docx";
import { conversations, messages, projects } from "@/db/schema";
import { db } from "@/db";
import { ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { readProject } from "@/lib/project-read";

function inlineText(text: string) {
  return text.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").split(/(\*\*[^*]+\*\*)/g)
    .filter(Boolean).map(part => new TextRun({ text: part.replace(/^\*\*|\*\*$/g, ""), bold: part.startsWith("**") }));
}

export async function buildReportDocument(title: string, content: string, projectName: string) {
  if (!content.trim() || content.length > 100000) throw new ValidationError("正文为空或超过可导出的长度");
  const children: (Paragraph | Table)[] = [
    new Paragraph({ text: title, heading: HeadingLevel.TITLE }),
    new Paragraph({ text: `${projectName} · AI 生成稿，请核对项目事实`, spacing: { after: 240 } }),
  ];
  const lines = content.split(/\r?\n/);
  let inCode = false;
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (line.trim().startsWith("```")) { inCode = !inCode; continue; }
    if (!inCode && /^\s*\|/.test(line) && /^\s*\|?\s*:?-{3,}/.test(lines[index + 1] ?? "")) {
      const rows = [line]; index++;
      while (index + 1 < lines.length && /^\s*\|/.test(lines[index + 1])) rows.push(lines[++index]);
      const cells = rows.map(row => row.replace(/^\s*\||\|\s*$/g, "").split("|"));
      if (rows.length > 200 || cells.some(row => row.length > 8)) {
        children.push(...rows.map(row => new Paragraph({ children: inlineText(row), spacing: { after: 120 } })));
        continue;
      }
      children.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: cells.map((row, rowIndex) =>
        new TableRow({ tableHeader: rowIndex === 0, children: row
          .map(cell => new TableCell({ children: [new Paragraph({ children: inlineText(cell.trim()) })] })) }),
      ) }));
      continue;
    }
    const heading = !inCode && /^(#{1,3})\s+(.+)$/.exec(line);
    if (heading && heading[1] === "#" && heading[2] === title) continue;
    const bullet = !inCode && /^\s*[-*+]\s+(.+)$/.exec(line);
    children.push(new Paragraph({
      children: inCode ? [new TextRun({ text: line, font: "Consolas", size: 20 })] : inlineText(heading ? heading[2] : bullet ? bullet[1] : line),
      ...(heading ? { heading: [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3][heading[1].length - 1] } : {}),
      ...(bullet ? { bullet: { level: 0 } } : {}),
      spacing: { after: 120, line: 320 },
    }));
  }
  return Packer.toBuffer(new Document({
    creator: "AgileCampus", title,
    styles: { default: { document: { run: { font: "Microsoft YaHei", size: 22 } } } },
    sections: [{ properties: { page: { margin: { top: 1134, bottom: 1134, left: 1134, right: 1134 } } }, children }],
  }));
}

export async function exportAssistantReport(actorId: string, messageId: string) {
  const [source] = await db.select({ projectId: conversations.projectId }).from(messages)
    .innerJoin(conversations, eq(conversations.id, messages.conversationId))
    .where(and(eq(messages.id, messageId), eq(messages.role, "assistant"),
      eq(conversations.scope, "personal"), eq(conversations.createdById, actorId)));
  if (!source) throw new NotFoundError("这条个人助手回复不可访问");
  return readProject(actorId, source.projectId, async tx => {
    const [row] = await tx.select({ content: messages.content, title: conversations.title, projectName: projects.name })
      .from(messages).innerJoin(conversations, eq(conversations.id, messages.conversationId))
      .innerJoin(projects, eq(projects.id, conversations.projectId))
      .where(and(eq(messages.id, messageId), eq(messages.role, "assistant"),
        eq(conversations.scope, "personal"), eq(conversations.createdById, actorId)));
    if (!row) throw new ForbiddenError();
    const title = row.content.split(/\r?\n/).find(line => /^#\s+/.test(line))?.replace(/^#\s+/, "").slice(0, 100)
      || row.title?.slice(0, 100) || "项目汇报";
    return { bytes: await buildReportDocument(title, row.content, row.projectName),
      filename: `${title.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_") || "项目汇报"}.docx` };
  });
}
