export const documentGuideSlots = [
  { id: "requirements", label: "需求与范围" },
  { id: "design", label: "设计与交互" },
  { id: "testing", label: "测试与试用" },
  { id: "presentation", label: "汇报与展示" },
] as const;
export type GuideSlot = (typeof documentGuideSlots)[number]["id"];
