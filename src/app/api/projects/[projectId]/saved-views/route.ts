import { NextRequest, NextResponse } from "next/server";
import { runAction } from "@/lib/action-result";
import { getAccountProjectViews, saveAccountProjectViews } from "@/lib/saved-project-views-store";
import { isCalendarWriteOriginAllowed } from "@/lib/calendar-http";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ projectId: string }> };
function response(result: Awaited<ReturnType<typeof runAction>>) { return NextResponse.json(result, { status: result.ok ? 200 : result.code === "UNAUTHENTICATED" ? 401 : result.code === "CONFLICT" ? 409 : result.code === "FORBIDDEN" ? 403 : 422, headers: { "Cache-Control": "private, no-store" } }); }
export async function GET(_: NextRequest, ctx: Context) { const { projectId } = await ctx.params; return response(await runAction(actor => getAccountProjectViews(actor, projectId))); }
export async function PUT(req: NextRequest, ctx: Context) {
  const { projectId } = await ctx.params;
  if (!isCalendarWriteOriginAllowed(req.headers.get("origin"),req.nextUrl.origin)) return NextResponse.json({ ok: false, error: "来源不受支持" }, { status: 403 });
  if (Number(req.headers.get("content-length")) > 65536) return NextResponse.json({ ok: false, error: "内容过大" }, { status: 413 });
  let data: unknown; try { data = await req.json(); } catch { return NextResponse.json({ ok: false, error: "请求格式不正确" }, { status: 422 }); }
  return response(await runAction(actor => saveAccountProjectViews(actor, projectId, data)));
}
