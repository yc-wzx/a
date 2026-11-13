import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db";
import { projects, tasks, teamMembers, users } from "@/db/schema";
import { createTeam, joinTeam, updateMemberRole } from "@/lib/team";
import { createProject } from "@/lib/project";
import { createTask, createSubtask, updateTask } from "@/lib/task";
import { assignTasks, bulkUpdateTasks, createIteration, getIterationDetail } from "@/lib/iteration";
import { emptyTaskDraft, hasTaskDraft, readTaskDraft, taskDraftKey } from "@/lib/task-creation-draft";
import { resetDb } from "./helpers";

async function scene() {
  const [admin, student, teacher, outsider] = await db.insert(users).values(
    ["admin", "student", "teacher", "outsider"].map(name => ({ name, email: `${name}@bulk.test`, passwordHash: "fixture" })),
  ).returning();
  const team = await createTeam(admin.id, "课程测试");
  for (const user of [student, teacher]) await joinTeam(user.id, team.inviteCode);
  await updateMemberRole(admin.id, team.id, teacher.id, "teacher");
  const project = await createProject(admin.id, team.id, { name: "课程项目" });
  const first = await createTask(student.id, project.id, { title: "整理需求", startDate: "2026-11-15" });
  const second = await createTask(student.id, project.id, { title: "交互原型", startDate: "2026-11-20" });
  return { admin, student, teacher, outsider, team, project, first, second };
}
const ref = (task: { id: string; updatedAt: Date }) => ({ taskId: task.id, expectedUpdatedAt: task.updatedAt.toISOString() });

describe("批量任务修改", () => {
  beforeEach(resetDb);

  it("一次修改多项日期和优先级，重试返回同一结果", async () => {
    const s = await scene();
    const input = { requestId: randomUUID(), tasks: [ref(s.first), ref(s.second)], patch: { dueDate: "2026-11-25", priority: "high" as const } };
    const result = await bulkUpdateTasks(s.student.id, s.project.id, input);
    expect(result.taskIds.sort()).toEqual([s.first.id, s.second.id].sort());
    expect(await bulkUpdateTasks(s.student.id, s.project.id, input)).toEqual(result);
    expect((await db.select().from(tasks)).every(task => task.priority === "high" && task.dueDate === "2026-11-25")).toBe(true);
    await expect(bulkUpdateTasks(s.student.id, s.project.id, { ...input, patch: { priority: "low" } })).rejects.toThrow("同一请求标识");
  });

  it("任一任务日期无效，整批回滚", async () => {
    const s = await scene();
    await expect(bulkUpdateTasks(s.student.id, s.project.id, {
      requestId: randomUUID(), tasks: [ref(s.first), ref(s.second)], patch: { priority: "high", dueDate: "2026-11-18" },
    })).rejects.toThrow("开始日期不能晚于截止日期");
    expect((await db.select().from(tasks)).every(task => task.priority === "medium" && !task.dueDate)).toBe(true);
  });

  it("过期版本、跨项目任务和重复选择均不能部分写入", async () => {
    const s = await scene();
    await updateTask(s.student.id, s.second.id, { title: "已更新原型" });
    const input = { requestId: randomUUID(), tasks: [ref(s.first), ref(s.second)], patch: { priority: "high" as const } };
    await expect(bulkUpdateTasks(s.student.id, s.project.id, input)).rejects.toThrow("已被修改");
    const other = await createProject(s.admin.id, s.team.id, { name: "另一个项目" });
    const foreign = await createTask(s.student.id, other.id, { title: "外部任务" });
    await expect(bulkUpdateTasks(s.student.id, s.project.id, { ...input, tasks: [ref(s.first), ref(foreign)] })).rejects.toThrow("不属于该项目");
    await expect(bulkUpdateTasks(s.student.id, s.project.id, { ...input, tasks: [ref(s.first), ref(s.first)] })).rejects.toThrow("不能重复");
    expect((await db.select().from(tasks).where(eq(tasks.id, s.first.id)))[0].priority).toBe("medium");
  });

  it("日期与跨迭代移动共同提交，重试不再次移动", async () => {
    const s = await scene();
    const source = await createIteration(s.student.id, s.project.id, { requestId: randomUUID(), name: "需求轮", startDate: "2026-11-10", endDate: "2026-11-15" });
    const target = await createIteration(s.student.id, s.project.id, { requestId: randomUUID(), name: "实现轮", startDate: "2026-11-16", endDate: "2026-11-30" });
    const assigned = await assignTasks(s.student.id, s.project.id, source.id, { requestId: randomUUID(), expectedRevision: source.revision, tasks: [ref(s.first)] });
    const current = (await db.select().from(tasks).where(eq(tasks.id, s.first.id)))[0];
    const input = { requestId: randomUUID(), tasks: [ref(current), ref(s.second)], patch: { dueDate: "2026-11-25" },
      iteration: { id: target.id, versions: [{ id: source.id, revision: assigned.iteration.revision }, { id: target.id, revision: target.revision }] } };
    const result = await bulkUpdateTasks(s.student.id, s.project.id, input);
    expect(await bulkUpdateTasks(s.student.id, s.project.id, input)).toEqual(result);
    expect((await db.select().from(tasks)).every(task => task.sprintId === target.id && task.dueDate === "2026-11-25")).toBe(true);
    expect((await getIterationDetail(s.student.id, s.project.id, target.id)).iteration.revision).toBe(target.revision + 1);
  });

  it("子任务调整迭代失败时，优先级也回滚", async () => {
    const s = await scene();
    const subtask = await createSubtask(s.student.id, s.first.id, { title: "访谈整理" });
    await expect(bulkUpdateTasks(s.student.id, s.project.id, { requestId: randomUUID(), tasks: [ref(s.first), ref(subtask)],
      patch: { priority: "high" }, iteration: { id: null, versions: [] } })).rejects.toThrow("子任务跟随主任务");
    expect((await db.select().from(tasks).where(eq(tasks.id, s.first.id)))[0].priority).toBe("medium");
  });

  it("教师、外部用户、退出成员和归档项目不能写入或重放", async () => {
    const s = await scene();
    const input = { requestId: randomUUID(), tasks: [ref(s.first)], patch: { priority: "high" as const } };
    for (const user of [s.teacher, s.outsider]) await expect(bulkUpdateTasks(user.id, s.project.id, input)).rejects.toThrow();
    await bulkUpdateTasks(s.student.id, s.project.id, input);
    await db.delete(teamMembers).where(eq(teamMembers.userId, s.student.id));
    await expect(bulkUpdateTasks(s.student.id, s.project.id, input)).rejects.toThrow();
    await db.update(projects).set({ status: "archived" }).where(eq(projects.id, s.project.id));
    await expect(bulkUpdateTasks(s.admin.id, s.project.id, input)).rejects.toThrow("归档");
  });

  it("并发修改同一版本时只有一批成功", async () => {
    const s = await scene();
    const results = await Promise.allSettled(["low", "high"].map(priority => bulkUpdateTasks(s.student.id, s.project.id, {
      requestId: randomUUID(), tasks: [ref(s.first), ref(s.second)], patch: { priority: priority as "low" | "high" },
    })));
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    const rows = await db.select().from(tasks);
    expect(rows[0].priority).toBe(rows[1].priority);
  });
});

describe("浏览器任务草稿", () => {
  it("草稿按用户和项目隔离，保留重试标识和多成员", () => {
    const draft = { ...emptyTaskDraft(), title: "整理需求", assigneeIds: [randomUUID()] };
    expect(readTaskDraft(JSON.stringify(draft))).toEqual(draft);
    expect(hasTaskDraft(draft)).toBe(true);
    expect(hasTaskDraft(emptyTaskDraft())).toBe(false);
    expect(taskDraftKey("甲", "项目一")).not.toBe(taskDraftKey("乙", "项目一"));
    expect(taskDraftKey("甲", "项目一")).not.toBe(taskDraftKey("甲", "项目二"));
    expect(readTaskDraft("{invalid")).toBeNull();
    expect(readTaskDraft(JSON.stringify({ ...draft, startDate: "2026-02-30" }))).toBeNull();
  });
});
