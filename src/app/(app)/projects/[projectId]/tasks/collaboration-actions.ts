"use server";
import { runAction } from "@/lib/action-result";
import { getTaskCollaboration, mutateCollaboration, sendTaskDiscussion } from "@/lib/task-collaboration";
export async function readCollaborationAction(projectId: string, taskId: string, before?: string) {
  return runAction(actor => getTaskCollaboration(actor, projectId, taskId, before));
}
export async function sendDiscussionAction(projectId: string, taskId: string, input: unknown) {
  return runAction(actor => sendTaskDiscussion(actor, projectId, taskId, input));
}
export async function collaborationAction(projectId: string, taskId: string, input: unknown) {
  return runAction(actor => mutateCollaboration(actor, projectId, taskId, input));
}
