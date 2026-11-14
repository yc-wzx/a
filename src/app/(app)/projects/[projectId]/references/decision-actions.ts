"use server";

import { revalidatePath } from "next/cache";
import { runAction } from "@/lib/action-result";
import {
  confirmMeetingDecision,
  removeMeetingDecision,
  saveMeetingDecision,
} from "@/lib/meeting-decisions";

export async function saveMeetingDecisionAction(
  projectId: string,
  referenceId: string,
  input: unknown,
) {
  const result = await runAction((actorId) =>
    saveMeetingDecision(actorId, projectId, referenceId, input),
  );
  if (result.ok) revalidatePath(`/projects/${projectId}/references`);
  return result;
}
export async function confirmMeetingDecisionAction(
  projectId: string,
  referenceId: string,
  input: unknown,
) {
  const result = await runAction((actorId) =>
    confirmMeetingDecision(actorId, projectId, referenceId, input),
  );
  if (result.ok) revalidatePath(`/projects/${projectId}/references`);
  return result;
}
export async function removeMeetingDecisionAction(
  projectId: string,
  referenceId: string,
  input: unknown,
) {
  const result = await runAction((actorId) =>
    removeMeetingDecision(actorId, projectId, referenceId, input),
  );
  if (result.ok) revalidatePath(`/projects/${projectId}/references`);
  return result;
}
