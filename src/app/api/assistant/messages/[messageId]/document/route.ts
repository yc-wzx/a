import { z } from "zod";
import { auth } from "@/lib/auth";
import { AppError, ForbiddenError, NotFoundError } from "@/lib/errors";
import { exportAssistantReport } from "@/lib/agent/report-document";

export const runtime = "nodejs";
export async function GET(_request: Request, context: { params: Promise<{ messageId: string }> }) {
  const session = await auth();
  if (!session?.user) return Response.json({ error: "请先登录" }, { status: 401 });
  try {
    const report = await exportAssistantReport(session.user.id, z.uuid().parse((await context.params).messageId));
    return new Response(new Uint8Array(report.bytes), { headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "Content-Disposition": `attachment; filename="AgileCampus-report.docx"; filename*=UTF-8''${encodeURIComponent(report.filename)}`,
      "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff",
    } });
  } catch (error) {
    return Response.json({ error: error instanceof AppError ? error.message : "文档导出失败，请重试" },
      { status: error instanceof ForbiddenError ? 403 : error instanceof NotFoundError ? 404 : 400 });
  }
}
