import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterEach,beforeEach,describe,expect,it,vi } from "vitest";
import { db } from "@/db";
import { users,personalScheduleEvents,personalWorkPlans,tasks } from "@/db/schema";
import { calendarConnections,calendarFeedTokens,calendarRemoteEvents } from "@/db/calendar-integrations-schema";
import { createTeam,joinTeam } from "@/lib/team";
import { createProject } from "@/lib/project";
import { createTask } from "@/lib/task";
import { importMySchedule,changeMyEvent,getMySchedule } from "@/lib/schedule/store";
import { moveCalendarArrangement } from "@/lib/schedule/calendar-move";
import { generatePersonalPlan,changePersonalPlan } from "@/lib/schedule/planner";
import { addCalendarConnection,createCalendarFeed,getCalendarFeed,refreshCalendarConnection,pushCalendarConnectionEvent,removeCalendarConnection,revokeCalendarFeed,runCalendarRefreshBatch } from "@/lib/schedule/calendar-connections";
import { fetchExternalCalendar,parseDavResources,parseRemoteCalendar,pushCaldavEvent,serializeCalendarEvent,caldavResourceUrl } from "@/lib/schedule/caldav";
import { sealCalendarSecret,openCalendarSecret } from "@/lib/schedule/calendar-crypto";
import { getAccountProjectViews,saveAccountProjectViews } from "@/lib/saved-project-views-store";
import { getWorkspaceCalendar } from "@/lib/workspace-calendar";
import { safeFetch } from "@/lib/safe-fetch";
import { isCalendarWriteOriginAllowed } from "@/lib/calendar-http";
import { resetDb } from "./helpers";
vi.mock("@/lib/safe-fetch",() => ({ safeFetch: vi.fn() }));
const network = vi.mocked(safeFetch);
const collection = "https://calendar.example.com/me/course/";
const event = { title: "私人安排",startAt: "2026-10-20T10:00:00Z",endAt: "2026-10-20T11:00:00Z" };
const range = { startDate: "2026-10-20",endDate: "2026-10-26" };
const response = (body: string,status = 200,headers: Record<string,string> = {}) => ({ body: Buffer.from(body),status,headers,url: collection });
const ics = (title = "课程",start = "20261020T100000Z",extra = "") => `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:course1@example.com\r\nDTSTART:${start}\r\nDTEND:20261020T110000Z\r\nSUMMARY:${title}\r\n${extra}END:VEVENT\r\nEND:VCALENDAR\r\n`;
const dav = (content: string,etag = '"v1"') => `<?xml version="1.0"?><d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:response><d:href>/me/course/event.ics</d:href><d:propstat><d:prop><d:getetag>${etag}</d:getetag><c:calendar-data><![CDATA[${content}]]></c:calendar-data></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response></d:multistatus>`;
beforeEach(async () => { vi.useFakeTimers({ toFake: ["Date"] });vi.setSystemTime(new Date("2026-10-20T00:00:00Z"));process.env.CALENDAR_ENCRYPTION_KEY = "ab".repeat(32);network.mockReset();await resetDb(); });
afterEach(() => { vi.useRealTimers(); });
async function scene() {
  const [admin,student,outsider] = await db.insert(users).values(["owner","student","outside"].map(name => ({ name,email: `${name}@calendar-extension.test`,passwordHash: "fixture" }))).returning();
  const team = await createTeam(admin.id,"日历扩展团队");await joinTeam(student.id,team.inviteCode);
  const project = await createProject(admin.id,team.id,{ name: "扩展项目",endDate: "2026-11-01" });
  return { admin,student,outsider,team,project };
}
async function addEvent(user: string,value = event) { await importMySchedule(user,{ requestId: randomUUID(),source: "manual",events: [value] });return (await getMySchedule(user,{ startDate: range.startDate,endDate: range.endDate })).items[0]; }
async function connection(user: string,kind: "ics" | "caldav" = "ics") { return addCalendarConnection(user,{ kind,name: "课程日历",url: kind === "ics" ? "https://calendar.example.com/private.ics?secret=token" : collection,username: kind === "caldav" ? "me" : "",password: kind === "caldav" ? "app-password" : "",consent: true }); }

describe("CalDAV / ICS 的真实协议边界",() => {
  it("CF反向代理允许已配置站点Origin，拒绝外域和伪造近似域名",() => {
    const configured = "https://weidu-agilecampus.pw";
    expect(isCalendarWriteOriginAllowed(configured,"http://127.0.0.1:3000",configured)).toBe(true);
    expect(isCalendarWriteOriginAllowed("http://localhost:3102","http://localhost:3102",configured)).toBe(true);
    expect(isCalendarWriteOriginAllowed("https://attacker.example","http://127.0.0.1:3000",configured)).toBe(false);
    expect(isCalendarWriteOriginAllowed("https://weidu-agilecampus.pw.attacker.example","http://127.0.0.1:3000",configured)).toBe(false);
    expect(isCalendarWriteOriginAllowed("null","http://127.0.0.1:3000",configured)).toBe(false);
  });
  it("解析具名空间、CDATA、版本号并限制资源集合",() => {
    expect(parseDavResources(dav(ics()),collection)).toEqual([{ href: `${collection}event.ics`,etag: '"v1"',content: ics().replace(/\r\n/g,"\n") }]);
    expect(parseDavResources('<d:multistatus xmlns:d="DAV:"/>',collection)).toEqual([]);
    expect(parseDavResources(dav(ics("A &amp; B"),"&quot;v1&quot;"),collection)[0]).toMatchObject({ etag: '"v1"',content: expect.stringContaining("SUMMARY:A &amp; B") });
    expect(() => caldavResourceUrl(collection,"https://other.example.com/steal")).toThrow("集合");
    expect(() => caldavResourceUrl(collection,"../other.ics")).toThrow("集合");
    expect(() => parseDavResources('<!DOCTYPE foo [<!ENTITY x SYSTEM "file:///secret">]><multistatus/>',collection)).toThrow("格式");
    expect(() => parseDavResources('<d:multistatus xmlns:d="DAV:"><d:response><d:href>/me/course/event.ics</d:href><d:propstat><d:status>HTTP/1.1 403 Forbidden</d:status></d:propstat></d:response></d:multistatus>',collection)).toThrow("原有日程已保留");
  });
  it("REPORT 使用 Basic 应用密码和时间范围；不发送跨站重定向",async () => {
    network.mockResolvedValue(response(dav(ics()),207));
    const rows = await fetchExternalCalendar("caldav",collection,range,{ username: "me",password: "app-password" });
    expect(rows).toHaveLength(1);expect(Date.parse(rows[0].event.startAt)).toBe(Date.parse(event.startAt));
    expect(network.mock.calls[0][1]).toMatchObject({ method: "REPORT",redirects: 0,headers: { Depth: "1",Authorization: `Basic ${Buffer.from("me:app-password").toString("base64")}` } });
    expect(network.mock.calls[0][1]?.body).toContain('start="20261019T160000Z"');
  });
  it("普通循环按北京时间展开，取消日程不导入",async () => {
    const recurring = ics("课程","20261020T100000Z","RRULE:FREQ=DAILY;COUNT=3\r\n");
    expect(await parseRemoteCalendar(recurring,range)).toHaveLength(3);
    expect(await parseRemoteCalendar(ics("取消","20261020T100000Z","STATUS:CANCELLED\r\n"),range)).toEqual([]);
    await expect(parseRemoteCalendar(ics("非法","20261020T100000Z","RRULE:FREQ=SECONDLY;COUNT=999999\r\n"),range)).rejects.toThrow("仅支持");
  });
  it("PUT 用 If-None-Match 创建、If-Match 更新；412绝不覆盖",async () => {
    network.mockResolvedValueOnce(response("",201,{ etag: '"one"' })).mockResolvedValueOnce(response("",412));
    const created = await pushCaldavEvent(collection,{ username: "me",password: "app" },"own@weidu",event);
    expect(created.etag).toBe('"one"');expect(network.mock.calls[0][1]?.headers?.["If-None-Match"]).toBe("*");
    await expect(pushCaldavEvent(collection,{ username: "me",password: "app" },"own@weidu",event,created)).rejects.toThrow("已经更新");
    expect(network.mock.calls[1][1]?.headers?.["If-Match"]).toBe('"one"');
    await expect(pushCaldavEvent(collection,{ username: "me",password: "app" },"own@weidu",event,{ href: created.href,etag: null })).rejects.toThrow("版本标识");
  });
  it("输出正确折行和转义，保留中文内容和UTC时间",async () => {
    const content = serializeCalendarEvent("own@weidu",{ ...event,title: "中文,".repeat(30) });
    expect(content.split("\r\n").every(s => Buffer.byteLength(s) <= 75)).toBe(true);
    const rows = await parseRemoteCalendar(content,range);expect(rows[0].event.title).toBe("中文,".repeat(30));
  });
  it("日历密钥按账号和用途隔离",() => {
    const sealed = sealCalendarSecret("owner","password");expect(sealed).not.toContain("password");expect(openCalendarSecret("owner",sealed)).toBe("password");expect(() => openCalendarSecret("other",sealed)).toThrow("解密");
  });
});
describe("持续订阅、独立只读token、显式双向发布",() => {
  it("连接URL与凭据加密；读取同步更新和取消，只处理来源副本",async () => {
    const s = await scene(),c = await connection(s.student.id);
    const [stored] = await db.select().from(calendarConnections).where(eq(calendarConnections.id,c.id));
    expect(JSON.stringify(stored)).not.toContain("secret=token");
    network.mockResolvedValueOnce(response(ics()));expect(await refreshCalendarConnection(s.student.id,c.id)).toMatchObject({ added: 1 });
    await addEvent(s.student.id,{ ...event,title: "本人安排",startAt: "2026-10-21T10:00:00Z",endAt: "2026-10-21T11:00:00Z" });
    vi.setSystemTime(Date.now()+16000);network.mockResolvedValueOnce(response(ics("课程更新")));expect(await refreshCalendarConnection(s.student.id,c.id)).toMatchObject({ updated: 1 });
    vi.setSystemTime(Date.now()+16000);network.mockResolvedValueOnce(response("BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR\r\n"));expect(await refreshCalendarConnection(s.student.id,c.id)).toMatchObject({ removed: 1 });
    expect((await getMySchedule(s.student.id,{ startDate: range.startDate,endDate: range.endDate })).items.map(e => e.title)).toEqual(["本人安排"]);
  });
  it("损坏或不可达来源保留已登记日程和私密性",async () => {
    const s = await scene(),c = await connection(s.student.id);network.mockResolvedValueOnce(response(ics()));await refreshCalendarConnection(s.student.id,c.id);
    vi.setSystemTime(Date.now()+16000);network.mockRejectedValueOnce(new Error("https://host/?password=secret"));await expect(refreshCalendarConnection(s.student.id,c.id)).rejects.toThrow("原有日程已保留");
    const [stored] = await db.select().from(calendarConnections).where(eq(calendarConnections.id,c.id));expect(stored.lastError).not.toContain("secret");
    expect((await getMySchedule(s.student.id,{ startDate: range.startDate,endDate: range.endDate })).items).toHaveLength(1);
    await expect(refreshCalendarConnection(s.outsider.id,c.id)).rejects.toThrow();
  });
  it("读取前认领尝试，失败节流且不伪造成功时间",async () => {
    const s = await scene(),c = await connection(s.student.id);network.mockResolvedValue(response("unavailable",503));
    await expect(refreshCalendarConnection(s.student.id,c.id)).rejects.toThrow("读取失败");
    const [stored] = await db.select().from(calendarConnections).where(eq(calendarConnections.id,c.id));expect(stored.lastAttemptAt).not.toBeNull();expect(stored.lastSyncedAt).toBeNull();
    expect(await refreshCalendarConnection(s.student.id,c.id)).toMatchObject({ skipped: true });expect(network).toHaveBeenCalledTimes(1);
  });
  it("失败日历不会长期占据批次队首，后台每轮最多12个连接",async () => {
    const s = await scene();
    for (const [actor,count] of [[s.admin.id,5],[s.student.id,5],[s.outsider.id,3]] as const) for (let i = 0;i < count;i++) await connection(actor);
    network.mockResolvedValue(response("unavailable",503));
    expect(await runCalendarRefreshBatch()).toMatchObject({ failed: 12 });expect(network).toHaveBeenCalledTimes(12);
    await runCalendarRefreshBatch();expect(network).toHaveBeenCalledTimes(13);
    const rows = await db.select().from(calendarConnections);expect(rows.every(r => r.lastAttemptAt !== null && r.lastSyncedAt === null)).toBe(true);
  });
  it("导入来源只读，断开后可明确保留为本人手动安排",async () => {
    const s = await scene(),c = await connection(s.student.id);network.mockResolvedValueOnce(response(ics()));await refreshCalendarConnection(s.student.id,c.id);
    const [row] = (await getMySchedule(s.student.id,{ startDate: range.startDate,endDate: range.endDate })).items;
    await expect(changeMyEvent(s.student.id,row.id,{ requestId: randomUUID(),expectedRevision: row.revision,event: { ...event,title: "篡改" } })).rejects.toThrow("持续订阅");
    await changeMyEvent(s.student.id,row.id,{ requestId: randomUUID(),expectedRevision: row.revision,event: { title: row.title,startAt: row.startAt,endAt: row.endAt,shareBusy: true } });
    expect((await db.select().from(personalScheduleEvents).where(eq(personalScheduleEvents.id,row.id)))[0].shareBusy).toBe(true);
    await removeCalendarConnection(s.student.id,c.id,false);expect((await getMySchedule(s.student.id,{ startDate: range.startDate,endDate: range.endDate })).items[0].source).toBe("manual");
  });
  it("只读订阅默认隐藏名称，token仅哈希存库且可立即撤销",async () => {
    const s = await scene();await addEvent(s.student.id);const feed = await createCalendarFeed(s.student.id,{ label: "本人电脑",consent: true });
    const [stored] = await db.select().from(calendarFeedTokens).where(eq(calendarFeedTokens.id,feed.id));expect(JSON.stringify(stored)).not.toContain(feed.token);
    const body = await getCalendarFeed(feed.token);expect(body).toContain("SUMMARY:忙碌");expect(body).not.toContain("私人安排");
    await expect(revokeCalendarFeed(s.outsider.id,feed.id)).rejects.toThrow();await revokeCalendarFeed(s.student.id,feed.id);await expect(getCalendarFeed(feed.token)).rejects.toThrow();
  });
  it("手动日程显式推送，外部更新回流；两端都修改时保留本地并报告冲突",async () => {
    const s = await scene(),c = await connection(s.student.id,"caldav"),local = await addEvent(s.student.id);
    network.mockResolvedValueOnce(response("",201,{ etag: '"one"' }));await pushCalendarConnectionEvent(s.student.id,c.id,{ eventId: local.id,expectedRevision: local.revision,consent: true });
    const [mapping] = await db.select().from(calendarRemoteEvents).where(eq(calendarRemoteEvents.eventId,local.id));
    const makeDav = (title: string) => dav(serializeCalendarEvent(mapping.uid,{ ...event,title }), '"two"').replace("/me/course/event.ics",new URL(mapping.href).pathname);
    network.mockResolvedValueOnce(response(makeDav("外部更改"),207));expect(await refreshCalendarConnection(s.student.id,c.id)).toMatchObject({ updated: 1 });
    const [latest] = await db.select().from(personalScheduleEvents).where(eq(personalScheduleEvents.id,local.id));
    await changeMyEvent(s.student.id,local.id,{ requestId: randomUUID(),expectedRevision: latest.revision,event: { ...event,title: "本地更改" } });
    vi.setSystemTime(Date.now()+16000);network.mockResolvedValueOnce(response(makeDav("外部再次更改"),207));const result = await refreshCalendarConnection(s.student.id,c.id);expect(result.conflicts[0]).toContain("两端均有修改");
    expect((await db.select().from(personalScheduleEvents).where(eq(personalScheduleEvents.id,local.id)))[0].title).toBe("本地更改");
  });
});
describe("跨设备常用筛选",() => {
  it("同账号项目持久化，剔除任务ID和未知查询；他人无法读取",async () => {
    const s = await scene(),query = "view=list&sort=due&task=secret&token=secret&priority=high";
    const saved = await saveAccountProjectViews(s.student.id,s.project.id,{ expectedRevision: 0,views: [{ id: randomUUID(),name: "我的高优先任务",query }] });
    expect(saved.revision).toBe(1);expect(saved.views[0].query).not.toContain("secret");expect((await getAccountProjectViews(s.student.id,s.project.id)).views).toEqual(saved.views);
    expect((await getAccountProjectViews(s.admin.id,s.project.id)).views).toEqual([]);await expect(getAccountProjectViews(s.outsider.id,s.project.id)).rejects.toThrow();
  });
  it("并发更新不会覆盖另一设备，不接受同名筛选",async () => {
    const s = await scene();await saveAccountProjectViews(s.student.id,s.project.id,{ expectedRevision: 0,views: [] });
    await expect(saveAccountProjectViews(s.student.id,s.project.id,{ expectedRevision: 0,views: [] })).rejects.toThrow("另一设备");
    await expect(saveAccountProjectViews(s.student.id,s.project.id,{ expectedRevision: 1,views: [{ id: "one",name: "同名",query: "" },{ id: "two",name: "同名",query: "" }] })).rejects.toThrow("名称");
  });
});
describe("日历调整与冲突确认",() => {
  it("预览不修改、确认与重试只改一次；保持时长和隐私范围",async () => {
    const s = await scene(),local = await addEvent(s.student.id),input = { kind: "event",id: local.id,expectedRevision: local.revision,startAt: "2026-10-21T10:00:00Z",requestId: randomUUID() };
    expect(await moveCalendarArrangement(s.student.id,input)).toMatchObject({ saved: false,conflicts: [],endAt: "2026-10-21T11:00:00.000Z" });
    expect((await db.select().from(personalScheduleEvents).where(eq(personalScheduleEvents.id,local.id)))[0].startAt.toISOString()).toBe("2026-10-20T10:00:00.000Z");
    const result = await moveCalendarArrangement(s.student.id,{ ...input,commit: true });expect(await moveCalendarArrangement(s.student.id,{ ...input,commit: true })).toEqual(result);
    const [updated] = await db.select().from(personalScheduleEvents).where(eq(personalScheduleEvents.id,local.id));expect(updated.revision).toBe(local.revision+1);expect(updated.shareBusy).toBe(false);
  });
  it("拒绝占用时段、他人安排、过期版本和导入日程",async () => {
    const s = await scene(),local = await addEvent(s.student.id);await addEvent(s.student.id,{ title: "课程冲突",startAt: "2026-10-21T10:00:00Z",endAt: "2026-10-21T11:00:00Z" });
    const input = { kind: "event",id: local.id,expectedRevision: local.revision,startAt: "2026-10-21T10:00:00Z",requestId: randomUUID() };
    expect((await moveCalendarArrangement(s.student.id,input)).conflicts[0]).toContain("冲突");await expect(moveCalendarArrangement(s.student.id,{ ...input,commit: true })).rejects.toThrow("冲突");
    await expect(moveCalendarArrangement(s.outsider.id,input)).rejects.toThrow();await expect(moveCalendarArrangement(s.student.id,{ ...input,expectedRevision: 999 })).rejects.toThrow("变化");
    await db.update(personalScheduleEvents).set({ source: "ics" }).where(eq(personalScheduleEvents.id,local.id));await expect(moveCalendarArrangement(s.student.id,input)).rejects.toThrow("只读");
  });
  it("工作段调整不修改任务截止日期，并拒绝超出可投入时间",async () => {
    const s = await scene(),task = await createTask(s.admin.id,s.project.id,{ title: "开发任务",assigneeId: s.student.id,dueDate: "2026-10-26" });
    await addEvent(s.student.id,{ title: "课后缓冲",startAt: "2026-10-23T09:30:00Z",endAt: "2026-10-23T10:00:00Z" });
    const draft = await generatePersonalPlan(s.student.id,s.project.id,{ requestId: randomUUID(),startDate: range.startDate,days: 7,mode: "rules",goal: "推进",selections: [{ taskId: task.id,minutes: 60 }] });
    await changePersonalPlan(s.student.id,s.project.id,draft.id,{ requestId: randomUUID(),expectedRevision: 1,action: "confirm" });
    const [plan] = await db.select().from(personalWorkPlans).where(eq(personalWorkPlans.id,draft.id));
    const input = { kind: "work",id: plan.id,index: 0,expectedRevision: plan.revision,startAt: "2026-10-21T10:00:00Z",requestId: randomUUID() };
    expect((await moveCalendarArrangement(s.student.id,input)).conflicts).toEqual([]);await moveCalendarArrangement(s.student.id,{ ...input,commit: true });
    expect((await db.select().from(tasks).where(eq(tasks.id,task.id)))[0].dueDate).toBe("2026-10-26");
    expect((await moveCalendarArrangement(s.student.id,{ ...input,expectedRevision: plan.revision+1,startAt: "2026-10-22T01:00:00Z",requestId: randomUUID() })).conflicts).toContain("超出已设置的可投入时间");
    expect((await moveCalendarArrangement(s.student.id,{ ...input,expectedRevision: plan.revision+1,startAt: "2026-10-23T10:00:00Z",requestId: randomUUID() })).conflicts.join(" ")).toContain("课后缓冲");
    const calendar = await getWorkspaceCalendar(s.student.id,range);expect(calendar.entries.find(e => e.source === "work")?.move?.kind).toBe("work");
  });
  it("已完成任务的旧工作段不再阻止本人日程改期",async () => {
    const s = await scene(),task = await createTask(s.admin.id,s.project.id,{ title: "已完成的工作",assigneeId: s.student.id,dueDate: "2026-10-26" });
    const draft = await generatePersonalPlan(s.student.id,s.project.id,{ requestId: randomUUID(),startDate: range.startDate,days: 7,mode: "rules",goal: "推进",selections: [{ taskId: task.id,minutes: 30 }] });
    await changePersonalPlan(s.student.id,s.project.id,draft.id,{ requestId: randomUUID(),expectedRevision: 1,action: "confirm" });
    await db.update(tasks).set({ status: "done" }).where(eq(tasks.id,task.id));
    const local = await addEvent(s.student.id,{ ...event,startAt: "2026-10-21T10:00:00Z",endAt: "2026-10-21T10:30:00Z" });
    const preview = await moveCalendarArrangement(s.student.id,{ kind: "event",id: local.id,expectedRevision: local.revision,startAt: "2026-10-20T10:00:00Z",requestId: randomUUID() });
    expect(preview.conflicts).toEqual([]);
  });
});
