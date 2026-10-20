"use server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { AppError } from "@/lib/errors";
import { deleteArchivedTeam, previewTeamDeletion, reviewTeamJoinRequest, setTeamArchived, updateTeamInvitation } from "@/lib/team-management";

export type TeamSettingsState = { error?: string; success?: string } | null;
const base = z.object({ teamId: z.uuid(), revision: z.coerce.number().int().positive() });
function invalidate(teamId: string) { revalidatePath("/teams"); revalidatePath(`/teams/${teamId}/settings`); revalidatePath(`/teams/${teamId}/members`); }
export async function saveInvitationAction(_previous: TeamSettingsState, form: FormData): Promise<TeamSettingsState> {
  const session = await auth(); if (!session?.user?.id) return { error: "请先登录" };
  const parsed = base.extend({ lifetimeDays: z.coerce.number().pipe(z.union([z.literal(0), z.literal(1), z.literal(7), z.literal(30)])) }).safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: "请检查邀请设置" };
  try { await updateTeamInvitation(session.user.id, parsed.data.teamId, { revision: parsed.data.revision, enabled: form.get("enabled") === "on", requireApproval: form.get("requireApproval") === "on", lifetimeDays: parsed.data.lifetimeDays, rotate: form.get("rotate") === "on" }); }
  catch (e) { return { error: e instanceof AppError ? e.message : "保存失败，请重试" }; }
  invalidate(parsed.data.teamId); return { success: "邀请设置已保存" };
}
export async function reviewJoinAction(_previous: TeamSettingsState, form: FormData): Promise<TeamSettingsState> {
  const session = await auth(); if (!session?.user?.id) return { error: "请先登录" };
  const parsed = z.object({ teamId: z.uuid(), requestId: z.uuid(), decision: z.enum(["approve", "reject"]) }).safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: "申请信息无效" };
  try { await reviewTeamJoinRequest(session.user.id, parsed.data.teamId, parsed.data.requestId, parsed.data.decision === "approve"); }
  catch (e) { return { error: e instanceof AppError ? e.message : "审核失败，请重试" }; }
  invalidate(parsed.data.teamId); return { success: "加入申请已处理" };
}
export async function archiveTeamAction(_previous: TeamSettingsState, form: FormData): Promise<TeamSettingsState> {
  const session = await auth(); if (!session?.user?.id) return { error: "请先登录" };
  const parsed = base.extend({ archived: z.enum(["true", "false"]) }).safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: "团队信息无效" };
  try { await setTeamArchived(session.user.id, parsed.data.teamId, parsed.data.archived === "true", parsed.data.revision); }
  catch (e) { return { error: e instanceof AppError ? e.message : "操作失败，请重试" }; }
  invalidate(parsed.data.teamId); return { success: parsed.data.archived === "true" ? "团队已归档" : "团队已恢复" };
}
export async function previewTeamDeletionAction(teamId: string) {
  const session = await auth(); if (!session?.user?.id) return { error: "请先登录" };
  try { return { preview: await previewTeamDeletion(session.user.id, teamId) }; }
  catch (e) { return { error: e instanceof AppError ? e.message : "读取删除范围失败" }; }
}
export async function deleteTeamAction(_previous: TeamSettingsState, form: FormData): Promise<TeamSettingsState> {
  const session = await auth(); if (!session?.user?.id) return { error: "请先登录" };
  const parsed = z.object({ teamId: z.uuid(), name: z.string().min(1), token: z.string().regex(/^[a-f0-9]{64}$/) }).safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: "请核对团队名称及解散范围" };
  try { await deleteArchivedTeam(session.user.id, parsed.data.teamId, parsed.data); }
  catch (e) { return { error: e instanceof AppError ? e.message : "解散失败，请重试" }; }
  invalidate(parsed.data.teamId); revalidatePath("/projects"); revalidatePath("/dashboard"); redirect("/teams");
}
