import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { collaborationReactions, projects, tasks, users } from "@/db/schema";
import { projectDocuments } from "@/db/documents-schema";
import { createTeam, getTeamMembership, joinTeam, removeTeamMember, updateMemberRole } from "@/lib/team";
import { createMilestone, createProject, getProjectForUser, projectVersion, updateProject } from "@/lib/project";
import { deleteArchivedProject, previewProjectDeletion } from "@/lib/project-management";
import { createTask } from "@/lib/task";
import { createIteration, createTaskWithIteration } from "@/lib/iteration";
import { createDocument } from "@/lib/documents";
import { createTaskComment } from "@/lib/comments";
import { createDeliverableDraft, listProjectDeliverables } from "@/lib/deliverable";
import { publishAnnouncement } from "@/lib/announcements";
import { resetDb } from "./helpers";

async function scene() {
  const [admin, student, teacher, outsider] = await db.insert(users).values(["admin", "student", "teacher", "outsider"].map(name => ({ name, email: `${name}@feedback.test`, passwordHash: "fixture" }))).returning();
  const team = await createTeam(admin.id, "体验测试团队");
  for (const u of [student, teacher]) await joinTeam(u.id, team.inviteCode);
  await updateMemberRole(admin.id, team.id, teacher.id, "teacher");
  const project = await createProject(admin.id, team.id, { name: "体验测试项目", startDate: "2026-10-01", endDate: "2026-10-31" });
  return { admin, student, teacher, outsider, team, project };
}
describe("feedback fixes: permissions, data retention and transactional creation", () => {
  beforeEach(resetDb);
  it("validates merged project dates and stale versions; ignores extra ownership fields", async () => {
    const s = await scene(), version = projectVersion(s.project);
    await expect(updateProject(s.student.id, s.project.id, { name: "越权" })).rejects.toThrow();
    await expect(updateProject(s.admin.id, s.project.id, { startDate: "2026-11-01" })).rejects.toThrow("结束日期");
    await expect(updateProject(s.admin.id, s.project.id, { name: "  " })).rejects.toThrow();
    const changed = await updateProject(s.admin.id, s.project.id, { name: "新的名称", teamId: randomUUID() } as { name: string }, version);
    expect(changed.teamId).toBe(s.team.id);
    await expect(updateProject(s.admin.id, s.project.id, { name: "旧窗口保存" }, version)).rejects.toThrow("其他人修改");
  });
  it("archives readably and stops milestone, announcement and deliverable writes; restoration reopens them", async () => {
    const s = await scene();
    await createDeliverableDraft(s.student.id, s.project.id, { requestId: randomUUID(), title: "初稿", type: "other" });
    await updateProject(s.admin.id, s.project.id, { status: "archived" });
    expect(await getProjectForUser(s.student.id, s.project.id)).toBeTruthy();
    expect((await listProjectDeliverables(s.student.id, s.project.id))[0].allowedActions.edit).toBe(false);
    await expect(createMilestone(s.admin.id, s.project.id, { title: "禁止添加" })).rejects.toThrow("归档");
    await expect(createDeliverableDraft(s.student.id, s.project.id, { requestId: randomUUID(), title: "禁止成果", type: "other" })).rejects.toThrow("归档");
    await expect(publishAnnouncement(s.admin.id, s.project.id, { requestId: randomUUID(), title: "禁止公告", body: "正文", isPinned: false })).rejects.toThrow("归档");
    await updateProject(s.admin.id, s.project.id, { status: "active" });
    expect((await createMilestone(s.admin.id, s.project.id, { title: "已恢复" })).title).toBe("已恢复");
  });
  it("requires admin, archive, exact name and fresh preview before deletion; clears reactions and preserves unrelated data", async () => {
    const s = await scene();
    const other = await createProject(s.admin.id, s.team.id, { name: "另一个项目" });
    const task = await createTask(s.student.id, s.project.id, { title: "任务" });
    const comment = await createTaskComment(s.student.id, s.project.id, task.id, { requestId: randomUUID(), body: "评论", mentionedUserIds: [] });
    await db.insert(collaborationReactions).values({ messageId: comment.id, channel: "team", userId: s.student.id });
    await createDocument(s.student.id, s.project.id, { requestId: randomUUID(), title: "私人文档", visibility: "private" });
    await createDocument(s.student.id, other.id, { requestId: randomUUID(), title: "保留文档" });
    await expect(previewProjectDeletion(s.student.id, s.project.id)).rejects.toThrow();
    let preview = await previewProjectDeletion(s.admin.id, s.project.id);
    expect(preview.counts.documents).toBe(1);
    await expect(deleteArchivedProject(s.admin.id, s.project.id, { name: s.project.name, token: preview.token })).rejects.toThrow("先归档");
    await updateProject(s.admin.id, s.project.id, { status: "archived" });
    await expect(deleteArchivedProject(s.admin.id, s.project.id, { name: s.project.name, token: preview.token })).rejects.toThrow("内容已变化");
    preview = await previewProjectDeletion(s.admin.id, s.project.id);
    await expect(deleteArchivedProject(s.admin.id, s.project.id, { name: "打错名称", token: preview.token })).rejects.toThrow("完整项目名称");
    await deleteArchivedProject(s.admin.id, s.project.id, { name: s.project.name, token: preview.token });
    expect(await getProjectForUser(s.admin.id, s.project.id)).toBeNull();
    expect(await db.select().from(collaborationReactions)).toHaveLength(0);
    expect(await db.select().from(tasks)).toHaveLength(0);
    expect(await db.select().from(projectDocuments)).toHaveLength(1);
    expect(await db.select().from(users)).toHaveLength(4);
    expect(await getTeamMembership(s.student.id, s.team.id)).toBeTruthy();
  });
  it("retains an administrator under concurrent self-demotions", async () => {
    const s = await scene();
    await expect(updateMemberRole(s.admin.id, s.team.id, s.admin.id, "student")).rejects.toThrow("管理员");
    await updateMemberRole(s.admin.id, s.team.id, s.student.id, "admin");
    const results = await Promise.allSettled([updateMemberRole(s.admin.id, s.team.id, s.admin.id, "student"), updateMemberRole(s.student.id, s.team.id, s.student.id, "student")]);
    expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
    expect([await getTeamMembership(s.admin.id, s.team.id), await getTeamMembership(s.student.id, s.team.id)].filter(m => m?.role === "admin")).toHaveLength(1);
  });
  it("blocks removal until active assignments are handed over; removal revokes access but retains the account", async () => {
    const s = await scene();
    await createTask(s.admin.id, s.project.id, { title: "多人任务", assigneeIds: [s.admin.id, s.student.id] });
    await expect(removeTeamMember(s.admin.id, s.team.id, s.admin.id)).rejects.toThrow("管理员");
    await expect(removeTeamMember(s.teacher.id, s.team.id, s.student.id)).rejects.toThrow();
    await expect(removeTeamMember(s.admin.id, s.team.id, s.student.id)).rejects.toThrow("未完成任务");
    await removeTeamMember(s.teacher.id, s.team.id, s.teacher.id);
    expect(await getProjectForUser(s.teacher.id, s.project.id)).toBeNull();
    expect(await db.select().from(users).where(eq(users.id, s.teacher.id))).toHaveLength(1);
  });
  it("creates and assigns to an iteration atomically, replays once, rolls back on stale or foreign iteration", async () => {
    const s = await scene();
    const iteration = await createIteration(s.student.id, s.project.id, { requestId: randomUUID(), name: "这一轮", startDate: "2026-10-01", endDate: "2026-10-07" });
    const input = { requestId: randomUUID(), task: { title: "一起创建" }, iteration: { id: iteration.id, revision: iteration.revision } };
    const created = await createTaskWithIteration(s.student.id, s.project.id, input);
    expect(await createTaskWithIteration(s.student.id, s.project.id, input)).toEqual(created);
    expect((await db.select().from(tasks))[0].sprintId).toBe(iteration.id);
    await expect(createTaskWithIteration(s.student.id, s.project.id, { ...input, requestId: randomUUID(), task: { title: "旧轮次版本" } })).rejects.toThrow("迭代已被他人修改");
    await expect(createTaskWithIteration(s.student.id, s.project.id, { ...input, requestId: randomUUID(), iteration: { id: randomUUID(), revision: 1 } })).rejects.toThrow();
    expect(await db.select().from(tasks)).toHaveLength(1);
    expect(await db.select().from(projects)).toHaveLength(1);
  });
});
