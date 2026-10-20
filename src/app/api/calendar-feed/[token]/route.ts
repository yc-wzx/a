import { NextRequest, NextResponse } from "next/server";
import { getCalendarFeed } from "@/lib/schedule/calendar-connections";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export async function GET(_: NextRequest,ctx: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await ctx.params, body = await getCalendarFeed(token.replace(/\.ics$/,""));
    return new NextResponse(body,{ headers: { "Content-Type": "text/calendar; charset=utf-8","Cache-Control": "private, no-store","X-Content-Type-Options": "nosniff","Referrer-Policy": "no-referrer","Content-Disposition": 'inline; filename="agilecampus-calendar.ics"' } });
  } catch { return new NextResponse("此订阅地址不可用或已撤销",{ status: 404,headers: { "Cache-Control": "no-store" } }); }
}
