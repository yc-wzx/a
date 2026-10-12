import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { generateText } from "ai";
import { db } from "@/db";
import { userAiSettings, users } from "@/db/schema";
import {
  encryptPersonalApiKey,
  decryptPersonalApiKey,
} from "@/lib/agent/credential-crypto";
import {
  clearMyAiSettings,
  getMyAiSettings,
  readMyAiCredential,
  saveMyAiSettings,
  validatedBaseUrl,
  type PersonalAiInput,
} from "@/lib/agent/personal-settings";
import {
  getConfiguredAssistant,
  personalModelRequest,
} from "@/lib/agent/model";
import { resetDb } from "./helpers";
const session = vi.hoisted(() => ({ auth: vi.fn() }));
vi.mock("@/lib/auth", () => ({ auth: session.auth }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
import {
  clearMyAiSettingsAction,
  saveMyAiSettingsAction,
  testMyAiConnectionAction,
} from "@/app/(app)/settings/actions";

const input: PersonalAiInput = {
  provider: "deepseek",
  baseUrl: "https://api.deepseek.com",
  modelId: "fixture-model",
  apiKey: "sk-fixture-not-a-real-key",
  assistantName: "学习助手",
  instructions: "用中文列步骤",
  expectedRevision: 0,
};
async function accounts() {
  return db
    .insert(users)
    .values(
      ["one", "two"].map((name) => ({
        name,
        email: `${name}@personal-ai.test`,
        passwordHash: "fixture",
      })),
    )
    .returning();
}
beforeEach(async () => {
  await resetDb();
  vi.stubEnv("AI_SETTINGS_ENCRYPTION_KEY", "a".repeat(64));
  session.auth.mockReset();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("personal AI credentials", () => {
  it("encrypts with a fresh nonce and authenticates the owner, ciphertext and encryption key", () => {
    const id = randomUUID(),
      encrypted = encryptPersonalApiKey(id, input.apiKey);
    expect(encrypted).not.toContain(input.apiKey);
    expect(encryptPersonalApiKey(id, input.apiKey)).not.toBe(encrypted);
    expect(decryptPersonalApiKey(id, encrypted)).toBe(input.apiKey);
    expect(() => decryptPersonalApiKey(randomUUID(), encrypted)).toThrow(
      "无法读取",
    );
    expect(() =>
      decryptPersonalApiKey(id, encrypted.slice(0, -4) + "xxxx"),
    ).toThrow("无法读取");
    vi.stubEnv("AI_SETTINGS_ENCRYPTION_KEY", "b".repeat(64));
    expect(() => decryptPersonalApiKey(id, encrypted)).toThrow("无法读取");
    vi.stubEnv("AI_SETTINGS_ENCRYPTION_KEY", "");
    expect(() => encryptPersonalApiKey(id, input.apiKey)).toThrow("暂不可用");
  });
  it("isolates two accounts and never returns a key or ciphertext in the browser summary", async () => {
    const [one, two] = await accounts();
    const first = await saveMyAiSettings(one.id, input);
    expect(first).toMatchObject({
      configured: true,
      revision: 1,
      assistantName: "学习助手",
    });
    expect(await getMyAiSettings(two.id)).toMatchObject({
      configured: false,
      revision: 0,
    });
    await saveMyAiSettings(two.id, {
      ...input,
      apiKey: "sk-second-fixture",
      assistantName: "另一位助手",
    });
    expect((await readMyAiCredential(one.id)).apiKey).toBe(input.apiKey);
    expect((await readMyAiCredential(two.id)).apiKey).toBe("sk-second-fixture");
    const [stored] = await db
      .select()
      .from(userAiSettings)
      .where(eq(userAiSettings.userId, one.id));
    expect(stored.apiKeyCiphertext).not.toContain(input.apiKey);
    const serialized = JSON.stringify(await getMyAiSettings(one.id));
    expect(serialized).not.toContain(input.apiKey);
    expect(serialized).not.toContain(stored.apiKeyCiphertext);
    expect(first).not.toHaveProperty("apiKey");
    expect(first).not.toHaveProperty("apiKeyCiphertext");
  });
  it("retains a blank key on editing but requires a new key when switching providers", async () => {
    const [one] = await accounts();
    await expect(
      saveMyAiSettings(one.id, { ...input, apiKey: "" }),
    ).rejects.toThrow("首次配置");
    await saveMyAiSettings(one.id, input);
    await saveMyAiSettings(one.id, {
      ...input,
      expectedRevision: 1,
      apiKey: "",
      modelId: "new-model",
    });
    expect((await readMyAiCredential(one.id)).apiKey).toBe(input.apiKey);
    await expect(
      saveMyAiSettings(one.id, {
        ...input,
        provider: "dashscope",
        expectedRevision: 2,
        apiKey: "",
      }),
    ).rejects.toThrow("更换服务商");
    await expect(
      saveMyAiSettings(one.id, { ...input, expectedRevision: 1 }),
    ).rejects.toThrow("其他页面更新");
  });
  it("serializes simultaneous initial saves and preserves a version after deletion/recreation", async () => {
    const [one] = await accounts();
    const results = await Promise.allSettled([
      saveMyAiSettings(one.id, input),
      saveMyAiSettings(one.id, { ...input, apiKey: "different-fixture" }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
    const cleared = await clearMyAiSettings(one.id, 1);
    expect(cleared).toMatchObject({ configured: false, revision: 2 });
    await expect(readMyAiCredential(one.id)).rejects.toThrow("配置自己的");
    const [row] = await db
      .select()
      .from(userAiSettings)
      .where(eq(userAiSettings.userId, one.id));
    expect(row.apiKeyCiphertext).toBe("");
    await saveMyAiSettings(one.id, { ...input, expectedRevision: 2 });
    await expect(clearMyAiSettings(one.id, 1)).rejects.toThrow("已变化");
    await expect(
      saveMyAiSettings(one.id, { ...input, expectedRevision: 1 }),
    ).rejects.toThrow("其他页面更新");
  });
  it("rejects unsafe and unapproved endpoints, including redirect-following requests", () => {
    vi.stubEnv(
      "AI_ALLOWED_BASE_URLS",
      "https://localhost/v1,https://169.254.169.254/v1,https://approved.example/v1",
    );
    for (const url of [
      "http://approved.example/v1",
      "https://x:y@approved.example/v1",
      "https://approved.example:8443/v1",
      "https://unapproved.example/v1",
      "https://localhost/v1",
      "https://169.254.169.254/v1",
      "https://approved.example/v1?token=secret",
    ])
      expect(() => validatedBaseUrl("compatible", url)).toThrow();
    expect(validatedBaseUrl("compatible", "https://approved.example/v1/")).toBe(
      "https://approved.example/v1",
    );
  });
  it("uses each account's own key/model for actual SDK requests, without a shared-key fallback", async () => {
    const [one, two] = await accounts();
    vi.stubEnv("DEEPSEEK_API_KEY", "legacy-shared-key-never-use");
    await expect(getConfiguredAssistant(two.id)).rejects.toThrow("配置自己的");
    await saveMyAiSettings(one.id, input);
    await saveMyAiSettings(two.id, {
      ...input,
      apiKey: "sk-second-fixture",
      modelId: "second-model",
    });
    const calls: {
      auth: string | null;
      model: string;
      redirect: RequestRedirect | undefined;
    }[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      calls.push({
        auth: new Headers(init?.headers).get("Authorization"),
        model: JSON.parse(String(init?.body)).model,
        redirect: init?.redirect,
      });
      return new Response(
        JSON.stringify({
          id: "fixture",
          object: "chat.completion",
          created: 1,
          model: "fixture",
          choices: [
            {
              index: 0,
              message: { role: "assistant", content: "连接成功" },
              finish_reason: "stop",
            },
          ],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });
    for (const user of [one, two])
      await generateText({
        model: (await getConfiguredAssistant(user.id)).model,
        prompt: "test",
        maxRetries: 0,
      });
    expect(calls).toEqual([
      {
        auth: `Bearer ${input.apiKey}`,
        model: "fixture-model",
        redirect: "error",
      },
      {
        auth: "Bearer sk-second-fixture",
        model: "second-model",
        redirect: "error",
      },
    ]);
    await expect(
      personalModelRequest(async () => {
        throw Error(`raw ${input.apiKey}`);
      }),
    ).rejects.toThrow("核对模型");
  });
  it("derives identity from the session and denies forged account fields or unauthenticated actions", async () => {
    const [one, two] = await accounts();
    session.auth.mockResolvedValue(null);
    expect(await saveMyAiSettingsAction(input)).toMatchObject({
      ok: false,
      code: "UNAUTHENTICATED",
    });
    expect(await clearMyAiSettingsAction(1)).toMatchObject({
      ok: false,
      code: "UNAUTHENTICATED",
    });
    expect(await testMyAiConnectionAction()).toMatchObject({
      ok: false,
      code: "UNAUTHENTICATED",
    });
    session.auth.mockResolvedValue({ user: { id: one.id } });
    expect(
      await saveMyAiSettingsAction({
        ...input,
        actorId: two.id,
      } as PersonalAiInput),
    ).toMatchObject({ ok: false, code: "VALIDATION" });
    expect(await saveMyAiSettingsAction(input)).toMatchObject({
      ok: true,
      data: { configured: true },
    });
    expect(await getMyAiSettings(two.id)).toMatchObject({ configured: false });
  });
});
