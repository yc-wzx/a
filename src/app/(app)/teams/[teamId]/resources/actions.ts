"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { cancelResourceReservation, createResourceReservation, createResourceUsage, endResourceUsage, reviewResourceReservation } from "@/lib/resource";
import { AppError } from "@/lib/errors";
import { isoLocal } from "@/lib/schedule/types";

export type FormState = { error: string } | null;

const createSchema = z.object({
  teamId: z.uuid(),
  resourceName: z.string().trim().min(1, "请填写资源名称"),
  purpose: z.string().trim().optional(),
  startTime: z.string().min(1, "请选择开始时间"),
  endTime: z.string().optional(),
});

export async function createResourceAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const session = await auth();
  if (!session?.user) return { error: "请先登录" };

  const parsed = createSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  let start: Date;
  try { start = new Date(isoLocal(parsed.data.startTime)); }
  catch { return { error: "开始时间无效" }; }
  let end: Date | undefined;
  if (parsed.data.endTime) {
    try { end = new Date(isoLocal(parsed.data.endTime)); }
    catch { return { error: "结束时间无效" }; }
  }

  try {
    await createResourceUsage(session.user.id, parsed.data.teamId, {
      resourceName: parsed.data.resourceName,
      purpose: parsed.data.purpose,
      startTime: start,
      endTime: end,
    });
  } catch (e) {
    if (e instanceof AppError) return { error: e.message };
    throw e;
  }
  revalidatePath(`/teams/${parsed.data.teamId}/resources`);
  return null;
}

const endSchema = z.object({ teamId: z.uuid(), usageId: z.uuid() });

export async function endResourceAction(formData: FormData) {
  const session = await auth();
  if (!session?.user) throw new AppError("请先登录");

  const parsed = endSchema.parse(Object.fromEntries(formData));
  await endResourceUsage(session.user.id, parsed.usageId);
  revalidatePath(`/teams/${parsed.teamId}/resources`);
}

export async function createReservationAction(_previous: { error?: string; success?: string } | null, form: FormData) {
  const session = await auth(); if (!session?.user?.id) return { error: "请先登录" };
  const parsed = createSchema.extend({ purpose: z.string().trim().min(1, "请填写使用目的").max(2000), resourceName: z.string().trim().min(1, "请填写资源名称").max(120), endTime: z.string().min(1, "请选择结束时间") }).safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  try { await createResourceReservation(session.user.id, parsed.data.teamId, { resourceName: parsed.data.resourceName, purpose: parsed.data.purpose, startTime: new Date(isoLocal(parsed.data.startTime)), endTime: new Date(isoLocal(parsed.data.endTime)) }); }
  catch (e) { return { error: e instanceof AppError ? e.message : "预约提交失败，请检查时间后重试" }; }
  revalidatePath(`/teams/${parsed.data.teamId}/resources`); return { success: "预约已提交，等待管理员或指导教师审批" };
}
export async function manageReservationAction(_previous: { error?: string; success?: string } | null, form: FormData) {
  const session = await auth(); if (!session?.user?.id) return { error: "请先登录" };
  const parsed = z.object({ teamId: z.uuid(), reservationId: z.uuid(), revision: z.coerce.number().int().positive(), decision: z.enum(["approve", "reject", "cancel"]), note: z.string().max(1000).optional() }).safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: "请检查预约信息" };
  try {
    if (parsed.data.decision === "cancel") await cancelResourceReservation(session.user.id, parsed.data.reservationId, parsed.data.revision);
    else await reviewResourceReservation(session.user.id, parsed.data.reservationId, { approve: parsed.data.decision === "approve", revision: parsed.data.revision, note: parsed.data.note });
  } catch (e) { return { error: e instanceof AppError ? e.message : "操作失败，请刷新后重试" }; }
  revalidatePath(`/teams/${parsed.data.teamId}/resources`); return { success: "预约状态已更新" };
}
