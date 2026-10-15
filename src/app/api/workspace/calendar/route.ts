import { NextRequest, NextResponse } from "next/server";
import { runAction } from "@/lib/action-result";
import { getWorkspaceCalendar } from "@/lib/workspace-calendar";
export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams;
  const result = await runAction(actor => getWorkspaceCalendar(actor, { startDate: q.get("startDate") ?? "", endDate: q.get("endDate") ?? "" }));
  return NextResponse.json(result, {
    status: result.ok ? 200 : result.code === "UNAUTHENTICATED" ? 401 : result.code === "VALIDATION" ? 422 : result.code === "FORBIDDEN" ? 403 : 500,
    headers: { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" },
  });
}
