"use server";
import { runAction } from "@/lib/action-result";
import { submitTaskOutcome } from "@/lib/task-outcome";
export async function submitTaskOutcomeAction(projectId: string, taskId: string, input: unknown) {
  return runAction(actor => submitTaskOutcome(actor, projectId, taskId, input));
}
