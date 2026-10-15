import { NextRequest, NextResponse } from "next/server";
import { runAction } from "@/lib/action-result";
import { searchWorkspace } from "@/lib/workspace-search";
export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams;
  const result = await runAction(actor => searchWorkspace(actor, { q: query.get("q") ?? "", kind: query.get("kind") ?? "all", projectId: query.get("projectId") || undefined, offset: Number(query.get("offset") ?? 0) }));
  return NextResponse.json(result, { status: result.ok ? 200 : result.code === "UNAUTHENTICATED" ? 401 : result.code === "VALIDATION" ? 422 : 500, headers: { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
}
