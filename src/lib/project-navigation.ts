export const PROJECT_NAV_GROUPS = [
  {
    label: "项目",
    collapsible: false,
    items: [
      { key: "overview", label: "概览", suffix: "/overview", icon: "overview" },
      { key: "tasks", label: "任务", suffix: "", icon: "tasks" },
      {
        key: "iterations",
        label: "迭代",
        suffix: "/iterations",
        icon: "iterations",
      },
      {
        key: "timeline",
        label: "时间线",
        suffix: "/timeline",
        icon: "timeline",
      },
    ],
  },
  {
    label: "协作",
    collapsible: true,
    items: [
      { key: "documents", label: "项目文档", suffix: "/documents", icon: "documents" },
      {
        key: "announcements",
        label: "公告",
        suffix: "/announcements",
        icon: "announcements",
      },
      {
        key: "references",
        label: "会议与资料",
        suffix: "/references",
        icon: "references",
      },
      { key: "ai", label: "我的项目助手", suffix: "/ai-drafts", icon: "ai" },
    ],
  },
  {
    label: "成果与记录",
    collapsible: true,
    items: [
      {
        key: "deliverables",
        label: "成果",
        suffix: "/deliverables",
        icon: "deliverables",
      },
      { key: "reports", label: "周报", suffix: "/reports", icon: "reports" },
      {
        key: "evidence",
        label: "过程证据",
        suffix: "/evidence/process",
        icon: "evidence",
      },
    ],
  },
] as const;
export type ProjectNavKey =
  (typeof PROJECT_NAV_GROUPS)[number]["items"][number]["key"];
export function currentProjectSection(
  pathname: string,
  projectId: string,
): ProjectNavKey | null {
  const base = `/projects/${projectId}`;
  if (pathname === base) return "tasks";
  if (pathname === `${base}/personal-plan`) return "ai";
  if (pathname === `${base}/evidence`) return "evidence";
  const item = PROJECT_NAV_GROUPS.flatMap((group) => [...group.items]).find(
    (item) =>
      item.suffix &&
      (pathname === base + item.suffix ||
        pathname.startsWith(base + item.suffix + "/")),
  );
  return item?.key ?? null;
}
