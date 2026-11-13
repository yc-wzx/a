import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { strFromU8, unzipSync } from "fflate";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db";
import { tasks, teamMembers, users } from "@/db/schema";
import { createTeam, joinTeam, updateMemberRole } from "@/lib/team";
import { createProject } from "@/lib/project";
import { createTask, setTaskSuccessors } from "@/lib/task";
import { createTaskComment, deleteTaskComment, highlightTaskComment, listTaskComments } from "@/lib/comments";
import { createDocument } from "@/lib/documents";
import { uploadAttachment } from "@/lib/attachments";
import { listProjectAttachmentOverview } from "@/lib/attachment-overview";
import { createProjectReference } from "@/lib/project-extras";
import { createTaskFromSource, getTaskOrigin, listMeetingFollowups } from "@/lib/source-tasks";
import { getOrCreateScopedConversation } from "@/lib/agent/context";
import { persistTurn } from "@/lib/agent/conversation";
import { buildReportDocument, exportAssistantReport } from "@/lib/agent/report-document";
import { buildWorkflowContext } from "@/lib/agent/workflows";
import { scanAndRecordDueReminders } from "@/lib/notification-reminders";
import { listMyNotifications } from "@/lib/notification";
import { resetDb } from "./helpers";

async function scene() {
  const [admin, student, teacher, outsider] = await db.insert(users).values(
    ["admin", "student", "teacher", "outsider"].map(name => ({ name, email: `${name}@course-collaboration.test`, passwordHash: "fixture" })),
  ).returning();
  const team = await createTeam(admin.id, "课程协作验证");
  for (const user of [student, teacher]) await joinTeam(user.id, team.inviteCode);
  await updateMemberRole(admin.id, team.id, teacher.id, "teacher");
  const project = await createProject(admin.id, team.id, { name: "课程项目" });
  return { admin, student, teacher, outsider, team, project };
}

describe("课程协作增量与权限回归", () => {
  beforeEach(resetDb);

  it("拒绝长链循环，原来的依赖保持可用", async () => {
    const s = await scene();
    const a = await createTask(s.student.id, s.project.id, { title: "需求确认" });
    const b = await createTask(s.student.id, s.project.id, { title: "接口实现" });
    const c = await createTask(s.student.id, s.project.id, { title: "联调验证" });
    await setTaskSuccessors(s.student.id, a.id, [b.id]);
    await setTaskSuccessors(s.student.id, b.id, [c.id]);
    await expect(setTaskSuccessors(s.student.id, c.id, [a.id])).rejects.toThrow("联调验证 → 需求确认 → 接口实现 → 联调验证");
  });

  it("教师标记他人评论可重试，学生不能标记，删除后的标记请求不可重放", async () => {
    const s = await scene();
    const task = await createTask(s.student.id, s.project.id, { title: "核对接口" });
    const comment = await createTaskComment(s.student.id, s.project.id, task.id, {
      requestId: randomUUID(), body: "周五联调前统一返回结构", mentionedUserIds: [],
    });
    const input = { requestId: randomUUID(), expectedRevision: comment.revision, highlighted: true };
    await expect(highlightTaskComment(s.student.id, s.project.id, task.id, comment.id, input)).rejects.toThrow("没有权限");
    const highlighted = await highlightTaskComment(s.teacher.id, s.project.id, task.id, comment.id, input);
    expect(await highlightTaskComment(s.teacher.id, s.project.id, task.id, comment.id, input)).toEqual(highlighted);
    expect((await listTaskComments(s.student.id, s.project.id, task.id, { highlightedOnly: true })).items).toHaveLength(1);
    await deleteTaskComment(s.student.id, s.project.id, task.id, comment.id, { requestId: randomUUID(), expectedRevision: highlighted.revision });
    await expect(highlightTaskComment(s.teacher.id, s.project.id, task.id, comment.id, input)).rejects.toThrow();
  });

  it("附件汇总不暴露私有文档，筛选与来源链接沿用当前权限", async () => {
    const s = await scene();
    const task = await createTask(s.student.id, s.project.id, { title: "交互说明" });
    const privateDoc = await createDocument(s.student.id, s.project.id, { requestId: randomUUID(), title: "私人草稿", visibility: "private" });
    const publicFile = await uploadAttachment(s.student.id, { projectId: s.project.id, targetType: "task", targetId: task.id }, { name: "公开说明.txt", bytes: Buffer.from("课程说明") }, randomUUID());
    await uploadAttachment(s.student.id, { projectId: s.project.id, targetType: "document", targetId: privateDoc.id }, { name: "私人草稿.txt", bytes: Buffer.from("私人内容") }, randomUUID());
    const mine = await listProjectAttachmentOverview(s.student.id, s.project.id);
    expect(mine.items).toHaveLength(2);
    const admin = await listProjectAttachmentOverview(s.admin.id, s.project.id);
    expect(admin.items.map(file => file.id)).toEqual([publicFile.id]);
    expect(admin.items[0]).toMatchObject({ sourceTitle: task.title, sourceHref: `/projects/${s.project.id}?task=${task.id}` });
    expect((await listProjectAttachmentOverview(s.admin.id, s.project.id, { query: "私人" })).items).toHaveLength(0);
    await expect(listProjectAttachmentOverview(s.outsider.id, s.project.id)).rejects.toThrow("没有权限");
  });

  it("会议任务创建幂等并保留来源，完成状态直接取自任务", async () => {
    const s = await scene();
    const meeting = await createProjectReference(s.student.id, s.project.id, {
      requestId: randomUUID(), title: "接口联调会议", type: "meeting", url: "https://meeting.tencent.com/example", note: "下次联调前补上错误提示",
    });
    const input = { requestId: randomUUID(), sourceType: "meeting", sourceId: meeting.id,
      expectedSourceRevision: String(meeting.revision), title: "补齐错误提示", description: "明确权限失败与网络失败", assigneeId: s.student.id, dueDate: "2026-12-01" };
    const task = await createTaskFromSource(s.student.id, s.project.id, input);
    expect(await createTaskFromSource(s.student.id, s.project.id, input)).toEqual(task);
    expect((await listMeetingFollowups(s.teacher.id, s.project.id, [meeting.id]))).toHaveLength(1);
    expect(await getTaskOrigin(s.teacher.id, s.project.id, task.id)).toMatchObject({ label: "来源：会议行动项" });
    await db.update(tasks).set({ status: "done" }).where(eq(tasks.id, task.id));
    expect((await listMeetingFollowups(s.teacher.id, s.project.id, [meeting.id]))[0].status).toBe("done");
    await expect(createTaskFromSource(s.teacher.id, s.project.id, { ...input, requestId: randomUUID() })).rejects.toThrow("没有权限");
    await expect(createTaskFromSource(s.student.id, s.project.id, { ...input, requestId: randomUUID(), expectedSourceRevision: "0" })).rejects.toThrow("已变化");
  });

  it("仅本人可以导出个人助手 Word，中文标题、正文和表格均为原生文档内容", async () => {
    const s = await scene();
    const conversation = await getOrCreateScopedConversation(s.student.id, s.project.id, { scope: "personal" });
    const messageId = await persistTurn(conversation.id, "生成周报", "# 课程项目周报\n## 本周进展\n- **已完成**需求确认\n|事项|状态|\n|---|---|\n|联调|进行中|", []);
    const report = await exportAssistantReport(s.student.id, messageId);
    const zip = unzipSync(report.bytes);
    const xml = strFromU8(zip["word/document.xml"]);
    expect(xml).toContain("课程项目周报"); expect(xml).toContain("需求确认"); expect(xml).toContain("<w:tbl>");
    expect(report.filename).toBe("课程项目周报.docx");
    await expect(exportAssistantReport(s.admin.id, messageId)).rejects.toThrow("不可访问");
    await db.delete(teamMembers).where(eq(teamMembers.userId, s.student.id));
    await expect(exportAssistantReport(s.student.id, messageId)).rejects.toThrow("没有权限");
  });

  it("周报取数注明七天窗口及资料覆盖，提醒说明仍未完成的前置任务", async () => {
    const s = await scene();
    const first = await createTask(s.student.id, s.project.id, { title: "确认接口" });
    const next = await createTask(s.student.id, s.project.id, { title: "联调", assigneeId: s.student.id, dueDate: "2026-11-12" });
    await setTaskSuccessors(s.student.id, first.id, [next.id]);
    const workflow = await buildWorkflowContext(s.student.id, s.project.id, "weekly");
    expect(workflow).toContain("累计已完成数和本周完成数必须分开"); expect(workflow).toContain("coverage");
    await scanAndRecordDueReminders(new Date("2026-11-12T04:00:00Z"));
    const notifications = await listMyNotifications(s.student.id, {});
    expect(notifications.items.some(item => item.summary?.includes("前置未完成：确认接口"))).toBe(true);
  });
  it("大表格导出保留超出排版范围的所有行列", async () => {
    const wide = "|一|二|三|四|五|六|七|八|第九列保留|\n|---|---|---|---|---|---|---|---|---|\n|1|2|3|4|5|6|7|8|第九项内容|";
    const long = "|项目|状态|\n|---|---|\n" + Array.from({ length: 205 }, (_, i) => `|第${i + 1}项|待办|`).join("\n");
    const bytes = await buildReportDocument("完整导出", wide + "\n\n" + long, "课程项目");
    const xml = strFromU8(unzipSync(bytes)["word/document.xml"]);
    expect(xml).toContain("第九项内容"); expect(xml).toContain("第205项");
  });
});
