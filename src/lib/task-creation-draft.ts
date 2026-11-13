import { z } from "zod";

export const taskCreationDraftSchema = z.object({
  version: z.literal(1), requestId: z.uuid(),
  title: z.string().max(200), description: z.string().max(10000),
  assigneeIds: z.array(z.uuid()).max(30),
  iterationId: z.union([z.uuid(), z.literal("")]),
  milestoneId: z.union([z.uuid(), z.literal("")]),
  priority: z.enum(["low", "medium", "high"]),
  startDate: z.union([z.iso.date(), z.literal("")]),
  dueDate: z.union([z.iso.date(), z.literal("")]),
});
export type TaskCreationDraft = z.infer<typeof taskCreationDraftSchema>;

export function emptyTaskDraft(): TaskCreationDraft {
  return { version: 1, requestId: crypto.randomUUID(), title: "", description: "", assigneeIds: [],
    iterationId: "", milestoneId: "", priority: "medium", startDate: "", dueDate: "" };
}
export function hasTaskDraft(value: TaskCreationDraft) {
  return !!(value.title || value.description || value.assigneeIds.length || value.iterationId || value.milestoneId
    || value.startDate || value.dueDate || value.priority !== "medium");
}
export function taskDraftKey(userId: string, projectId: string) {
  return `agilecampus:task-creation:v1:${userId}:${projectId}`;
}
export function readTaskDraft(raw: string | null): TaskCreationDraft | null {
  if (!raw) return null;
  try {
    const parsed = taskCreationDraftSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch { return null; }
}
