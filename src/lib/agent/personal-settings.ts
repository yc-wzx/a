import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { userAiSettings, users } from "@/db/schema";
import { AppError, ConflictError } from "@/lib/errors";
import {
  AI_PROVIDERS,
  type AiProviderId,
  type PersonalAiSummary,
} from "./provider-options";
import {
  decryptPersonalApiKey,
  encryptPersonalApiKey,
} from "./credential-crypto";

export const personalAiSchema = z.strictObject({
  provider: z.enum([
    "deepseek",
    "dashscope",
    "siliconflow",
    "openai",
    "compatible",
  ]),
  baseUrl: z.string().trim().max(300),
  modelId: z
    .string()
    .trim()
    .min(1, "请填写模型名称")
    .max(160)
    .regex(/^[a-zA-Z0-9._:/-]+$/, "模型名称格式不正确"),
  apiKey: z
    .string()
    .trim()
    .max(4096)
    .regex(/^[^\s\u0000-\u001f]*$/, "密钥中不能包含空白字符"),
  assistantName: z.string().trim().min(1).max(50),
  instructions: z.string().trim().max(2000),
  expectedRevision: z.number().int().min(0),
});
export type PersonalAiInput = z.infer<typeof personalAiSchema>;

export function validatedBaseUrl(provider: AiProviderId, input: string) {
  const preset = AI_PROVIDERS.find((p) => p.id === provider)!;
  const value = provider === "compatible" ? input : preset.baseUrl;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new AppError("请填写有效的 HTTPS 接口地址");
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.port && url.port !== "443")
  )
    throw new AppError("接口地址必须使用 HTTPS，不能包含账号、参数或其他端口");
  const normalized = url.toString().replace(/\/+$/, "");
  const allowed = [
    ...AI_PROVIDERS.filter((p) => p.id !== "compatible").map((p) => p.baseUrl),
    ...(process.env.AI_ALLOWED_BASE_URLS ?? "")
      .split(",")
      .map((s) => s.trim().replace(/\/+$/, ""))
      .filter(Boolean),
  ];
  if (!allowed.includes(normalized))
    throw new AppError(
      "该兼容接口尚未开放，请联系负责人添加；也可选择列表中的服务商",
    );
  // Administrator allowlist must never grant metadata or private network access.
  const host = url.hostname.toLowerCase();
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    /^[\d.]+$/.test(host) ||
    host.includes(":")
  )
    throw new AppError("接口地址不能指向本机或 IP 地址");
  return normalized;
}

function summary(
  row: typeof userAiSettings.$inferSelect | undefined,
): PersonalAiSummary {
  return row
    ? {
        configured: Boolean(row.apiKeyCiphertext),
        provider: row.provider as AiProviderId,
        baseUrl: row.baseUrl,
        modelId: row.modelId,
        assistantName: row.assistantName,
        instructions: row.instructions,
        revision: row.revision,
      }
    : {
        configured: false,
        provider: "deepseek",
        baseUrl: AI_PROVIDERS[0].baseUrl,
        modelId: AI_PROVIDERS[0].modelId,
        assistantName: "我的项目助手",
        instructions: "",
        revision: 0,
      };
}

export async function getMyAiSettings(actorId: string) {
  z.uuid().parse(actorId);
  const [row] = await db
    .select()
    .from(userAiSettings)
    .where(eq(userAiSettings.userId, actorId));
  return summary(row);
}

export async function saveMyAiSettings(
  actorId: string,
  input: PersonalAiInput,
) {
  z.uuid().parse(actorId);
  const data = personalAiSchema.parse(input);
  const baseUrl = validatedBaseUrl(data.provider, data.baseUrl);
  return db.transaction(async (tx) => {
    // Lock the account even when no settings row exists: concurrent initial saves cannot overwrite a key.
    const [account] = await tx
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, actorId))
      .for("update");
    if (!account) throw new AppError("请先登录");
    const [old] = await tx
      .select()
      .from(userAiSettings)
      .where(eq(userAiSettings.userId, actorId))
      .for("update");
    if ((old?.revision ?? 0) !== data.expectedRevision)
      throw new ConflictError("AI 设置已在其他页面更新，请刷新后重试");
    if (
      !data.apiKey &&
      (!old?.apiKeyCiphertext ||
        old.provider !== data.provider ||
        old.baseUrl !== baseUrl)
    )
      throw new AppError("首次配置或更换服务商时，请填写对应的 API 密钥");
    const values = {
      provider: data.provider,
      baseUrl,
      modelId: data.modelId,
      assistantName: data.assistantName,
      instructions: data.instructions,
      apiKeyCiphertext: data.apiKey
        ? encryptPersonalApiKey(actorId, data.apiKey)
        : old!.apiKeyCiphertext,
      revision: (old?.revision ?? 0) + 1,
      updatedAt: new Date(),
    };
    const [saved] = old
      ? await tx
          .update(userAiSettings)
          .set(values)
          .where(eq(userAiSettings.userId, actorId))
          .returning()
      : await tx
          .insert(userAiSettings)
          .values({ userId: actorId, ...values })
          .returning();
    return summary(saved);
  });
}

export async function clearMyAiSettings(
  actorId: string,
  expectedRevision: number,
) {
  z.uuid().parse(actorId);
  z.number().int().positive().parse(expectedRevision);
  return db.transaction(async (tx) => {
    await tx
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, actorId))
      .for("update");
    const [old] = await tx
      .select()
      .from(userAiSettings)
      .where(eq(userAiSettings.userId, actorId))
      .for("update");
    if (!old?.apiKeyCiphertext || old.revision !== expectedRevision)
      throw new ConflictError("AI 设置已变化，请刷新后重试");
    // Erase the key but retain a monotonic version, so an old tab cannot overwrite a newly created configuration.
    const [cleared] = await tx
      .update(userAiSettings)
      .set({
        provider: "deepseek",
        baseUrl: AI_PROVIDERS[0].baseUrl,
        modelId: AI_PROVIDERS[0].modelId,
        apiKeyCiphertext: "",
        assistantName: "我的项目助手",
        instructions: "",
        revision: old.revision + 1,
        updatedAt: new Date(),
      })
      .where(eq(userAiSettings.userId, actorId))
      .returning();
    return summary(cleared);
  });
}

export async function readMyAiCredential(actorId: string) {
  z.uuid().parse(actorId);
  const [row] = await db
    .select()
    .from(userAiSettings)
    .where(eq(userAiSettings.userId, actorId));
  if (!row?.apiKeyCiphertext)
    throw new AppError(
      "请先到「设置 → 我的 AI 助手」配置自己的服务商、模型和密钥",
    );
  return {
    ...summary(row),
    baseUrl: validatedBaseUrl(row.provider as AiProviderId, row.baseUrl),
    apiKey: decryptPersonalApiKey(actorId, row.apiKeyCiphertext),
  };
}
