export const ASSISTANT_WORKFLOW_IDS = ["weekly", "retrospective", "minutes"] as const;
export type AssistantWorkflow = typeof ASSISTANT_WORKFLOW_IDS[number];
export const ASSISTANT_WORKFLOWS = {
  weekly: { label: "项目周报", prompt: "根据最近七天的真实项目记录整理周报，写明完成记录、当前进度、风险和下一步计划。" },
  retrospective: { label: "阶段总结", prompt: "根据当前项目的目标、成果、任务和评审记录，整理阶段总结与下一阶段建议。" },
  minutes: { label: "纪要转任务", prompt: "" },
} as const;
