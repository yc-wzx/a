import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { tasks, users } from "@/db/schema";
import { createTeam, joinTeam, updateMemberRole } from "@/lib/team";
import { createProject, updateProject } from "@/lib/project";
import { createLabel, setTaskLabels } from "@/lib/label";
import { createTask, setTaskSuccessors } from "@/lib/task";
import { getTaskPanelData, updateTaskV1 } from "@/lib/task-contract";
import { saveTaskAssociations } from "@/lib/task-associations";
import { saveTaskAssociationsAction } from "@/app/(app)/projects/[projectId]/tasks/association-actions";
import { resetDb } from "./helpers";
const auth = vi.hoisted(() => vi.fn());
vi.mock("@/lib/auth", () => ({ auth }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
async function scene() {
  const [admin, student, teacher, outsider] = await db.insert(users).values(["admin", "student", "teacher", "outsider"].map(name => ({ name, email: name+"@association.test", passwordHash: "fixture" }))).returning();
  const team = await createTeam(admin.id, "关联回归团队");
  for (const member of [student, teacher]) await joinTeam(member.id, team.inviteCode);
  await updateMemberRole(admin.id, team.id, teacher.id, "teacher");
  const project = await createProject(admin.id, team.id, { name: "关联回归" });
  const a = await createTask(student.id, project.id, { title: "原任务", description: "原描述", assigneeId: student.id, priority: "high", startDate: "2026-10-14", dueDate: "2026-10-20" });
  const b = await createTask(student.id, project.id, { title: "后置任务" });
  const label = await createLabel(admin.id, team.id, { name: "交互", color: "blue" });
  const input = { requestId: randomUUID(), expectedUpdatedAt: a.updatedAt.toISOString(), labelIds: [label.id], successorIds: [b.id] };
  auth.mockResolvedValue({ user: { id: student.id } });
  return { admin, student, teacher, outsider, team, project, a, b, label, input };
}
beforeEach(async () => { await resetDb(); auth.mockReset(); });
describe("task association saves", () => {
  it("persists labels and successors without clearing ordinary fields", async () => {
    const s = await scene();
    const result = await saveTaskAssociationsAction(s.project.id, s.a.id, s.input);
    expect(result.ok).toBe(true);
    const panel = await getTaskPanelData(s.student.id, s.project.id, s.a.id);
    expect(panel.labels.map(l => l.id)).toEqual([s.label.id]);
    expect(panel.dependencies).toContainEqual({ predecessorId: s.a.id, successorId: s.b.id });
    const [after] = await db.select().from(tasks).where(eq(tasks.id, s.a.id));
    expect({ ...after, updatedAt: s.a.updatedAt }).toEqual(s.a);
  });
  it("allows a second save to clear associations and advances the version", async () => {
    const s = await scene();
    const first = await saveTaskAssociations(s.student.id, s.project.id, s.a.id, s.input);
    const second = await saveTaskAssociations(s.student.id, s.project.id, s.a.id, { requestId: randomUUID(), expectedUpdatedAt: first.updatedAt, labelIds: [], successorIds: [] });
    expect(second.updatedAt).not.toBe(first.updatedAt);
    const panel = await getTaskPanelData(s.student.id, s.project.id, s.a.id);
    expect(panel.labels).toEqual([]); expect(panel.dependencies).toEqual([]);
  });
  it("replays a lost response without applying another write", async () => {
    const s = await scene();
    const first = await saveTaskAssociations(s.student.id, s.project.id, s.a.id, s.input);
    expect(await saveTaskAssociations(s.student.id, s.project.id, s.a.id, s.input)).toEqual(first);
    await expect(saveTaskAssociations(s.student.id, s.project.id, s.a.id, { ...s.input, labelIds: [] })).rejects.toThrow("同一请求标识");
  });
  it("rolls back label changes when a successor is invalid", async () => {
    const s = await scene();
    await setTaskLabels(s.student.id, s.a.id, [s.label.id]);
    await setTaskSuccessors(s.student.id, s.a.id, [s.b.id]);
    await expect(saveTaskAssociations(s.student.id, s.project.id, s.a.id, { ...s.input, labelIds: [], successorIds: [s.a.id] })).rejects.toThrow("循环");
    const panel = await getTaskPanelData(s.student.id, s.project.id, s.a.id);
    expect(panel.labels.map(l => l.id)).toEqual([s.label.id]); expect(panel.dependencies).toHaveLength(1);
    expect(panel.task.updatedAt).toBe(s.input.expectedUpdatedAt);
  });
  it("rejects stale versions instead of overwriting another edit", async () => {
    const s = await scene();
    await updateTaskV1(s.student.id, s.project.id, s.a.id, { requestId: randomUUID(), expectedUpdatedAt: s.input.expectedUpdatedAt, patch: { title: "其他成员更新" } });
    expect(await saveTaskAssociationsAction(s.project.id, s.a.id, s.input)).toMatchObject({ ok: false, code: "CONFLICT" });
    const panel = await getTaskPanelData(s.student.id, s.project.id, s.a.id);
    expect(panel.task.title).toBe("其他成员更新"); expect(panel.labels).toEqual([]);
  });
  it("rejects teachers, outsiders, other-project task IDs and archived projects", async () => {
    const s = await scene();
    for (const actor of [s.teacher, s.outsider]) await expect(saveTaskAssociations(actor.id, s.project.id, s.a.id, s.input)).rejects.toThrow("没有权限");
    const other = await createProject(s.admin.id, s.team.id, { name: "另一项目" });
    await expect(saveTaskAssociations(s.student.id, other.id, s.a.id, s.input)).rejects.toThrow("无权访问");
    await updateProject(s.admin.id, s.project.id, { status: "archived" });
    await expect(saveTaskAssociations(s.student.id, s.project.id, s.a.id, s.input)).rejects.toThrow("已归档");
  });
  it("rejects cross-team labels without modifying either association set", async () => {
    const s = await scene();
    const otherTeam = await createTeam(s.admin.id, "其他团队");
    const foreign = await createLabel(s.admin.id, otherTeam.id, { name: "私有标签", color: "blue" });
    await expect(saveTaskAssociations(s.student.id, s.project.id, s.a.id, { ...s.input, labelIds: [foreign.id] })).rejects.toThrow("标签不属于");
    expect((await getTaskPanelData(s.student.id, s.project.id, s.a.id)).dependencies).toEqual([]);
  });
  it("does not let simultaneous opposite links create a direct cycle", async () => {
    const s = await scene();
    const results = await Promise.allSettled([
      saveTaskAssociations(s.student.id, s.project.id, s.a.id, s.input),
      saveTaskAssociations(s.student.id, s.project.id, s.b.id, { ...s.input, requestId: randomUUID(), expectedUpdatedAt: s.b.updatedAt.toISOString(), successorIds: [s.a.id] }),
    ]);
    expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
  });
  it("uses the frozen action errors for invalid input and an absent session", async () => {
    const s = await scene();
    expect(await saveTaskAssociationsAction(s.project.id, s.a.id, { ...s.input, expectedUpdatedAt: "invalid" })).toMatchObject({ ok: false, code: "VALIDATION" });
    auth.mockResolvedValue(null);
    expect(await saveTaskAssociationsAction(s.project.id, s.a.id, s.input)).toMatchObject({ ok: false, code: "UNAUTHENTICATED" });
  });
});
