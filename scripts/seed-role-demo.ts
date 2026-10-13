// Run only with explicit deployment authorization. Credentials arrive over stdin and are never printed.
import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import * as Y from "yjs";
import { db } from "@/db";
import { milestones, teams, users } from "@/db/schema";
import { createUser } from "@/lib/user";
import { createTeam, joinTeam, updateMemberRole } from "@/lib/team";
import { createProject, createMilestone, listProjectMilestones, updateProject } from "@/lib/project";
import { createTask, updateTask, createSubtask, setTaskSuccessors, deleteTask } from "@/lib/task";
import { setTaskBlocked } from "@/lib/task-contract";
import { createIteration, assignTasks, startIteration, previewIterationCompletion, completeIteration, saveIterationRetrospective } from "@/lib/iteration";
import { createLabel, setTaskLabels } from "@/lib/label";
import { createDeliverableDraft, submitDeliverable, reviewDeliverable, startDeliverableRevision, updateDeliverableDraft, createTaskFromFeedback } from "@/lib/deliverable";
import { createTaskComment } from "@/lib/comments";
import { publishAnnouncement } from "@/lib/announcements";
import { createProjectReference, setProjectLeader } from "@/lib/project-extras";
import { createResourceUsage, endResourceUsage } from "@/lib/resource";
import { createDocument, createDocumentVersion, getDocumentDetail, syncDocument, addDocumentComment, changeDocumentComment, changeDocumentTaskLink, trashDocument, updateDocument } from "@/lib/documents";
import { readYState } from "@/lib/documents-content";
import type { DocumentNode } from "@/contracts/documents";
import { addChecklistItem, updateChecklistItem, setTaskWatching, getProjectDoingLimit, setProjectDoingLimit, linkTaskMaterial } from "@/lib/task-enhancements";
import { getMySchedule, saveMyPreferences, importMySchedule } from "@/lib/schedule/store";
import { saveScheduleSharing, getTeamAvailability } from "@/lib/schedule/availability";
import { generatePersonalPlan, changePersonalPlan } from "@/lib/schedule/planner";
import { addDays, localInstant, shanghaiDay } from "@/lib/schedule/types";
import { listMyNotifications, markNotificationRead } from "@/lib/notifications";

const credentials = z.strictObject({ origin: z.url(), accounts: z.array(z.strictObject({
  role: z.enum(["admin", "student", "teacher"]),
  email: z.email().regex(/^(admin|student|teacher)\.demo@weidu-agilecampus\.pw$/),
  name: z.string().min(1), password: z.string().min(16).max(72),
})).length(3) });
let phase = "validate", teamId: string | undefined;
const createdUsers: { id: string; email: string }[] = [];
function progress(value: string) { phase = value; console.log(JSON.stringify({ phase })); }
const paragraph = (text: string): DocumentNode => ({ type: "paragraph", content: [{ type: "text", text }] });
const heading = (text: string): DocumentNode => ({ type: "heading", attrs: { level: 2 }, content: [{ type: "text", text }] });
const content = (title: string, lines: string[]): DocumentNode => ({ type: "doc", content: [heading(title), paragraph("本材料是课堂演示用的模拟数据，不代表唯笃队真实开发进度。"), ...lines.map(paragraph)] });

async function main() {
  if (process.env.AGILECAMPUS_DEMO_SEED !== "authorized") throw Error("Explicit demo seed authorization is required");
  let input = ""; for await (const chunk of process.stdin) input += chunk.toString();
  const config = credentials.parse(JSON.parse(input));
  if (new Set(config.accounts.map(a => a.role)).size !== 3 || config.accounts.some(a => a.email !== `${a.role}.demo@weidu-agilecampus.pw`)) throw Error("Three distinct role accounts required");
  if (new URL(config.origin).origin !== new URL(process.env.AUTH_URL!).origin) throw Error("Deployment origin does not match");
  if ((await db.select({ id: users.id }).from(users).where(inArray(users.email, config.accounts.map(a => a.email)))).length) throw Error("Demo email already exists; existing accounts will not be overwritten");
  progress("accounts");
  const accounts = [];
  for (const a of config.accounts) { const u = await createUser(a); createdUsers.push(u); accounts.push({ ...u, role: a.role }); }
  const admin = accounts.find(a => a.role === "admin")!, student = accounts.find(a => a.role === "student")!, teacher = accounts.find(a => a.role === "teacher")!;
  const team = await createTeam(admin.id, "唯笃队·课堂演示（模拟数据）"); teamId = team.id;
  await joinTeam(student.id, team.inviteCode); await joinTeam(teacher.id, team.inviteCode);
  await updateMemberRole(admin.id, team.id, teacher.id, "teacher");
  const today = shanghaiDay(), day = (n: number) => addDays(today, n);
  const project = await createProject(admin.id, team.id, { requestId: randomUUID(), name: "AgileCampus 全功能演示（模拟数据）", templateId: "course", startDate: day(-7), endDate: day(14), description: "用于课堂展示管理员、学生、教师的完整协作流程。所有任务、材料与反馈均为模拟数据；演示账号不属于真实课程团队。" });
  const pid = project.id, base = `${config.origin}/projects/${pid}`;
  const stages = await listProjectMilestones(admin.id, pid);
  await setProjectLeader(admin.id, pid, { requestId: randomUUID(), leaderId: admin.id, expectedRevision: 0 });
  await setProjectLeader(admin.id, pid, { requestId: randomUUID(), leaderId: student.id, expectedRevision: 1 });
  await db.update(milestones).set({ status: "done" }).where(and(eq(milestones.id, stages[0].id), eq(milestones.projectId, pid)));
  const removableStage = await createMilestone(admin.id, pid, { title: "现场删除练习阶段（演示）", targetDate: day(13) });
  progress("tasks-and-iterations");
  const makeTask = (title: string, assigneeId?: string, due = 7, priority: "low" | "medium" | "high" = "medium", stage = 1) => createTask(admin.id, pid, { title, assigneeId, dueDate: day(due), startDate: day(-2), milestoneId: stages[stage].id, priority, description: "课堂演示任务，可使用该任务验证操作。", acceptanceCriteria: "核对正常、异常和空状态；记录操作与结果，提交材料供教师反馈。" });
  let interview = await makeTask("整理需求访谈结论（演示）", student.id, 0, "high", 0);
  let design = await makeTask("完成信息架构与线框图（演示）", admin.id, 0, "medium", 0);
  let prototype = await makeTask("完善交互原型与异常路径（演示）", student.id, 3, "high");
  let blocked = await makeTask("核对教师审核交互（阻塞演示）", admin.id, 2, "high");
  let overdue = await makeTask("补齐键盘操作检查（逾期演示）", student.id, -1, "high");
  const testing = await makeTask("开展三人真实试用并整理记录（演示）", student.id, 7, "high", 2);
  const accessibility = await makeTask("完善通知与空状态文案（演示）", student.id, 5);
  const planningTask = await makeTask("检查课表与个人规划交互（演示）", student.id, 7);
  const deployment = await makeTask("核对部署备份与恢复步骤（演示）", admin.id, 10, "medium", 2);
  const unassigned = await makeTask("下轮候选：整理展示材料（演示）", undefined, 12, "low", 3);
  const removableTask = await createTask(admin.id, pid, { title: "现场删除练习任务（演示）", assigneeId: student.id, milestoneId: removableStage.id, dueDate: day(13) });
  const childA = await createSubtask(admin.id, prototype.id, { title: "补充异常流程说明（子任务演示）", assigneeId: student.id, dueDate: day(2) });
  const childB = await createSubtask(admin.id, prototype.id, { title: "核对表单焦点与键盘顺序（子任务演示）", assigneeId: admin.id, dueDate: day(3) });
  await updateTask(admin.id, childA.id, { status: "done", completionNote: "模拟完成说明：已经补充异常分支。" });
  await setTaskSuccessors(admin.id, interview.id, [prototype.id]); await setTaskSuccessors(admin.id, prototype.id, [testing.id]);
  const labels = await Promise.all([createLabel(admin.id, team.id, { name: "交互设计", color: "blue" }), createLabel(admin.id, team.id, { name: "功能开发", color: "violet" }), createLabel(admin.id, team.id, { name: "待核对", color: "amber" })]);
  await setTaskLabels(admin.id, prototype.id, [labels[0].id, labels[2].id]); await setTaskLabels(admin.id, blocked.id, [labels[1].id]);
  await setTaskWatching(student.id, pid, prototype.id, { requestId: randomUUID(), watching: true });
  await setTaskWatching(teacher.id, pid, prototype.id, { requestId: randomUUID(), watching: true });
  prototype = await updateTask(admin.id, prototype.id, { status: "doing" });
  blocked = await updateTask(admin.id, blocked.id, { status: "doing" });
  await setTaskBlocked(admin.id, pid, blocked.id, { requestId: randomUUID(), expectedUpdatedAt: blocked.updatedAt.toISOString(), isBlocked: true, blockedReason: "模拟阻塞：需要确认退回成果后的提示文案。演示时可解除。" });
  overdue = await updateTask(admin.id, overdue.id, { status: "doing" });
  let completedRound = await createIteration(admin.id, pid, { requestId: randomUUID(), name: "迭代一：需求与设计（已结束演示）", goal: "演示结束快照和复盘", startDate: day(-7), endDate: day(-1) });
  completedRound = (await assignTasks(admin.id, pid, completedRound.id, { requestId: randomUUID(), expectedRevision: completedRound.revision, tasks: [interview, design].map(t => ({ taskId: t.id, expectedUpdatedAt: t.updatedAt.toISOString() })) })).iteration;
  completedRound = await startIteration(admin.id, pid, completedRound.id, { requestId: randomUUID(), expectedRevision: completedRound.revision });
  interview = await updateTask(student.id, interview.id, { status: "done", completionNote: "模拟完成记录：访谈结论已整理。" });
  design = await updateTask(admin.id, design.id, { status: "done", completionNote: "模拟完成记录：线框图结构已确认。" });
  const preview = await previewIterationCompletion(admin.id, pid, completedRound.id);
  await completeIteration(admin.id, pid, completedRound.id, { requestId: randomUUID(), expectedRevision: preview.iterationRevision, taskVersions: preview.taskVersions, unfinishedDisposition: [] });
  await saveIterationRetrospective(student.id, pid, completedRound.id, { requestId: randomUUID(), wentWell: "模拟复盘：明确负责人后任务分工更清楚。", problems: "模拟复盘：异常流程讨论偏晚。", nextActions: "模拟复盘：下轮先检查异常与空状态，展示前预演。" });
  let activeRound = await createIteration(admin.id, pid, { requestId: randomUUID(), name: "迭代二：开发与试用（进行中演示）", goal: "完成原型、协作与成果反馈闭环", startDate: today, endDate: day(7) });
  activeRound = (await assignTasks(admin.id, pid, activeRound.id, { requestId: randomUUID(), expectedRevision: activeRound.revision, tasks: [prototype, overdue].map(t => ({ taskId: t.id, expectedUpdatedAt: t.updatedAt.toISOString() })) })).iteration;
  activeRound = await startIteration(admin.id, pid, activeRound.id, { requestId: randomUUID(), expectedRevision: activeRound.revision });
  const plannedRound = await createIteration(admin.id, pid, { requestId: randomUUID(), name: "迭代三：结题准备（计划演示）", goal: "可现场添加任务、开始或删除这轮", startDate: day(8), endDate: day(14) });
  const limit = await getProjectDoingLimit(admin.id, pid); await setProjectDoingLimit(admin.id, pid, { requestId: randomUUID(), expectedRevision: limit.revision, doingLimit: 2 });
  for (const [text, checked] of [["正常流程已有说明", true], ["异常分支已验证", false], ["键盘操作可完成流程", false]] as const) { const item = await addChecklistItem(student.id, pid, prototype.id, { requestId: randomUUID(), text }); if (checked) await updateChecklistItem(student.id, pid, prototype.id, { requestId: randomUUID(), itemId: item.id, expectedRevision: item.revision, checked: true }); }
  await createTaskComment(teacher.id, pid, prototype.id, { requestId: randomUUID(), body: "【演示反馈】请补充网络中断与空列表的处理说明。", mentionedUserIds: [student.id] });
  await createTaskComment(student.id, pid, prototype.id, { requestId: randomUUID(), body: "【演示回复】将补充这两个分支，并请负责人核对。", mentionedUserIds: [admin.id] });
  progress("documents");
  const reportV1 = await createDocument(student.id, pid, { requestId: randomUUID(), title: "需求报告 V1（演示材料）", folder: "调研", content: content("需求报告 V1", ["主要角色：学生、教师、团队管理员。", "主要流程：任务分工、提交成果、教师反馈。", "这个版本尚未覆盖异常流程，用于演示退回与重交。"] ) });
  const reportV2 = await createDocument(student.id, pid, { requestId: randomUUID(), title: "需求报告 V2（演示材料）", folder: "调研", content: content("需求报告 V2", ["角色和权限：学生提交自己的成果，教师验收，管理员组织团队。", "补充流程：退回成果后开始新草稿，修改后再次提交；旧版本保留。", "补充异常：无任务、无网络、无权限分别给出明确提示。"] ) });
  const collaboration = await createDocument(admin.id, pid, { requestId: randomUUID(), title: "交互设计与协作说明（演示）", folder: "设计", content: { type: "doc", content: [heading("交互设计与协作说明"), paragraph("本材料为课堂模拟演示数据，可由管理员和学生一起编辑。"), paragraph("核心操作：新建任务、添加检查项、提交成果、根据教师意见修改。"), { type: "taskList", content: [{ type: "taskItem", attrs: { checked: true }, content: [paragraph("统一主要入口与页面文案")] }, { type: "taskItem", attrs: { checked: false }, content: [paragraph("完成异常状态试用")] }] }, { type: "table", content: [{ type: "tableRow", content: [{ type: "tableHeader", content: [paragraph("角色")] }, { type: "tableHeader", content: [paragraph("职责")] }] }, { type: "tableRow", content: [{ type: "tableCell", content: [paragraph("学生")] }, { type: "tableCell", content: [paragraph("完成任务并提交成果")] }] }] }] } });
  let detail = await getDocumentDetail(admin.id, pid, collaboration.id);
  await createDocumentVersion(admin.id, pid, collaboration.id, { requestId: randomUUID(), expectedRevision: detail.revision, label: "设计说明 V1（演示）" });
  const ydoc = readYState(detail.state), vector = Y.encodeStateVector(ydoc), p = new Y.XmlElement("paragraph"), text = new Y.XmlText();
  p.setAttribute("id", randomUUID()); text.insert(0, "V2 补充（演示）：通知标记已读后立即更新列表；新手教程统一提供角色指南与页面指引。"); p.insert(0, [text]); ydoc.getXmlFragment("default").push([p]);
  await syncDocument(admin.id, pid, collaboration.id, { sessionId: randomUUID(), epoch: detail.epoch, stateVector: Buffer.from(vector).toString("base64"), update: Buffer.from(Y.encodeStateAsUpdate(ydoc, vector)).toString("base64") }); ydoc.destroy();
  detail = await getDocumentDetail(admin.id, pid, collaboration.id);
  await createDocumentVersion(admin.id, pid, collaboration.id, { requestId: randomUUID(), expectedRevision: detail.revision, label: "设计说明 V2（演示）" });
  const anchor = detail.content.content![2];
  const comment = await addDocumentComment(teacher.id, pid, collaboration.id, { requestId: randomUUID(), blockId: anchor.attrs!.id, quote: "新建任务、添加检查项、提交成果", body: "【演示段落反馈】这里需要说明成果退回后的下一步。" });
  await addDocumentComment(student.id, pid, collaboration.id, { requestId: randomUUID(), replyToId: comment.id, body: "【演示回复】已把重交说明写在需求报告 V2，请老师复核。" });
  const solved = await addDocumentComment(teacher.id, pid, collaboration.id, { requestId: randomUUID(), body: "【已解决反馈演示】角色入口清晰，可以继续完善。" });
  await changeDocumentComment(admin.id, pid, collaboration.id, { requestId: randomUUID(), commentId: solved.id, resolved: true });
  await changeDocumentTaskLink(admin.id, pid, collaboration.id, { requestId: randomUUID(), taskId: prototype.id });
  const minutes = await createDocument(admin.id, pid, { requestId: randomUUID(), title: "展示准备讨论纪要（演示）", folder: "汇报", content: content("模拟讨论纪要", ["此纪要是演示样例，不是实际召开会议的记录。", "约定：先由管理员查看进度，再由学生更新任务和提交材料，最后由教师反馈。", "待办：检查电脑浏览器、不同账号角色、文档协作与成果重交。"] ) });
  const testReport = await createDocument(student.id, pid, { requestId: randomUUID(), title: "阶段试用记录（演示材料）", folder: "测试", content: content("模拟试用记录", ["已记录：任务正常状态操作。", "待补充：无权限、空列表和断线重连检查。", "这里是样例材料，不作为真实验收或测试结论。"] ) });
  const privateDoc = await createDocument(student.id, pid, { requestId: randomUUID(), title: "学生个人草稿（权限演示）", folder: "设计", visibility: "private", content: content("个人草稿权限演示", ["默认只有演示学生可以看到此文档。管理员和教师不会因此自动获得正文权限。"] ) });
  const readOnly = await createDocument(admin.id, pid, { requestId: randomUUID(), title: "演示须知（只读授权）", folder: "汇报", content: content("课堂演示须知", ["公开课堂演示前请保存已修改的内容。", "此文档设置为阅读权限，用于展示权限差异。", "页面中的任务与成果均为模拟数据，不代表真实课程进展。"] ) });
  await updateDocument(admin.id, pid, readOnly.id, { requestId: randomUUID(), expectedRevision: readOnly.revision, defaultPermission: "read" });
  const trash = await createDocument(admin.id, pid, { requestId: randomUUID(), title: "可恢复的旧设计草稿（演示）", folder: "设计", content: content("回收站恢复样例", ["课堂演示时可从回收站恢复此文档。"] ) });
  await trashDocument(admin.id, pid, trash.id, { requestId: randomUUID(), expectedRevision: trash.revision });
  const docUrl = (id: string) => `${base}/documents/${id}`;
  progress("deliverables-and-references");
  const original = { title: "需求分析报告（版本与重交演示）", type: "report" as const, description: "【演示 V1】明确了角色和正常流程，异常分支尚未完善。", milestoneId: stages[0].id, url: docUrl(reportV1.id) };
  let historical = await createDeliverableDraft(student.id, pid, { ...original, requestId: randomUUID() });
  const v1 = await submitDeliverable(student.id, pid, historical.id, { requestId: randomUUID(), expectedRevision: historical.revision });
  const returned = await reviewDeliverable(teacher.id, pid, historical.id, { requestId: randomUUID(), versionId: v1.versionId, decision: "changes_requested", comment: "【演示反馈】请补充异常和重交流程，保留旧版本。" });
  const feedbackTask = await createTaskFromFeedback(student.id, pid, returned.feedback.id, { requestId: randomUUID(), title: "补充异常与成果重交流程（反馈任务演示）", assigneeId: student.id, dueDate: day(2), priority: "high" });
  historical = await startDeliverableRevision(student.id, pid, historical.id, { requestId: randomUUID(), expectedRevision: returned.deliverable.revision });
  historical = await updateDeliverableDraft(student.id, pid, historical.id, { ...original, url: docUrl(reportV2.id), description: "【演示 V2】根据教师反馈补充异常与成果重交流程，旧提交和反馈保留。", expectedRevision: historical.revision });
  const v2 = await submitDeliverable(student.id, pid, historical.id, { requestId: randomUUID(), expectedRevision: historical.revision });
  await reviewDeliverable(teacher.id, pid, historical.id, { requestId: randomUUID(), versionId: v2.versionId, decision: "approved", comment: "【演示验收】本样例已补齐所要求的流程。" });
  const pending = await createDeliverableDraft(student.id, pid, { requestId: randomUUID(), title: "交互流程说明（待教师审核演示）", type: "report", description: "可以由演示教师现场通过或退回这份材料。", milestoneId: stages[1].id, url: docUrl(collaboration.id) });
  await submitDeliverable(student.id, pid, pending.id, { requestId: randomUUID(), expectedRevision: pending.revision });
  const needsChange = await createDeliverableDraft(student.id, pid, { requestId: randomUUID(), title: "阶段试用总结（待修改演示）", type: "report", description: "用于展示学生收到反馈后开始新草稿并重新提交。", milestoneId: stages[2].id, url: docUrl(testReport.id) });
  const changeVersion = await submitDeliverable(student.id, pid, needsChange.id, { requestId: randomUUID(), expectedRevision: needsChange.revision });
  await reviewDeliverable(teacher.id, pid, needsChange.id, { requestId: randomUUID(), versionId: changeVersion.versionId, decision: "changes_requested", comment: "【演示反馈】请增加断线重连与权限边界记录，再提交新版本。" });
  const drafts = [];
  for (const [type, title] of [["presentation", "展示 PPT 草稿（演示）"], ["video", "展示视频草稿（演示）"]] as const) drafts.push(await createDeliverableDraft(student.id, pid, { requestId: randomUUID(), title, type, description: "这是登记表单演示，尚未填写真实材料网址；正式提交前请替换为自己的可访问链接。", url: "", milestoneId: stages[3].id }));
  const meeting = await createProjectReference(admin.id, pid, { requestId: randomUUID(), title: "展示准备讨论（演示纪要）", type: "meeting", url: docUrl(minutes.id), minutesUrl: docUrl(minutes.id), meetingDate: today, participantIds: accounts.map(a => a.id), milestoneId: stages[1].id, note: "模拟会议记录，展示纪要关联；不是已举行的真实会议，不填写虚构录制网址。" });
  await createProjectReference(student.id, pid, { requestId: randomUUID(), title: "交互设计资料（演示）", type: "document", url: docUrl(collaboration.id), note: "同项目真实可打开的演示文档。" });
  await createProjectReference(admin.id, pid, { requestId: randomUUID(), title: "AgileCampus 团队代码仓库", type: "other", url: "https://github.com/yc-wzx/agilecampus", note: "外部链接访问取决于当前网络，可先展示站内文档。" });
  await linkTaskMaterial(student.id, pid, prototype.id, { requestId: randomUUID(), kind: "resource", sourceId: meeting.id });
  await linkTaskMaterial(student.id, pid, prototype.id, { requestId: randomUUID(), kind: "deliverable", sourceId: v2.versionId });
  await publishAnnouncement(teacher.id, pid, { requestId: randomUUID(), title: "课堂演示操作说明（置顶模拟公告）", body: "本团队仅用于功能展示。顺序：管理员组织项目，学生完成任务和提交成果，教师审阅并反馈。真实 AI 尚未配置，本次使用规则规划。所有进度均为模拟数据。", isPinned: true });
  await publishAnnouncement(admin.id, pid, { requestId: randomUUID(), title: "演示前检查（模拟公告）", body: "准备三个独立浏览器账号；先保存文档，再展示版本恢复。删除练习使用专用任务和阶段。", isPinned: false });
  const removed = await createTask(admin.id, pid, { title: "已删除任务的通知来源示例（演示）", assigneeId: student.id }); await deleteTask(admin.id, removed.id);
  progress("schedule-and-rule-plan");
  for (const actor of accounts) {
    const prefs = await getMySchedule(actor.id);
    await saveMyPreferences(actor.id, { requestId: randomUUID(), expectedRevision: prefs.revision, preferences: { workStart: "18:00", workEnd: "22:00", days: [0,1,2,3,4,5,6], dailyMinutes: 180, blockMinutes: 45, bufferMinutes: 15 } });
    const eventName = actor.role === "student" ? "交互设计课程（演示）" : actor.role === "teacher" ? "课程答疑时段（演示）" : "项目讨论时段（演示）";
    await importMySchedule(actor.id, { requestId: randomUUID(), source: "manual", events: [{ title: eventName, startAt: localInstant(today, "14:05").toISOString(), endAt: localInstant(today, "15:45").toISOString(), shareBusy: true }, { title: "私人日程内容（演示、不共享）", startAt: localInstant(day(1), "10:00").toISOString(), endAt: localInstant(day(1), "11:00").toISOString(), shareBusy: false }] });
    const state = await getMySchedule(actor.id); await saveScheduleSharing(actor.id, { requestId: randomUUID(), expectedRevision: state.sharingRevision, teamIds: [team.id], shareWorkPlans: actor.role === "student" });
  }
  const plan = await generatePersonalPlan(student.id, pid, { requestId: randomUUID(), startDate: today, days: 7, mode: "rules", goal: "一周内完善通知文案与个人规划交互（演示）", selections: [{ taskId: planningTask.id, minutes: 135 }, { taskId: accessibility.id, minutes: 90 }] });
  await changePersonalPlan(student.id, pid, plan.id, { requestId: randomUUID(), expectedRevision: plan.revision, action: "confirm" });
  await importMySchedule(student.id, { requestId: randomUUID(), source: "emergency", events: [{ title: "临时事务（演示、具体原因私有）", startAt: localInstant(day(1), "19:05").toISOString(), endAt: localInstant(day(1), "20:15").toISOString(), shareBusy: true }] });
  const activeResource = await createResourceUsage(student.id, team.id, { resourceName: "讨论室 A（演示登记）", purpose: "课堂演示操作练习", startTime: localInstant(today, "08:00") });
  const pastResource = await createResourceUsage(admin.id, team.id, { resourceName: "测试电脑（已结束演示）", purpose: "模拟资源占用记录", startTime: localInstant(day(-1), "09:00") }); await endResourceUsage(admin.id, pastResource.id);
  progress("archived-project-and-checks");
  const archive = await createProject(admin.id, team.id, { requestId: randomUUID(), name: "课程归档示例（模拟数据）", templateId: "blank", description: "用于展示归档筛选、只读项目与教师多项目总览。", startDate: day(-21), endDate: day(-7) });
  const archiveTask = await createTask(admin.id, archive.id, { title: "归档成果整理（演示）", assigneeId: student.id }); await updateTask(student.id, archiveTask.id, { status: "done", completionNote: "模拟归档记录。" });
  await createDocument(admin.id, archive.id, { requestId: randomUUID(), title: "归档项目说明（只读演示）", content: content("归档项目示例", ["这是模拟归档项目；可查看旧材料，不允许继续编辑项目文档。"] ) });
  await updateProject(admin.id, archive.id, { status: "archived" });
  for (const actor of accounts) { const messages = await listMyNotifications(actor.id); if (messages.items.length > 1) await markNotificationRead(actor.id, messages.items.at(-1)!.id); }
  const shared = await getTeamAvailability(teacher.id, team.id);
  if (JSON.stringify(shared).includes("私人日程内容") || JSON.stringify(shared).includes("具体原因")) throw Error("Private schedule leaked into shared availability");
  const teacherDocument = await getDocumentDetail(teacher.id, pid, collaboration.id);
  if (teacherDocument.permission !== "comment") throw Error("Teacher document permission differs from demo design");
  const summary = { accounts, team: { id: team.id, name: team.name, inviteCode: team.inviteCode }, project: { id: pid, name: project.name }, archiveId: archive.id, today,
    tasks: { prototype: prototype.id, blocked: blocked.id, overdue: overdue.id, testing: testing.id, accessibility: accessibility.id, planning: planningTask.id, deployment: deployment.id, unassigned: unassigned.id, removable: removableTask.id, children: [childA.id, childB.id], feedback: feedbackTask.taskId },
    iterations: { completed: completedRound.id, active: activeRound.id, planned: plannedRound.id }, removableMilestoneId: removableStage.id,
    documents: { collaboration: collaboration.id, reportV1: reportV1.id, reportV2: reportV2.id, minutes: minutes.id, testReport: testReport.id, private: privateDoc.id, readOnly: readOnly.id, trash: trash.id },
    deliverables: { history: historical.id, pending: pending.id, changesRequested: needsChange.id, drafts: drafts.map(d => d.id), versions: [v1.versionId, v2.versionId] },
    planId: plan.id, resourceId: activeResource.id, realAiConfigured: false };
  console.log("DEMO_RESULT=" + JSON.stringify(summary));
}

main().catch(async failure => {
  console.error(JSON.stringify({ demoSeedFailed: true, phase, errorType: failure instanceof Error ? failure.name : "UnknownError" }));
  // Only IDs created in this invocation are eligible for rollback; existing users/teams are never reset.
  if (teamId) await db.delete(teams).where(and(eq(teams.id, teamId), eq(teams.name, "唯笃队·课堂演示（模拟数据）")));
  for (const user of createdUsers) await db.delete(users).where(and(eq(users.id, user.id), eq(users.email, user.email)));
  process.exitCode = 1;
}).finally(async () => { await db.$client.end({ timeout: 5 }); });
