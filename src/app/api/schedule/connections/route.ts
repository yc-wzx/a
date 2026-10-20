import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { runAction } from "@/lib/action-result";
import { addCalendarConnection, createCalendarFeed, listCalendarConnections, listCalendarFeeds, pushCalendarConnectionEvent, refreshCalendarConnection, removeCalendarConnection, revokeCalendarFeed } from "@/lib/schedule/calendar-connections";
import { isCalendarWriteOriginAllowed } from "@/lib/calendar-http";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export async function GET() {
  const result = await runAction(async actor => ({ connections: await listCalendarConnections(actor), feeds: await listCalendarFeeds(actor) }));
  return NextResponse.json(result,{ status: result.ok ? 200 : 401,headers: { "Cache-Control": "private, no-store" } });
}
export async function POST(req: NextRequest) {
  if (!isCalendarWriteOriginAllowed(req.headers.get("origin"),req.nextUrl.origin)) return NextResponse.json({ ok: false,error: "来源不受支持" },{ status: 403 });
  const raw = await req.text();
  if (raw.length > 12000) return NextResponse.json({ ok: false,error: "请求内容过大" },{ status: 413 });
  let body: unknown; try { body = JSON.parse(raw); } catch { return NextResponse.json({ ok: false,error: "请求格式不正确" },{ status: 422 }); }
  const result = await runAction(async actor => {
    const { operation,data,id } = z.strictObject({ operation: z.enum(["connect","refresh","push","disconnect","createFeed","revokeFeed"]),id: z.uuid().optional(),data: z.unknown().optional() }).parse(body);
    if (operation === "connect") return addCalendarConnection(actor,data);
    if (operation === "createFeed") return createCalendarFeed(actor,data);
    const checked = z.uuid().parse(id);
    if (operation === "refresh") return refreshCalendarConnection(actor,checked);
    if (operation === "push") return pushCalendarConnectionEvent(actor,checked,data);
    if (operation === "revokeFeed") return revokeCalendarFeed(actor,checked);
    const options = z.strictObject({ removeImported: z.boolean() }).parse(data);
    return removeCalendarConnection(actor,checked,options.removeImported);
  });
  return NextResponse.json(result,{ status: result.ok ? 200 : result.code === "UNAUTHENTICATED" ? 401 : result.code === "CONFLICT" ? 409 : result.code === "FORBIDDEN" ? 403 : 422,headers: { "Cache-Control": "private, no-store" } });
}
