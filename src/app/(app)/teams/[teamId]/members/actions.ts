"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { removeTeamMember, updateMemberRole } from "@/lib/team";
import { AppError } from "@/lib/errors";
import { redirect } from "next/navigation";

const schema = z.object({
  teamId: z.uuid(),
  userId: z.uuid(),
  role: z.enum(["admin", "teacher", "student"]),
});

export async function updateRoleAction(formData: FormData) {
  const session = await auth();
  if (!session?.user) throw new AppError("请先登录");

  const parsed = schema.parse(Object.fromEntries(formData));
  await updateMemberRole(session.user.id, parsed.teamId, parsed.userId, parsed.role);
  revalidatePath(`/teams/${parsed.teamId}/members`);
}

export async function changeMemberAction(_previous: { error?: string; success?: string } | null, form: FormData) {
  const session = await auth(); if (!session?.user?.id) return { error: "请先登录" };
  const parsed = schema.extend({ operation: z.enum(["role", "remove"]), role: schema.shape.role.optional() }).safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: "请检查成员和角色信息" };
  const { teamId, userId, role, operation } = parsed.data;
  try {
    if (operation === "remove") await removeTeamMember(session.user.id, teamId, userId);
    else if (role) await updateMemberRole(session.user.id, teamId, userId, role);
    else return { error: "请选择角色" };
  } catch (e) { return { error: e instanceof AppError ? e.message : "操作失败，请重试" }; }
  revalidatePath(`/teams/${teamId}/members`); revalidatePath("/teams"); revalidatePath("/projects"); revalidatePath("/dashboard");
  if (operation === "remove" && userId === session.user.id) redirect("/teams");
  return { success: operation === "remove" ? "成员已移除" : "角色已更新" };
}
