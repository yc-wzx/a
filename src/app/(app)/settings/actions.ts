"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { unbindFeishu } from "@/lib/user";
import { runAction } from "@/lib/action-result";
import {
  clearMyAiSettings,
  saveMyAiSettings,
  type PersonalAiInput,
} from "@/lib/agent/personal-settings";
import {
  getConfiguredAssistant,
  personalModelRequest,
} from "@/lib/agent/model";
import { generateText } from "ai";

export async function unbindFeishuAction() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  await unbindFeishu(session.user.id);
  revalidatePath("/settings");
}

export async function saveMyAiSettingsAction(input: PersonalAiInput) {
  const result = await runAction((actorId) => saveMyAiSettings(actorId, input));
  if (result.ok) revalidatePath("/settings");
  return result;
}

export async function clearMyAiSettingsAction(expectedRevision: number) {
  const result = await runAction((actorId) =>
    clearMyAiSettings(actorId, expectedRevision),
  );
  if (result.ok) revalidatePath("/settings");
  return result;
}

export async function testMyAiConnectionAction() {
  return runAction(async (actorId) => {
    const assistant = await getConfiguredAssistant(actorId);
    await personalModelRequest(() =>
      generateText({
        model: assistant.model,
        prompt: "只回复：连接成功",
        maxOutputTokens: 24,
        maxRetries: 0,
        abortSignal: AbortSignal.timeout(20000),
      }),
    );
    return { connected: true };
  });
}
