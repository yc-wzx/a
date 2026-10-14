import { z } from "zod";

export type TaskTarget = { projectId: string; taskId: string };
const base = "https://agilecampus.invalid";

function projectFromPath(pathname: string): string | null {
  const match = /^\/projects\/([^/]+)\/?$/.exec(pathname);
  return match && z.uuid().safeParse(match[1]).success ? match[1] : null;
}

export function taskPreviewTarget(
  pathname: string,
  search: URLSearchParams,
): TaskTarget | null {
  const projectId = search.get("taskProject") ?? projectFromPath(pathname);
  const taskId = search.get("task");
  if (!z.uuid().safeParse(projectId).success || !z.uuid().safeParse(taskId).success)
    return null;
  return { projectId: projectId!, taskId: taskId! };
}

export function taskTargetFromHref(href: string): TaskTarget | null {
  if (!href.startsWith("/") || href.startsWith("//")) return null;
  const url = new URL(href, base);
  if (url.origin !== base) return null;
  return taskPreviewTarget(url.pathname, url.searchParams);
}

export function taskPreviewHref(source: string, target: TaskTarget): string {
  const url = new URL(source, base);
  url.searchParams.set("task", target.taskId);
  if (projectFromPath(url.pathname) === target.projectId)
    url.searchParams.delete("taskProject");
  else url.searchParams.set("taskProject", target.projectId);
  return url.pathname + url.search + url.hash;
}

export function withoutTaskPreview(source: string): string {
  const url = new URL(source, base);
  url.searchParams.delete("task");
  url.searchParams.delete("taskProject");
  return url.pathname + url.search + url.hash;
}

export function openTaskPreview(href: string): boolean {
  if (typeof window === "undefined") return false;
  const target = taskTargetFromHref(href);
  if (!target) return false;
  const next = taskPreviewHref(window.location.href, target);
  const current = window.location.pathname + window.location.search + window.location.hash;
  if (next !== current)
    window.history.pushState({ agileCampusTaskPreview: true }, "", next);
  return true;
}

export function closeTaskPreview() {
  if (window.history.state?.agileCampusTaskPreview === true)
    window.history.back();
  else
    window.history.replaceState(null, "", withoutTaskPreview(window.location.href));
}
