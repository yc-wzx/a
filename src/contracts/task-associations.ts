import { z } from "zod";

export const taskAssociationsSchema = z.strictObject({
  requestId: z.uuid("请求标识不合法"),
  expectedUpdatedAt: z.iso.datetime({ offset: true, error: "任务版本无效，请重新打开任务" }),
  labelIds: z.array(z.uuid("标签标识无效")).max(100, "一次最多关联 100 个标签"),
  successorIds: z.array(z.uuid("任务标识无效")).max(200, "一次最多关联 200 个后置任务"),
});

export type TaskAssociationsInput = z.infer<typeof taskAssociationsSchema>;
export type TaskAssociationsResult = { taskId: string; updatedAt: string };
