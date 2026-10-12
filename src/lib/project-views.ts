import {
  parseFilters,
  serializeFilters,
  type BoardFilters,
} from "./board-filters";

export type TaskView = "board" | "list" | "gantt";
export type TaskSort = "default" | "due" | "priority" | "title";
export function sortTasks<
  T extends {
    id: string;
    title: string;
    dueDate: string | null;
    priority: string;
  },
>(tasks: T[], sort: TaskSort): T[] {
  if (sort === "default") return tasks;
  const rank: Record<string, number> = { high: 0, medium: 1, low: 2 };
  return [...tasks].sort((a, b) => {
    const result =
      sort === "due"
        ? (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999")
        : sort === "priority"
          ? (rank[a.priority] ?? 3) - (rank[b.priority] ?? 3)
          : a.title.localeCompare(b.title, "zh-CN");
    return result || a.id.localeCompare(b.id);
  });
}
export const VIEW_LABELS: Record<TaskView, string> = {
  board: "看板",
  list: "列表",
  gantt: "甘特图",
};
export function parseTaskView(value: string | null): TaskView {
  return value === "list" || value === "gantt" ? value : "board";
}
export function parseTaskSort(value: string | null): TaskSort {
  return value === "due" || value === "priority" || value === "title"
    ? value
    : "default";
}
export function replaceProjectFilters(
  current: URLSearchParams,
  filters: BoardFilters,
): URLSearchParams {
  const next = new URLSearchParams(current);
  for (const key of [
    "assignee",
    "priority",
    "label",
    "milestone",
    "overdue",
    "group",
  ])
    next.delete(key);
  new URLSearchParams(serializeFilters(filters)).forEach((value, key) =>
    next.set(key, value),
  );
  return next;
}
// Saved preferences contain presentation settings only, never task contents or an open task id.
export function savedViewQuery(current: URLSearchParams): string {
  const next = new URLSearchParams(serializeFilters(parseFilters(current)));
  const view = parseTaskView(current.get("view"));
  const sort = parseTaskSort(current.get("sort"));
  if (view !== "board") next.set("view", view);
  if (sort !== "default") next.set("sort", sort);
  return next.toString();
}
export function applySavedView(
  current: URLSearchParams,
  query: string,
): URLSearchParams {
  const saved = new URLSearchParams(savedViewQuery(new URLSearchParams(query)));
  const next = replaceProjectFilters(current, parseFilters(saved));
  for (const key of ["view", "sort"]) {
    next.delete(key);
    const value = saved.get(key);
    if (value) next.set(key, value);
  }
  return next;
}
export type SavedProjectView = { id: string; name: string; query: string };
export const MAX_SAVED_VIEWS = 12;
export function savedViewsStorageKey(
  userId: string,
  projectId: string,
): string {
  return `agilecampus:project-views:v1:${userId}:${projectId}`;
}
export function readSavedViews(raw: string): SavedProjectView[] {
  try {
    if (raw.length > 65536) return [];
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return [];
    const ids = new Set<string>();
    return value
      .filter((item): item is SavedProjectView => {
        if (!item || typeof item !== "object") return false;
        const { id, name, query } = item;
        if (
          typeof id !== "string" ||
          !/^[\w-]{1,64}$/.test(id) ||
          ids.has(id) ||
          typeof name !== "string" ||
          !name.trim() ||
          name.length > 30 ||
          typeof query !== "string" ||
          query.length > 4096
        )
          return false;
        ids.add(id);
        return true;
      })
      .slice(0, MAX_SAVED_VIEWS)
      .map((item) => ({
        ...item,
        name: item.name.trim(),
        query: savedViewQuery(new URLSearchParams(item.query)),
      }));
  } catch {
    return [];
  }
}
