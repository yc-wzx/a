"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { createTeam, joinTeam } from "@/lib/team";
import { AppError } from "@/lib/errors";

export type FormState = { error?: string; success?: string } | null;

const nameSchema = z.string().trim().min(1, "请填写团队名称");
const inviteCodeSchema = z.string().trim().min(1, "请填写邀请码");

export async function createTeamAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const session = await auth();
  if (!session?.user) return { error: "请先登录" };

  const parsed = nameSchema.safeParse(formData.get("name") ?? "");
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  await createTeam(session.user.id, parsed.data);
  revalidatePath("/teams");
  return null;
}

export async function joinTeamAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const session = await auth();
  if (!session?.user) return { error: "请先登录" };

  const parsed = inviteCodeSchema.safeParse(formData.get("inviteCode") ?? "");
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  try {
    const result = await joinTeam(session.user.id, parsed.data);
    if ("pendingApproval" in result) { revalidatePath("/teams"); return { success: "加入申请已提交，管理员审核通过后即可进入团队。" }; }
  } catch (e) {
    if (e instanceof AppError) return { error: e.message };
    throw e;
  }
  revalidatePath("/teams");
  return null;
}
