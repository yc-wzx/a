import type { DocumentNode } from "@/contracts/documents";

const paragraph = (text: string): DocumentNode => ({ type: "paragraph", content: [{ type: "text", text }] });
const heading = (text: string, level = 2): DocumentNode => ({ type: "heading", attrs: { level }, content: [{ type: "text", text }] });
const checklist = (...items: string[]): DocumentNode => ({ type: "taskList", content: items.map(text => ({ type: "taskItem", attrs: { checked: false }, content: [paragraph(text)] })) });
export const courseDocumentTemplates = [
  { id: "requirements", title: "需求说明", folder: "调研", description: "明确用户、问题和本轮范围", content: [
    heading("项目需求说明", 1), heading("用户与使用场景"), paragraph("说明主要用户，以及他们在什么情况下使用此功能。"),
    heading("问题与证据"), paragraph("记录访谈、问卷或观察得到的问题，并链接原始资料。"),
    heading("本轮功能范围"), checklist("写出本轮需要完成的功能", "说明暂不实现的内容"),
    heading("完成标准"), paragraph("用具体操作和预期结果描述功能怎样才算完成。"),
    heading("相关任务与待确认事项"), paragraph("在右侧任务面板关联对应任务，记录仍需确认的问题与负责人。"),
  ] },
  { id: "design", title: "设计评审", folder: "设计", description: "串联操作流程、方案与反馈", content: [
    heading("交互设计评审", 1), heading("设计目标"), paragraph("说明这次设计要解决的用户问题。"),
    heading("操作流程与原型"), paragraph("按入口、主要步骤、完成反馈描述流程，并插入原型链接或图片。"),
    heading("方案选择依据"), paragraph("说明关键交互为什么这样设计，有哪些方案进行了比较。"),
    heading("异常与空状态"), checklist("首次使用和没有数据时的引导", "输入错误、无权限与网络失败时的处理", "取消、返回和删除后的反馈"),
    heading("评审反馈与后续修改"), paragraph("请在对应段落添加评论；修改后标记已解决，并关联修改任务。"),
  ] },
  { id: "trial", title: "试用记录", folder: "测试", description: "记录真实操作、问题和修复复测", content: [
    heading("真实试用记录", 1), heading("试用信息"), paragraph("填写日期、网站版本、参与人数、电脑浏览器及网络环境。"),
    heading("试用场景"), paragraph("给参与者一个实际目标，记录他们完成目标的操作路径。"),
    heading("发现的问题"), paragraph("每条问题填写操作步骤、预期结果、实际结果、截图和影响程度。"),
    heading("修复与复测"), checklist("为问题建立任务并关联到本文档", "记录修复后的复测步骤和结果", "确认没有影响原有正常流程"),
    heading("结论与下一步"), paragraph("说明哪些问题已经解决，哪些还需处理及计划时间。"),
  ] },
  { id: "retrospective", title: "阶段复盘", folder: "汇报", description: "保留阶段成果、风险与下一轮计划", content: [
    heading("阶段复盘", 1), heading("阶段目标与实际完成"), paragraph("对照本阶段目标，链接已完成任务与成果材料。"),
    heading("演示材料"), paragraph("插入阶段展示的视频、PPT、原型或测试记录链接。"),
    heading("有效做法与遇到的问题"), paragraph("记录具体事例，说明哪些做法值得保留，哪些问题影响了进度。"),
    heading("下一轮行动"), checklist("确定优先处理的问题", "创建任务并明确负责人和期限", "确认团队可用时间与潜在风险"),
  ] },
];
/** Each create receives new nodes. Stable IDs are assigned by the server, never reused across documents. */
export function courseTemplateContent(id: string): DocumentNode | undefined {
  const template = courseDocumentTemplates.find(item => item.id === id);
  return template ? structuredClone({ type: "doc", content: template.content }) : undefined;
}
