import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel } from "ai";
import { AppError } from "@/lib/errors";
import { readMyAiCredential } from "./personal-settings";

// Every invocation resolves the authenticated actor's own configuration.
// Never fall back to another user's key or a shared DEEPSEEK_API_KEY.
export async function getConfiguredAssistant(actorId: string) {
  const settings = await readMyAiCredential(actorId);
  const provider = createOpenAICompatible({
    name: settings.provider,
    baseURL: settings.baseUrl,
    apiKey: settings.apiKey,
    fetch: (input, init) => fetch(input, { ...init, redirect: "error" }),
  });
  return {
    model: provider(settings.modelId) as LanguageModel,
    name: settings.assistantName,
    instructions: settings.instructions,
  };
}

export async function getModel(actorId: string): Promise<LanguageModel> {
  return (await getConfiguredAssistant(actorId)).model;
}

export async function personalModelRequest<T>(
  run: () => Promise<T>,
): Promise<T> {
  try {
    return await run();
  } catch {
    // Provider exceptions may contain request bodies and credentials. Do not log or return them.
    throw new AppError(
      "个人 AI 服务调用失败，请到设置测试连接并核对模型、密钥和额度；本次没有完成操作",
    );
  }
}
