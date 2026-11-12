import { auth } from "@/lib/auth";
import { AppError, ForbiddenError } from "@/lib/errors";
import { listProjectAttachmentOverview } from "@/lib/attachment-overview";

export async function GET(request: Request, context: { params: Promise<{ projectId: string }> }) {
  const session = await auth();
  if (!session?.user) return Response.json({ error: "请先登录" }, { status: 401 });
  try {
    const page = await listProjectAttachmentOverview(session.user.id, (await context.params).projectId,
      Object.fromEntries(new URL(request.url).searchParams));
    return Response.json(page, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof AppError ? error.message : "附件汇总暂时不可用" },
      { status: error instanceof ForbiddenError ? 403 : 400 });
  }
}
