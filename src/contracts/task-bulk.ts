import { z } from "zod";

export const bulkTaskUpdateSchema = z.strictObject({
  requestId: z.uuid(),
  tasks: z.array(z.strictObject({
    taskId: z.uuid(),
    expectedUpdatedAt: z.iso.datetime(),
  })).min(1, "请先选择任务").max(50, "每次最多修改 50 项任务")
    .refine(rows => new Set(rows.map(row => row.taskId)).size === rows.length, "任务不能重复选择"),
  patch: z.strictObject({
    startDate: z.iso.date().nullable().optional(),
    dueDate: z.iso.date().nullable().optional(),
    priority: z.enum(["low", "medium", "high"]).optional(),
  }),
  iteration: z.strictObject({
    id: z.uuid().nullable(),
    versions: z.array(z.strictObject({ id: z.uuid(), revision: z.number().int().nonnegative() })).max(100),
  }).optional(),
}).refine(value => Object.keys(value.patch).length > 0 || value.iteration !== undefined, "请选择要修改的内容");

export type BulkTaskUpdate = z.infer<typeof bulkTaskUpdateSchema>;
export type BulkTaskResult = { taskIds: string[] };
