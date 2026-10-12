"use server";
import { revalidatePath } from "next/cache";
import { runAction } from "@/lib/action-result";
import {
  deleteMilestone,
  previewMilestoneDeletion,
  type DeleteMilestoneInput,
} from "@/lib/milestone";

export async function previewMilestoneDeletionAction(
  projectId: string,
  milestoneId: string,
) {
  return runAction((actorId) =>
    previewMilestoneDeletion(actorId, projectId, milestoneId),
  );
}
export async function deleteMilestoneAction(
  projectId: string,
  milestoneId: string,
  input: DeleteMilestoneInput,
) {
  const result = await runAction((actorId) =>
    deleteMilestone(actorId, projectId, milestoneId, input),
  );
  if (result.ok) {
    revalidatePath(`/projects/${projectId}`, "layout");
    revalidatePath("/projects");
    revalidatePath("/dashboard");
    revalidatePath("/teacher");
  }
  return result;
}
