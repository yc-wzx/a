import { describe, it, expect } from "vitest";
import {
  applySavedView,
  parseTaskView,
  readSavedViews,
  replaceProjectFilters,
  savedViewQuery,
  savedViewsStorageKey,
  sortTasks,
} from "@/lib/project-views";
import { EMPTY_FILTERS } from "@/lib/board-filters";
import {
  summarizeMemberWorkload,
  type WorkloadTask,
} from "@/lib/project-workload";
import { currentProjectSection } from "@/lib/project-navigation";

const member = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
describe("项目视图与本机筛选", () => {
  it("修改和清空筛选保留当前任务、视图和排序", () => {
    const query = new URLSearchParams(
      `view=gantt&task=${member}&sort=due&priority=high`,
    );
    const changed = replaceProjectFilters(query, {
      ...EMPTY_FILTERS,
      assignee: [member],
      overdue: true,
    });
    expect(changed.get("task")).toBe(member);
    expect(changed.get("view")).toBe("gantt");
    expect(changed.has("priority")).toBe(false);
    expect(replaceProjectFilters(changed, EMPTY_FILTERS).get("task")).toBe(
      member,
    );
  });
  it("保存只包含筛选及展示设置；应用时替换旧筛选但保留打开的任务", () => {
    const query = savedViewQuery(
      new URLSearchParams(
        `task=${member}&secret=example&view=list&group=assignee&sort=due&overdue=1`,
      ),
    );
    expect(query).not.toContain("task");
    expect(query).not.toContain("secret");
    const applied = applySavedView(
      new URLSearchParams(`task=${member}&priority=high&view=gantt`),
      query,
    );
    expect(applied.get("task")).toBe(member);
    expect(applied.get("view")).toBe("list");
    expect(applied.get("sort")).toBe("due");
    expect(applied.has("priority")).toBe(false);
    expect(applySavedView(applied, "").has("view")).toBe(false);
  });
  it("账号和项目隔离，损坏的存储不会影响页面，导入值只按白名单处理", () => {
    expect(savedViewsStorageKey("a", "p")).not.toBe(
      savedViewsStorageKey("b", "p"),
    );
    expect(savedViewsStorageKey("a", "p")).not.toBe(
      savedViewsStorageKey("a", "q"),
    );
    expect(readSavedViews("broken")).toEqual([]);
    expect(readSavedViews(JSON.stringify({ query: "" }))).toEqual([]);
    const values = readSavedViews(
      JSON.stringify([
        {
          id: "one",
          name: "我的任务",
          query: "view=unknown&overdue=1&token=SECRET",
        },
        { id: "one", name: "重复", query: "" },
        { id: "bad", name: "", query: "" },
      ]),
    );
    expect(values).toEqual([
      { id: "one", name: "我的任务", query: "overdue=1" },
    ]);
    expect(readSavedViews("x".repeat(65537))).toEqual([]);
    expect(parseTaskView("malicious")).toBe("board");
  });
  it("稳定排序，无截止日期排在末尾且不修改原任务集合", () => {
    const tasks = [
      { id: "b", title: "第二", dueDate: null, priority: "low" },
      { id: "c", title: "第三", dueDate: "2026-10-12", priority: "medium" },
      { id: "a", title: "第一", dueDate: "2026-10-12", priority: "high" },
    ];
    expect(sortTasks(tasks, "due").map((t) => t.id)).toEqual(["a", "c", "b"]);
    expect(sortTasks(tasks, "priority").map((t) => t.id)).toEqual([
      "a",
      "c",
      "b",
    ]);
    expect(tasks.map((t) => t.id)).toEqual(["b", "c", "a"]);
  });
});
describe("成员工作量", () => {
  const task = (
    id: string,
    overrides: Partial<WorkloadTask> = {},
  ): WorkloadTask => ({
    id,
    title: id,
    assigneeId: member,
    assigneeName: "成员",
    status: "todo",
    priority: "medium",
    dueDate: "2026-10-12",
    parentTaskId: null,
    ...overrides,
  });
  it("主子任务分别计一次、已完成不逾期、今日截止未逾期、未指派独立", () => {
    const rows = summarizeMemberWorkload(
      [
        { id: member, name: "成员" },
        { id: "teacher", name: "老师" },
      ],
      [
        task("parent", { dueDate: "2026-10-10" }),
        task("child", { parentTaskId: "parent" }),
        task("done", { status: "done", dueDate: "2026-10-09" }),
        task("unassigned", { assigneeId: null, dueDate: null }),
        task("former", { assigneeId: "former-id", assigneeName: "离开成员" }),
      ],
      "2026-10-12",
    );
    expect(rows[0]).toMatchObject({ total: 3, open: 2, done: 1, overdue: 1 });
    expect(rows[0].urgent.map((t) => t.id)).toEqual(["parent", "child"]);
    expect(rows[1]).toMatchObject({ total: 0, urgent: [] });
    expect(rows.find((r) => r.id === "none")).toMatchObject({
      name: "未指派",
      open: 1,
    });
    expect(rows.reduce((n, r) => n + r.total, 0)).toBe(5);
  });
  it("空项目没有捏造任务", () =>
    expect(summarizeMemberWorkload([], [], "2026-10-12")).toEqual([]));
});
describe("分组导航", () => {
  it("子页面归到所属分区，跨项目和相似前缀不误亮", () => {
    expect(
      currentProjectSection(`/projects/${member}/deliverables/abc`, member),
    ).toBe("deliverables");
    expect(currentProjectSection(`/projects/${member}`, member)).toBe("tasks");
    expect(
      currentProjectSection(`/projects/${member}/evidence/process`, member),
    ).toBe("evidence");
    expect(currentProjectSection(`/projects/${member}/evidence`, member)).toBe(
      "evidence",
    );
    expect(
      currentProjectSection(`/projects/${member}/personal-plan`, member),
    ).toBe("ai");
    expect(
      currentProjectSection(`/projects/${member}/reports-fake`, member),
    ).toBeNull();
    expect(
      currentProjectSection("/projects/another/overview", member),
    ).toBeNull();
  });
});
