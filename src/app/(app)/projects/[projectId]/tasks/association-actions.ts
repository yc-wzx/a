"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import type { Result } from "@/contracts/p0-p2";
import { taskAssociationsSchema, type TaskAssociationsInput, type TaskAssociationsResult } from "@/contracts/task-associations";
import { runAction } from "@/lib/action-result";
import { saveTaskAssociations } from "@/lib/task-associations";

export async function saveTaskAssociationsAction(projectId: string, taskId: string,
  input: TaskAssociationsInput): Promise<Result<TaskAssociationsResult>> {
  const parsed = taskAssociationsSchema.extend({ projectId: z.uuid(), taskId: z.uuid() })
    .safeParse({ ...input, projectId, taskId });
  if (!parsed.success) return { ok: false, code: "VALIDATION", error: parsed.error.issues[0].message };
  const { projectId: pid, taskId: tid, ...rest } = parsed.data;
  const result = await runAction(actorId => saveTaskAssociations(actorId, pid, tid, rest));
  if (result.ok) {
    try { revalidatePath(`/projects/${pid}`, "layout"); revalidatePath("/dashboard"); }
    catch { console.error("[tasks] association cache refresh failed"); }
  }
  return result;
}
