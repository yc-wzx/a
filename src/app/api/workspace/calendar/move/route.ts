import { NextRequest, NextResponse } from "next/server";
import { runAction } from "@/lib/action-result";
import { moveCalendarArrangement } from "@/lib/schedule/calendar-move";
import { isCalendarWriteOriginAllowed } from "@/lib/calendar-http";
export async function POST(req: NextRequest) {
  if (!isCalendarWriteOriginAllowed(req.headers.get("origin"),req.nextUrl.origin)) return NextResponse.json({ ok: false, error: "来源不受支持" }, { status: 403 });
  let data: unknown; try { data = await req.json(); } catch { return NextResponse.json({ ok: false, error: "请求格式不正确" }, { status: 422 }); }
  const result = await runAction(actor => moveCalendarArrangement(actor, data));
  return NextResponse.json(result, { status: result.ok ? 200 : result.code === "UNAUTHENTICATED" ? 401 : result.code === "CONFLICT" ? 409 : result.code === "FORBIDDEN" ? 403 : 422, headers: { "Cache-Control": "private, no-store" } });
}
