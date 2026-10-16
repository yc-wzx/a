import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { projects, taskAssignees, teamMembers } from "@/db/schema";
import { createUser } from "@/lib/user";
import { createTeam, joinTeam, updateMemberRole } from "@/lib/team";
import { createProject } from "@/lib/project";
import { createTask, listProjectTasks, updateTask } from "@/lib/task";
import { getTaskCollaboration, mutateCollaboration, sendTaskDiscussion } from "@/lib/task-collaboration";
import { createTaskComment, listTaskComments } from "@/lib/comments";
import { getProjectTaskStats } from "@/lib/task-contract";
import { getMyOpenTasks } from "@/lib/dashboard";
import { commitDraft } from "@/lib/agent/commit";
import { submitTaskOutcome } from "@/lib/task-outcome";
import { getDeliverableDetail, listProjectDeliverables, reviewDeliverable } from "@/lib/deliverable";
import { listPersonalConversations, listPersonalMemories, mutateAssistantWorkspace, personalMemoryContext, personalWorkspaceHistory } from "@/lib/agent/workspace";
import { resetDb } from "./helpers";
async function scene() {
  const user = (name: string) => createUser({ name, email: name + "@collab.local", password: "12345678" });
  const admin = await user("admin"), alice = await user("alice"), bob = await user("bob"), teacher = await user("teacher"), other = await user("other");
  const team = await createTeam(admin.id, "测试课堂团队");
  for (const u of [alice, bob, teacher, other]) await joinTeam(u.id, team.inviteCode);
  await updateMemberRole(admin.id, team.id, teacher.id, "teacher");
  const project = await createProject(admin.id, team.id, { name: "共同作业" });
  const task = await createTask(alice.id, project.id, { title: "协作完成原型", assigneeIds: [alice.id, bob.id] });
  return { admin, alice, bob, teacher, other, team, project, task };
}
describe("多人任务与分离讨论权限", () => {
  beforeEach(resetDb);
  it("完成说明可独立提交并关联正式版本，重复提交幂等且不自动完成任务", async () => {
    const s = await scene(), input = { requestId: randomUUID(), note: "原型已经完成并核对过交互", url: "" };
    const result = await submitTaskOutcome(s.alice.id, s.project.id, s.task.id, input);
    const replay = await submitTaskOutcome(s.alice.id, s.project.id, s.task.id, input);
    expect(replay.versionId).toBe(result.versionId);
    expect(await listProjectDeliverables(s.alice.id, s.project.id)).toHaveLength(1);
    expect((await getDeliverableDetail(s.teacher.id, s.project.id, result.deliverableId)).deliverable.status).toBe("submitted");
    await reviewDeliverable(s.teacher.id, s.project.id, result.deliverableId, { requestId: randomUUID(), versionId: result.versionId, decision: "approved", comment: "已核对" });
    expect((await listProjectTasks(s.alice.id, s.project.id))[0].status).toBe("todo");
    await expect(submitTaskOutcome(s.alice.id, s.project.id, s.task.id, { requestId: randomUUID(), note: "", url: "" })).rejects.toThrow();
  });
  it("同一任务在两位学生待办中出现，项目只计一条；旧单人改派会撤销共同指派", async () => {
    const s = await scene();
    expect((await listProjectTasks(s.bob.id, s.project.id))[0].assignees).toHaveLength(2);
    for (const u of [s.alice, s.bob]) expect((await getMyOpenTasks(u.id)).some(t => t.id === s.task.id)).toBe(true);
    expect((await getProjectTaskStats(s.admin.id, s.project.id)).total).toBe(1);
    await updateTask(s.alice.id, s.task.id, { assigneeId: s.other.id });
    expect((await getTaskCollaboration(s.bob.id, s.project.id, s.task.id)).canDiscuss).toBe(false);
    expect((await db.select().from(taskAssignees).where(eq(taskAssignees.taskId, s.task.id))).map(r => r.userId)).toEqual([s.other.id]);
  });
  it("老师与非执行管理员只能看全队评论；私密消息不会混入公共记录", async () => {
    const s = await scene();
    await createTaskComment(s.alice.id, s.project.id, s.task.id, { requestId: randomUUID(), body: "公开进展", mentionedUserIds: [] });
    await sendTaskDiscussion(s.alice.id, s.project.id, s.task.id, { requestId: randomUUID(), body: "讨论内部安排" });
    for (const u of [s.admin, s.teacher, s.other]) {
      expect((await listTaskComments(u.id, s.project.id, s.task.id)).items[0].body).toBe("公开进展");
      const d = await getTaskCollaboration(u.id, s.project.id, s.task.id);
      expect(d.canDiscuss).toBe(false); expect(d.messages).toEqual([]); expect(d.participants).toEqual([]); expect(d.unread.discussion).toBe(0);
      await expect(sendTaskDiscussion(u.id, s.project.id, s.task.id, { requestId: randomUUID(), body: "越权" })).rejects.toThrow();
    }
    expect((await getTaskCollaboration(s.bob.id, s.project.id, s.task.id)).messages[0].body).toBe("讨论内部安排");
  });
  it("明确邀请才可读取，移除邀请后立即失去权限，包括历史与重放", async () => {
    const s = await scene();
    await mutateCollaboration(s.alice.id, s.project.id, s.task.id, { op: "invite", userId: s.teacher.id, enabled: true });
    const input = { requestId: randomUUID(), body: "参与后的讨论" };
    await sendTaskDiscussion(s.teacher.id, s.project.id, s.task.id, input);
    expect((await getTaskCollaboration(s.teacher.id, s.project.id, s.task.id)).canDiscuss).toBe(true);
    await mutateCollaboration(s.alice.id, s.project.id, s.task.id, { op: "invite", userId: s.teacher.id, enabled: false });
    expect((await getTaskCollaboration(s.teacher.id, s.project.id, s.task.id)).messages).toEqual([]);
    await expect(sendTaskDiscussion(s.teacher.id, s.project.id, s.task.id, input)).rejects.toThrow();
    await expect(mutateCollaboration(s.teacher.id, s.project.id, s.task.id, { op: "read", channel: "discussion" })).rejects.toThrow();
  });
  it("讨论消息幂等，跨频道回复、越权提及和离组访问被拒", async () => {
    const s = await scene(), input = { requestId: randomUUID(), body: "我先做交互稿" };
    const a = await sendTaskDiscussion(s.bob.id, s.project.id, s.task.id, input);
    expect((await sendTaskDiscussion(s.bob.id, s.project.id, s.task.id, input)).id).toBe(a.id);
    expect((await getTaskCollaboration(s.alice.id, s.project.id, s.task.id)).messages).toHaveLength(1);
    await expect(sendTaskDiscussion(s.bob.id, s.project.id, s.task.id, { ...input, body: "修改内容" })).rejects.toThrow();
    await expect(sendTaskDiscussion(s.bob.id, s.project.id, s.task.id, { requestId: randomUUID(), body: "提及非参与者", mentionedUserIds: [s.admin.id] })).rejects.toThrow();
    await expect(createTaskComment(s.bob.id, s.project.id, s.task.id, { requestId: randomUUID(), body: "错误跨频道回复", replyToId: a.id, mentionedUserIds: [] })).rejects.toThrow();
    await db.delete(teamMembers).where(and(eq(teamMembers.teamId, s.team.id), eq(teamMembers.userId, s.bob.id)));
    await expect(getTaskCollaboration(s.bob.id, s.project.id, s.task.id)).rejects.toThrow();
  });
  it("回复与收到在各自频道内生效，归档后保留历史但不能发送", async () => {
    const s = await scene();
    const first = await sendTaskDiscussion(s.alice.id, s.project.id, s.task.id, { requestId: randomUUID(), body: "先完成线框图" });
    await sendTaskDiscussion(s.bob.id, s.project.id, s.task.id, { requestId: randomUUID(), body: "收到", replyToId: first.id, mentionedUserIds: [s.alice.id] });
    await mutateCollaboration(s.bob.id, s.project.id, s.task.id, { op: "react", channel: "discussion", messageId: first.id, enabled: true });
    let d = await getTaskCollaboration(s.bob.id, s.project.id, s.task.id); expect(d.reactions).toHaveLength(1); expect(d.messages[1].replyToId).toBe(first.id);
    await db.update(projects).set({ status: "archived" }).where(eq(projects.id, s.project.id));
    d = await getTaskCollaboration(s.bob.id, s.project.id, s.task.id); expect(d.messages).toHaveLength(2); expect(d.canWrite).toBe(false);
    await expect(sendTaskDiscussion(s.bob.id, s.project.id, s.task.id, { requestId: randomUUID(), body: "归档后写入" })).rejects.toThrow();
  });
  it("AI 同一拆分草案重试确认只创建一次", async () => {
    const s = await scene(), request = randomUUID(), draft = { tasks: [{ title: "由AI提出并确认的任务", assigneeIds: [s.alice.id, s.bob.id] }] };
    await commitDraft(s.alice.id, s.project.id, "decompose_tasks", draft, request);
    await commitDraft(s.alice.id, s.project.id, "decompose_tasks", draft, request);
    expect((await listProjectTasks(s.alice.id, s.project.id)).filter(t => t.title === draft.tasks[0].title)).toHaveLength(1);
  });
});
describe("个人助手历史与可管理记忆", () => {
  beforeEach(resetDb);
  it("个人会话可新建多段、改名和删除，其他成员无法读取", async () => {
    const s = await scene();
    const a = await mutateAssistantWorkspace(s.alice.id, { op: "create", projectId: s.project.id }) as { id: string };
    await mutateAssistantWorkspace(s.alice.id, { op: "create", projectId: s.project.id });
    await mutateAssistantWorkspace(s.alice.id, { op: "rename", projectId: s.project.id, conversationId: a.id, title: "原型规划" });
    expect(await listPersonalConversations(s.alice.id)).toHaveLength(2);
    expect(await listPersonalConversations(s.admin.id)).toHaveLength(0);
    await expect(personalWorkspaceHistory(s.bob.id, a.id, s.project.id)).rejects.toThrow();
    await mutateAssistantWorkspace(s.alice.id, { op: "delete", projectId: s.project.id, conversationId: a.id });
    expect(await listPersonalConversations(s.alice.id)).toHaveLength(1);
  });
  it("记忆按本人和项目隔离，禁用、删除与离组均停止使用", async () => {
    const s = await scene();
    const saved = await mutateAssistantWorkspace(s.alice.id, { op: "memory", projectId: s.project.id, content: "偏好半小时的小目标", enabled: true }) as { id: string };
    expect(await personalMemoryContext(s.alice.id, s.project.id)).toContain("半小时");
    expect(await personalMemoryContext(s.bob.id, s.project.id)).toBe("");
    await mutateAssistantWorkspace(s.alice.id, { op: "memory", id: saved.id, projectId: s.project.id, content: "偏好半小时的小目标", enabled: false });
    expect(await personalMemoryContext(s.alice.id, s.project.id)).toBe("");
    await mutateAssistantWorkspace(s.alice.id, { op: "forget", id: saved.id }); expect(await listPersonalMemories(s.alice.id)).toEqual([]);
    await mutateAssistantWorkspace(s.alice.id, { op: "memory", projectId: s.project.id, content: "项目工作偏好", enabled: true });
    await db.delete(teamMembers).where(and(eq(teamMembers.teamId, s.team.id), eq(teamMembers.userId, s.alice.id)));
    expect(await listPersonalMemories(s.alice.id)).toEqual([]);
    await expect(personalMemoryContext(s.alice.id, s.project.id)).rejects.toThrow();
  });
});
