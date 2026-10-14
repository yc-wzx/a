import { describe, expect, it } from "vitest";
import {
  taskPreviewHref, taskPreviewTarget, taskTargetFromHref, withoutTaskPreview,
} from "@/lib/task-navigation";

const projectId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const taskId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const target = { projectId, taskId };
const read = (href: string) => {
  const url = new URL(href, "https://example.invalid");
  return taskPreviewTarget(url.pathname, url.searchParams);
};

describe("task previews preserve the originating page", () => {
  it("opens a workspace task without losing pagination and scroll anchor", () => {
    const href = taskPreviewHref("/dashboard?revisionsOffset=50#tasks", target);
    const url = new URL(href, "https://example.invalid");
    expect(url.pathname).toBe("/dashboard");
    expect(url.searchParams.get("revisionsOffset")).toBe("50");
    expect(url.hash).toBe("#tasks");
    expect(read(href)).toEqual(target);
    expect(withoutTaskPreview(href)).toBe("/dashboard?revisionsOffset=50#tasks");
  });

  it("retains the member profile's team, task filters and page", () => {
    const source = `/people/${taskId}?team=${projectId}&tab=tasks&filter=overdue&page=2`;
    const href = taskPreviewHref(source, target);
    expect(read(href)).toEqual(target);
    expect(withoutTaskPreview(href)).toBe(source);
  });

  it("keeps canonical project deep links and board settings", () => {
    const source = `/projects/${projectId}?view=gantt&assignee=${taskId}&sort=due`;
    const href = taskPreviewHref(source, target);
    const url = new URL(href, "https://example.invalid");
    expect(url.searchParams.has("taskProject")).toBe(false);
    expect(read(href)).toEqual(target);
    expect(withoutTaskPreview(href)).toBe(source);
    expect(taskTargetFromHref(`/projects/${projectId}?task=${taskId}`)).toEqual(target);
  });

  it("previews another project's task without redirecting the current page", () => {
    const another = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    const href = taskPreviewHref(`/projects/${another}?view=list`, target);
    expect(new URL(href, "https://example.invalid").pathname).toBe(`/projects/${another}`);
    expect(read(href)).toEqual(target);
    expect(withoutTaskPreview(href)).toBe(`/projects/${another}?view=list`);
  });

  it("requires an explicit project outside the project's task page", () => {
    expect(read(`/dashboard?task=${taskId}`)).toBeNull();
    expect(read(`/projects/${projectId}/documents?task=${taskId}`)).toBeNull();
    expect(read(`/dashboard?task=${taskId}&taskProject=${projectId}`)).toEqual(target);
  });

  it("ignores malformed targets and ordinary project navigation", () => {
    for (const href of [
      `/projects/invalid?task=${taskId}`, `/projects/${projectId}?task=invalid`,
      `/dashboard?task=${taskId}&taskProject=invalid`,
      `/projects/${projectId}/overview`, `/projects/${projectId}`,
    ]) expect(taskTargetFromHref(href)).toBeNull();
  });

  it("does not intercept external links", () => {
    expect(taskTargetFromHref(`https://example.invalid/projects/${projectId}?task=${taskId}`)).toBeNull();
    expect(taskTargetFromHref(`//example.invalid/projects/${projectId}?task=${taskId}`)).toBeNull();
    expect(taskTargetFromHref(`/\\example.invalid/projects/${projectId}?task=${taskId}`)).toBeNull();
  });
});
