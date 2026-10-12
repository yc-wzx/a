import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db";
import { notifications, projects, teamMembers, users } from "@/db/schema";
import { taskMaterialLinks, taskWatchers } from "@/db/task-enhancements-schema";
import { createProject } from "@/lib/project";
import { createTeam, joinTeam, updateMemberRole } from "@/lib/team";
import { createTask, createSubtask, updateTask } from "@/lib/task";
import { setTaskBlocked } from "@/lib/task-contract";
import { createProjectReference } from "@/lib/project-extras";
import { createDeliverableDraft, submitDeliverable } from "@/lib/deliverable";
import { addChecklistItem, deleteChecklistItem, getProjectDoingLimit, getTaskEnhancements, linkTaskMaterial, setProjectDoingLimit, setTaskWatching, unlinkTaskMaterial, updateChecklistItem } from "@/lib/task-enhancements";
import { resetDb } from "./helpers";

async function scene() {
  const [admin, student, peer, teacher, outsider] = await db.insert(users).values(["admin", "student", "peer", "teacher", "outsider"].map((name) => ({ name, email: `${name}@enhancements.test`, passwordHash: "fixture" }))).returning();
  const team = await createTeam(admin.id, "轻量敏捷任务测试");
  for (const user of [student, peer, teacher]) await joinTeam(user.id, team.inviteCode);
  await updateMemberRole(admin.id, team.id, teacher.id, "teacher");
  const project = await createProject(admin.id, team.id, { name: "课程项目" });
  const other = await createProject(admin.id, team.id, { name: "另一个项目" });
  const task = await createTask(student.id, project.id, { title: "完成交互原型" });
  return { admin, student, peer, teacher, outsider, team, project, other, task };
}

describe("lightweight task enhancements: real PostgreSQL", () => {
  beforeEach(resetDb);

  it("checklist create/update/delete is idempotent, revision protected and does not change task completion", async () => {
    const s = await scene();
    const input = { requestId: randomUUID(), text: "正常流程已测试" };
    const first = await addChecklistItem(s.student.id, s.project.id, s.task.id, input);
    expect(await addChecklistItem(s.student.id, s.project.id, s.task.id, input)).toEqual(first);
    await expect(addChecklistItem(s.student.id, s.project.id, s.task.id, { ...input, text: "另一个内容" })).rejects.toThrow("不同内容");
    const checked = await updateChecklistItem(s.peer.id, s.project.id, s.task.id, { requestId: randomUUID(), itemId: first.id, expectedRevision: first.revision, text: "正常与异常流程已测试", checked: true });
    expect(checked).toMatchObject({ checked: true, revision: 2 });
    await expect(updateChecklistItem(s.student.id, s.project.id, s.task.id, { requestId: randomUUID(), itemId: first.id, expectedRevision: 1, checked: false })).rejects.toThrow("已被修改");
    expect((await getTaskEnhancements(s.teacher.id, s.project.id, s.task.id)).checklist).toEqual([checked]);
    expect(s.task.status).toBe("todo");
    const del = { requestId: randomUUID(), itemId: first.id, expectedRevision: checked.revision };
    await deleteChecklistItem(s.student.id, s.project.id, s.task.id, del);
    await deleteChecklistItem(s.student.id, s.project.id, s.task.id, del);
    expect((await getTaskEnhancements(s.student.id, s.project.id, s.task.id)).checklist).toEqual([]);
  });

  it("rejects teacher checklist writes, outsiders, mismatched projects, and mutation replay after leaving", async () => {
    const s = await scene(); const input = { requestId: randomUUID(), text: "检查项" };
    await expect(addChecklistItem(s.teacher.id, s.project.id, s.task.id, input)).rejects.toThrow("没有权限");
    await expect(getTaskEnhancements(s.outsider.id, s.project.id, s.task.id)).rejects.toThrow("没有权限");
    await expect(addChecklistItem(s.student.id, s.other.id, s.task.id, input)).rejects.toThrow("任务不存在");
    await addChecklistItem(s.student.id, s.project.id, s.task.id, input);
    await db.delete(teamMembers).where(and(eq(teamMembers.teamId, s.team.id), eq(teamMembers.userId, s.student.id)));
    await expect(addChecklistItem(s.student.id, s.project.id, s.task.id, input)).rejects.toThrow("没有权限");
  });

  it("serializes conflicting checklist edits, validates limits and text", async () => {
    const s = await scene();
    await expect(addChecklistItem(s.student.id, s.project.id, s.task.id, { requestId: randomUUID(), text: "  " })).rejects.toThrow();
    const item = await addChecklistItem(s.student.id, s.project.id, s.task.id, { requestId: randomUUID(), text: "检查项" });
    const outcomes = await Promise.allSettled([true, false].map((checked) => updateChecklistItem(s.student.id, s.project.id, s.task.id, { requestId: randomUUID(), itemId: item.id, expectedRevision: 1, checked })));
    expect(outcomes.filter((o) => o.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.filter((o) => o.status === "rejected")).toHaveLength(1);
  });

  it("optional WIP limit counts full-project main tasks, administrators only, without blocking moves", async () => {
    const s = await scene();
    expect(await getProjectDoingLimit(s.student.id, s.project.id)).toMatchObject({ doingLimit: null, revision: 0, doingCount: 0, exceeded: false });
    await expect(setProjectDoingLimit(s.student.id, s.project.id, { requestId: randomUUID(), expectedRevision: 0, doingLimit: 1 })).rejects.toThrow("没有权限");
    const input = { requestId: randomUUID(), expectedRevision: 0, doingLimit: 1 };
    await setProjectDoingLimit(s.admin.id, s.project.id, input);
    await setProjectDoingLimit(s.admin.id, s.project.id, input);
    const second = await createTask(s.student.id, s.project.id, { title: "另一个主任务", assigneeId: s.peer.id });
    const sub = await createSubtask(s.student.id, s.task.id, { title: "子任务" });
    for (const task of [s.task, second, sub]) await updateTask(s.student.id, task.id, { status: "doing" });
    expect(await getProjectDoingLimit(s.teacher.id, s.project.id)).toMatchObject({ doingLimit: 1, revision: 1, doingCount: 2, exceeded: true, canManage: false });
    await expect(setProjectDoingLimit(s.admin.id, s.project.id, { requestId: randomUUID(), expectedRevision: 0, doingLimit: 2 })).rejects.toThrow("已被修改");
    expect(await setProjectDoingLimit(s.admin.id, s.project.id, { requestId: randomUUID(), expectedRevision: 1, doingLimit: null })).toMatchObject({ doingLimit: null, exceeded: false });
  });

  it("current students and teachers can watch/unwatch; status/completion/blocked notifications are deduplicated and omit actor", async () => {
    const s = await scene();
    for (const user of [s.student, s.peer, s.teacher]) await setTaskWatching(user.id, s.project.id, s.task.id, { requestId: randomUUID(), watching: true });
    expect((await getTaskEnhancements(s.teacher.id, s.project.id, s.task.id))).toMatchObject({ watching: true, watchCount: 3 });
    const doing = await updateTask(s.peer.id, s.task.id, { status: "doing" });
    let events = await db.select().from(notifications).where(eq(notifications.type, "task.status_changed"));
    expect(events.map((e) => e.recipientId).sort()).toEqual([s.student.id, s.teacher.id].sort());
    await setTaskBlocked(s.peer.id, s.project.id, s.task.id, { requestId: randomUUID(), expectedUpdatedAt: doing.updatedAt.toISOString(), isBlocked: true, blockedReason: "等待资料" });
    expect((await db.select().from(notifications).where(eq(notifications.type, "task.blocked")))).toHaveLength(2);
    await updateTask(s.peer.id, s.task.id, { status: "done" });
    events = await db.select().from(notifications).where(eq(notifications.type, "task.completed"));
    expect(events.map((e) => e.recipientId).sort()).toEqual([s.student.id, s.teacher.id].sort());
    // Creator is also watching but receives exactly one completion notification.
    expect(events.filter((e) => e.recipientId === s.student.id)).toHaveLength(1);
    await setTaskWatching(s.teacher.id, s.project.id, s.task.id, { requestId: randomUUID(), watching: false });
    expect((await getTaskEnhancements(s.teacher.id, s.project.id, s.task.id)).watching).toBe(false);
  });

  it("leavers are not counted or notified; no-op state updates do not notify watchers", async () => {
    const s = await scene();
    await setTaskWatching(s.teacher.id, s.project.id, s.task.id, { requestId: randomUUID(), watching: true });
    await db.delete(teamMembers).where(and(eq(teamMembers.teamId, s.team.id), eq(teamMembers.userId, s.teacher.id)));
    expect((await getTaskEnhancements(s.student.id, s.project.id, s.task.id)).watchCount).toBe(0);
    await updateTask(s.student.id, s.task.id, { status: "doing" });
    await updateTask(s.student.id, s.task.id, { status: "doing" });
    expect(await db.select().from(notifications).where(eq(notifications.recipientId, s.teacher.id))).toHaveLength(0);
    expect(await db.select().from(taskWatchers)).toHaveLength(1);
  });

  it("links project resources and submitted snapshots, excludes private drafts and rejects cross-project sources", async () => {
    const s = await scene();
    const reference = await createProjectReference(s.student.id, s.project.id, { requestId: randomUUID(), title: "项目原型", type: "prototype", url: "https://example.com/prototype" });
    const otherReference = await createProjectReference(s.student.id, s.other.id, { requestId: randomUUID(), title: "其他项目", type: "document", url: "https://example.com/other" });
    const draft = await createDeliverableDraft(s.student.id, s.project.id, { requestId: randomUUID(), title: "私有草稿", type: "report", url: "https://example.com/report" });
    expect((await getTaskEnhancements(s.peer.id, s.project.id, s.task.id)).materialOptions.some((o) => o.title.includes("私有草稿"))).toBe(false);
    await expect(linkTaskMaterial(s.student.id, s.project.id, s.task.id, { requestId: randomUUID(), kind: "deliverable", sourceId: draft.id })).rejects.toThrow("正式成果版本");
    await expect(linkTaskMaterial(s.student.id, s.project.id, s.task.id, { requestId: randomUUID(), kind: "resource", sourceId: otherReference.id })).rejects.toThrow("不属于");
    const submitted = await submitDeliverable(s.student.id, s.project.id, draft.id, { requestId: randomUUID(), expectedRevision: draft.revision });
    const input = { requestId: randomUUID(), kind: "resource" as const, sourceId: reference.id };
    const link = await linkTaskMaterial(s.student.id, s.project.id, s.task.id, input);
    expect(await linkTaskMaterial(s.student.id, s.project.id, s.task.id, input)).toEqual(link);
    await linkTaskMaterial(s.student.id, s.project.id, s.task.id, { ...input, requestId: randomUUID() });
    await linkTaskMaterial(s.peer.id, s.project.id, s.task.id, { requestId: randomUUID(), kind: "deliverable", sourceId: submitted.versionId });
    expect(await db.select().from(taskMaterialLinks)).toHaveLength(2);
    const data = await getTaskEnhancements(s.teacher.id, s.project.id, s.task.id);
    expect(data.materials.map((m) => m.kind).sort()).toEqual(["deliverable", "resource"]);
    expect(data.materials.find((m) => m.kind === "deliverable")?.href).toContain(`versionId=${submitted.versionId}`);
    await expect(unlinkTaskMaterial(s.teacher.id, s.project.id, s.task.id, { requestId: randomUUID(), linkId: link.id, expectedRevision: 1 })).rejects.toThrow("没有权限");
    await unlinkTaskMaterial(s.student.id, s.project.id, s.task.id, { requestId: randomUUID(), linkId: link.id, expectedRevision: 1 });
    expect((await getTaskEnhancements(s.student.id, s.project.id, s.task.id)).materials).toHaveLength(1);
  });

  it("archived projects are readable but all enhancement mutations are rejected", async () => {
    const s = await scene(); const input = { requestId: randomUUID(), text: "检查项" };
    await addChecklistItem(s.student.id, s.project.id, s.task.id, input);
    await db.update(projects).set({ status: "archived" }).where(eq(projects.id, s.project.id));
    expect(await getTaskEnhancements(s.student.id, s.project.id, s.task.id)).toMatchObject({ canWrite: false, canWatch: false });
    await expect(addChecklistItem(s.student.id, s.project.id, s.task.id, input)).rejects.toThrow("归档");
    await expect(setTaskWatching(s.teacher.id, s.project.id, s.task.id, { requestId: randomUUID(), watching: true })).rejects.toThrow("归档");
    await expect(setProjectDoingLimit(s.admin.id, s.project.id, { requestId: randomUUID(), expectedRevision: 0, doingLimit: 2 })).rejects.toThrow("归档");
  });
});
