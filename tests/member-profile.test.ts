import { randomUUID } from "node:crypto";
import { beforeEach, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users, userProfiles, teams, teamMembers, projects, tasks, deliverables, projectActivities, userAiSettings } from "@/db/schema";
import { getMemberProfile, getMyProfile, getTeamMemberDirectory, updateMyProfile } from "@/lib/member-profile";
import { ConflictError, ForbiddenError, ValidationError } from "@/lib/errors";
import { resetDb } from "./helpers";
import { addDays, shanghaiDay } from "@/lib/schedule/types";
const session = vi.hoisted(() => ({ auth: vi.fn() }));
vi.mock("@/lib/auth", () => ({ auth: session.auth }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
import { saveMyProfileAction } from "@/app/(app)/settings/profile/actions";

const input = { name: "课程成员", bio: "负责交互设计", skills: ["React", "交互设计"], avatarColor: "violet" as const, avatarLabel: "成员", expectedRevision: 0 };
beforeEach(async () => { await resetDb(); session.auth.mockReset(); });
async function fixture() {
  const [admin, student, teacher, outsider] = await db.insert(users).values(["admin", "student", "teacher", "outsider"].map(name => ({ name, email: `${name}@profile.test`, passwordHash: `private-password-${name}`, feishuOpenId: `private-feishu-${name}` }))).returning();
  const [common, privateTeam] = await db.insert(teams).values([{ name: "共同团队", inviteCode: randomUUID() }, { name: "另一团队私有名称", inviteCode: randomUUID() }]).returning();
  await db.insert(teamMembers).values([{ teamId: common.id, userId: admin.id, role: "admin" }, { teamId: common.id, userId: student.id, role: "student" }, { teamId: common.id, userId: teacher.id, role: "teacher" }, { teamId: privateTeam.id, userId: student.id, role: "student" }]);
  const [project, privateProject] = await db.insert(projects).values([{ name: "共同课程项目", teamId: common.id }, { name: "其他团队秘密项目", teamId: privateTeam.id }]).returning();
  const [parent] = await db.insert(tasks).values({ title: "逾期进行中主任务", projectId: project.id, assigneeId: student.id, status: "doing", dueDate: addDays(shanghaiDay(), -1) }).returning();
  await db.insert(tasks).values([{ title: "当天任务", projectId: project.id, assigneeId: student.id, dueDate: shanghaiDay() }, { title: "已完成的子任务", projectId: project.id, parentTaskId: parent.id, assigneeId: student.id, status: "done", dueDate: addDays(shanghaiDay(), -2) }, { title: "其他团队秘密任务", projectId: privateProject.id, assigneeId: student.id }]);
  const base = { authorId: student.id, creationKey: randomUUID(), creationHash: "fixture" };
  const [formal] = await db.insert(deliverables).values([
    { ...base, projectId: project.id, title: "公开提交材料", type: "report", status: "submitted", submittedAt: new Date(), workingCopy: { title: "不公开的新草稿标题", type: "report", url: "https://private.test", description: "不公开的新草稿正文", milestoneId: null, requestId: randomUUID(), baseRevision: 1 } },
    { ...base, creationKey: randomUUID(), projectId: project.id, title: "未提交的私有草稿", type: "video" },
    { ...base, creationKey: randomUUID(), projectId: privateProject.id, title: "其他团队秘密成果", type: "report", status: "submitted" },
  ]).returning();
  await db.insert(projectActivities).values([{ projectId: project.id, actorId: student.id, eventKey: randomUUID(), objectId: parent.id, objectType: "task", type: "task.created", summary: "建立了共同团队任务", occurredAt: new Date() }, { projectId: privateProject.id, actorId: student.id, eventKey: randomUUID(), objectId: randomUUID(), objectType: "task", type: "task.created", summary: "其他团队秘密活动", occurredAt: new Date() }]);
  await db.insert(userAiSettings).values({ userId: student.id, provider: "fixture", baseUrl: "https://fixture.test", modelId: "secret-model", apiKeyCiphertext: "private-ciphertext", instructions: "个人会话提示词" });
  return { admin, student, teacher, outsider, common, privateTeam, project, privateProject, formal };
}

it("没有共同团队的访问者不能查看资料或成员目录", async () => {
  const f = await fixture();
  await expect(getMemberProfile(f.outsider.id, f.student.id)).rejects.toBeInstanceOf(ForbiddenError);
  await expect(getTeamMemberDirectory(f.outsider.id, f.common.id)).rejects.toBeInstanceOf(ForbiddenError);
  await expect(getMemberProfile(f.admin.id, randomUUID())).rejects.toBeInstanceOf(ForbiddenError);
});
it("教师与管理员仅统计共同团队，正文草稿和私人配置不进入 DTO", async () => {
  const f = await fixture();
  for (const viewer of [f.admin, f.teacher]) {
    const result = await getMemberProfile(viewer.id, f.student.id);
    expect(result.stats).toMatchObject({ projects: 1, tasks: 3, doing: 1, todo: 1, done: 1, overdue: 1, deliverables: 1 });
    expect(result.projects.map(p => p.id)).toEqual([f.project.id]);
    expect(result.deliverables.map(d => d.id)).toEqual([f.formal.id]);
    const serialized = JSON.stringify(result);
    for (const forbidden of ["秘密", "未提交的私有草稿", "不公开的新草稿", "private-password", "private-feishu", "private-ciphertext", "secret-model", "个人会话提示词", "passwordHash", "email", "workingCopy"]) expect(serialized).not.toContain(forbidden);
  }
});
it("本人看全自己的共同团队，显式团队筛选仍限制范围", async () => {
  const f = await fixture();
  expect((await getMemberProfile(f.student.id, f.student.id)).stats.projects).toBe(2);
  expect((await getMemberProfile(f.student.id, f.student.id, { teamId: f.common.id })).stats.projects).toBe(1);
  await expect(getMemberProfile(f.admin.id, f.student.id, { teamId: f.privateTeam.id })).rejects.toBeInstanceOf(ForbiddenError);
});
it("离开共同团队后重新查询即拒绝访问", async () => {
  const f = await fixture();
  await getMemberProfile(f.teacher.id, f.student.id);
  await db.delete(teamMembers).where(eq(teamMembers.userId, f.teacher.id));
  await expect(getMemberProfile(f.teacher.id, f.student.id)).rejects.toBeInstanceOf(ForbiddenError);
});
it("旧用户默认资料可读，没有团队的本人有真实空状态", async () => {
  const f = await fixture();
  expect(await getMyProfile(f.outsider.id)).toMatchObject({ name: "outsider", bio: "", skills: [], revision: 0 });
  const result = await getMemberProfile(f.outsider.id, f.outsider.id);
  expect(result.stats.tasks).toBe(0); expect(result.projects).toEqual([]);
});
it("状态筛选与分页不会扩大项目范围，已完成逾期任务不算逾期", async () => {
  const f = await fixture();
  expect((await getMemberProfile(f.teacher.id, f.student.id, { filter: "overdue" })).tasks.items.map(t => t.title)).toEqual(["逾期进行中主任务"]);
  await db.insert(tasks).values(Array.from({ length: 25 }, (_, i) => ({ projectId: f.project.id, title: `额外任务 ${i}`, assigneeId: f.student.id })));
  const first = await getMemberProfile(f.admin.id, f.student.id, { filter: "todo", page: 1 }), second = await getMemberProfile(f.admin.id, f.student.id, { filter: "todo", page: 2 });
  expect(first.tasks.items).toHaveLength(20); expect(second.tasks.items).toHaveLength(6);
  expect(first.tasks.items.some(a => second.tasks.items.some(b => a.id === b.id))).toBe(false);
  await expect(getMemberProfile(f.admin.id, f.student.id, { page: -1 })).rejects.toBeInstanceOf(ValidationError);
});
it("更新介绍和头像时保留密码、飞书身份与团队角色，技能去重", async () => {
  const f = await fixture();
  await updateMyProfile(f.student.id, { ...input, skills: ["React", "react", "交互设计"] });
  expect(await getMyProfile(f.student.id)).toMatchObject({ name: input.name, bio: input.bio, skills: ["react", "交互设计"], revision: 1 });
  const [user] = await db.select().from(users).where(eq(users.id, f.student.id));
  expect(user.passwordHash).toBe(f.student.passwordHash); expect(user.feishuOpenId).toBe(f.student.feishuOpenId);
  expect((await getTeamMemberDirectory(f.admin.id, f.common.id)).members.find(m => m.id === f.student.id)?.role).toBe("student");
});
it("并发首次编辑和旧版本编辑不会覆盖成功保存的资料", async () => {
  const f = await fixture();
  const results = await Promise.allSettled([updateMyProfile(f.student.id, input), updateMyProfile(f.student.id, { ...input, bio: "另一个窗口" })]);
  expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
  expect(results.find(r => r.status === "rejected")).toMatchObject({ reason: expect.any(ConflictError) });
  expect((await db.select().from(userProfiles).where(eq(userProfiles.userId, f.student.id)))).toHaveLength(1);
  await expect(updateMyProfile(f.student.id, input)).rejects.toBeInstanceOf(ConflictError);
});
it("宽对象不能夹带密码、目标用户或角色，非法资料不会留下部分更新", async () => {
  const f = await fixture();
  for (const extra of [{ userId: f.admin.id }, { role: "admin" }, { passwordHash: "new" }]) await expect(updateMyProfile(f.student.id, { ...input, ...extra })).rejects.toBeInstanceOf(ValidationError);
  await expect(updateMyProfile(f.student.id, { ...input, skills: Array(13).fill("技能") })).rejects.toBeInstanceOf(ValidationError);
  expect((await getMyProfile(f.student.id)).revision).toBe(0);
});
it("保存 Action 只从登录会话确定本人，未登录与校验失败保留错误反馈", async () => {
  const f = await fixture();
  const form = new FormData(); for (const [key, value] of Object.entries(input)) form.set(key, key === "skills" ? "React，交互设计" : String(value));
  form.set("userId", f.student.id);
  expect(await saveMyProfileAction(null, form)).toEqual({ error: "请先登录" });
  session.auth.mockResolvedValue({ user: { id: f.admin.id } });
  expect(await saveMyProfileAction(null, form)).toBe(null);
  expect((await getMyProfile(f.admin.id)).revision).toBe(1);
  expect((await getMyProfile(f.student.id)).revision).toBe(0);
  form.set("name", ""); expect(await saveMyProfileAction(null, form)).toHaveProperty("error");
});
