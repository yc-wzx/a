import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { assistantRequests } from "@/db/schema";
import { runAgentTurn } from "@/lib/agent/orchestrator";
import { requireScopedConversation } from "@/lib/agent/context";
import { hashRequest } from "@/lib/write-request";
import { AppError } from "@/lib/errors";
export const maxDuration = 90;
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "请先登录" }, { status: 401 });
  const parsed = z.object({ requestId: z.uuid(), projectId: z.uuid(), conversationId: z.uuid(), userText: z.string().trim().min(1).max(4000) }).safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "请输入有效的对话内容" }, { status: 400 });
  const d = parsed.data, actorId = session.user.id, where = and(eq(assistantRequests.userId, actorId), eq(assistantRequests.requestId, d.requestId));
  try { await requireScopedConversation(actorId, d.projectId, d.conversationId, "personal"); }
  catch { return NextResponse.json({ error: "会话不存在或访问权限已变化" }, { status: 403 }); }
  const requestHash = hashRequest(d);
  const [inserted] = await db.insert(assistantRequests).values({ userId: actorId, requestId: d.requestId, conversationId: d.conversationId, requestHash }).onConflictDoNothing().returning();
  if (!inserted) {
    const [old] = await db.select().from(assistantRequests).where(where);
    if (!old || old.requestHash !== requestHash) return NextResponse.json({ error: "请求内容不一致，请新建一轮请求" }, { status: 409 });
    if (old.status === "completed") return new Response(JSON.stringify({ type: "done", result: old.result }) + "\n", { headers: { "Content-Type": "application/x-ndjson", "Cache-Control": "no-store" } });
    if (old.status !== "failed") return NextResponse.json({ error: "这一轮仍在处理中，请稍后查看历史记录" }, { status: 409 });
    const [retry] = await db.update(assistantRequests).set({ status: "running", createdAt: new Date() }).where(and(where, eq(assistantRequests.status, "failed"))).returning();
    if (!retry) return NextResponse.json({ error: "这一轮正在重试，请稍后核对历史" }, { status: 409 });
  }
  const abort = new AbortController();
  req.signal.addEventListener("abort", () => abort.abort(), { once: true });
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      const emit = (value: unknown) => { if (!closed && !abort.signal.aborted) try { controller.enqueue(encoder.encode(JSON.stringify(value) + "\n")); } catch { closed = true; abort.abort(); } };
      try {
        const result = await runAgentTurn({ ...d, actorId, scope: "personal", signal: abort.signal, onText: text => emit({ type: "delta", text }), onProgress: text => emit({ type: "progress", text }) });
        emit({ type: "done", result });
      } catch (e) {
        // Never overwrite a committed result if the browser disconnected after persistence.
        await db.update(assistantRequests).set({ status: "failed" }).where(and(where, eq(assistantRequests.status, "running")));
        emit({ type: "error", error: abort.signal.aborted ? "已停止，本轮未完成" : e instanceof AppError ? e.message : "生成失败，请重试" });
      } finally { closed = true; try { controller.close(); } catch { /* reader closed */ } }
    },
    cancel() { abort.abort(); },
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store, no-transform", "X-Accel-Buffering": "no" } });
}
