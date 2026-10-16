import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { MockLanguageModelV2 } from "ai/test";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { assistantRequests, messages } from "@/db/schema";
import { createUser } from "@/lib/user";
import { createTeam } from "@/lib/team";
import { createProject } from "@/lib/project";
import { mutateAssistantWorkspace } from "@/lib/agent/workspace";
import { runAgentTurn } from "@/lib/agent/orchestrator";
import { resetDb } from "./helpers";
async function scene() {
  const user = await createUser({ email: "stream@local.test", name: "流式学生", password: "12345678" });
  const team = await createTeam(user.id, "流式验证"), project = await createProject(user.id, team.id, { name: "课程实践" });
  const conversation = await mutateAssistantWorkspace(user.id, { op: "create", projectId: project.id }) as { id: string };
  return { user, project, conversation };
}
function model() {
  return new MockLanguageModelV2({ doStream: async () => ({ stream: new ReadableStream({ start(c) {
    c.enqueue({ type: "stream-start", warnings: [] }); c.enqueue({ type: "text-start", id: "answer" });
    c.enqueue({ type: "text-delta", id: "answer", delta: "先核对" }); c.enqueue({ type: "text-delta", id: "answer", delta: "当前任务。" });
    c.enqueue({ type: "text-end", id: "answer" }); c.enqueue({ type: "finish", finishReason: "stop", usage: { inputTokens: 10, outputTokens: 10, totalTokens: 20 } }); c.close();
  } }) }) });
}
describe("个人助手流式输出和停止", () => {
  beforeEach(resetDb);
  it("逐段输出后原子保存历史与幂等结果", async () => {
    const s = await scene(), requestId = randomUUID(), chunks: string[] = [];
    await db.insert(assistantRequests).values({ userId: s.user.id, conversationId: s.conversation.id, requestId, requestHash: "test" });
    const result = await runAgentTurn({ actorId: s.user.id, projectId: s.project.id, conversationId: s.conversation.id, scope: "personal", requestId, userText: "下一步怎么做", model: model(), onText: delta => chunks.push(delta) });
    expect(chunks.join("")).toBe(result.text); expect(chunks.length).toBeGreaterThan(1);
    expect(await db.select().from(messages).where(eq(messages.conversationId, s.conversation.id))).toHaveLength(2);
    const [record] = await db.select().from(assistantRequests); expect(record.status).toBe("completed"); expect((record.result as {text:string}).text).toBe(result.text);
  });
  it("停止输出不会落入完整历史或执行草案", async () => {
    const s = await scene(), abort = new AbortController();
    await expect(runAgentTurn({ actorId: s.user.id, projectId: s.project.id, conversationId: s.conversation.id, scope: "personal", userText: "下一步怎么做", model: model(), signal: abort.signal, onText: () => abort.abort() })).rejects.toThrow();
    expect(await db.select().from(messages).where(eq(messages.conversationId, s.conversation.id))).toHaveLength(0);
  });
});
