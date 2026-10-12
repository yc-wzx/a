"use server";

import { revalidatePath } from "next/cache";
import { runAction } from "@/lib/action-result";
import { addChecklistItem, deleteChecklistItem, getTaskEnhancements, linkTaskMaterial, setProjectDoingLimit, setTaskWatching, unlinkTaskMaterial, updateChecklistItem } from "@/lib/task-enhancements";

function refresh(projectId: string) { revalidatePath(`/projects/${projectId}`); }

export async function getTaskEnhancementsAction(projectId: string, taskId: string) {
  return runAction((actorId) => getTaskEnhancements(actorId, projectId, taskId));
}
export async function addChecklistItemAction(projectId: string, taskId: string, input: { requestId: string; text: string }) {
  const result = await runAction((actorId) => addChecklistItem(actorId, projectId, taskId, input));
  if (result.ok) refresh(projectId);
  return result;
}
export async function updateChecklistItemAction(projectId: string, taskId: string, input: { requestId: string; itemId: string; expectedRevision: number; text?: string; checked?: boolean }) {
  const result = await runAction((actorId) => updateChecklistItem(actorId, projectId, taskId, input));
  if (result.ok) refresh(projectId);
  return result;
}
export async function deleteChecklistItemAction(projectId: string, taskId: string, input: { requestId: string; itemId: string; expectedRevision: number }) {
  const result = await runAction((actorId) => deleteChecklistItem(actorId, projectId, taskId, input));
  if (result.ok) refresh(projectId);
  return result;
}
export async function setTaskWatchingAction(projectId: string, taskId: string, input: { requestId: string; watching: boolean }) {
  const result = await runAction((actorId) => setTaskWatching(actorId, projectId, taskId, input));
  if (result.ok) refresh(projectId);
  return result;
}
export async function linkTaskMaterialAction(projectId: string, taskId: string, input: { requestId: string; kind: "resource" | "deliverable"; sourceId: string }) {
  const result = await runAction((actorId) => linkTaskMaterial(actorId, projectId, taskId, input));
  if (result.ok) refresh(projectId);
  return result;
}
export async function unlinkTaskMaterialAction(projectId: string, taskId: string, input: { requestId: string; linkId: string; expectedRevision: number }) {
  const result = await runAction((actorId) => unlinkTaskMaterial(actorId, projectId, taskId, input));
  if (result.ok) refresh(projectId);
  return result;
}
export async function setProjectDoingLimitAction(projectId: string, input: { requestId: string; expectedRevision: number; doingLimit: number | null }) {
  const result = await runAction((actorId) => setProjectDoingLimit(actorId, projectId, input));
  if (result.ok) refresh(projectId);
  return result;
}
