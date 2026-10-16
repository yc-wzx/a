import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { AppError, ForbiddenError } from "@/lib/errors";
import { listPersonalConversations, listPersonalMemories, mutateAssistantWorkspace, personalWorkspaceHistory } from "@/lib/agent/workspace";
async function respond(run: (actor: string) => Promise<unknown>) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "请先登录" }, { status: 401 });
  try { return NextResponse.json(await run(session.user.id), { headers: { "Cache-Control": "no-store" } }); }
  catch (e) { return NextResponse.json({ error: e instanceof z.ZodError ? "输入格式不正确" : e instanceof AppError ? e.message : "助手服务暂时不可用" }, { status: e instanceof ForbiddenError ? 403 : 400 }); }
}
export async function GET(req: Request) {
  return respond(async actor => {
    const q = new URL(req.url).searchParams;
    if (q.has("conversationId")) return personalWorkspaceHistory(actor, z.uuid().parse(q.get("conversationId")), z.uuid().parse(q.get("projectId")));
    const [conversations, memories] = await Promise.all([listPersonalConversations(actor), listPersonalMemories(actor)]);
    return { conversations, memories };
  });
}
export async function POST(req: Request) { return respond(actor => req.json().then(input => mutateAssistantWorkspace(actor, input))); }
