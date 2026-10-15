import { describe, expect, it } from "vitest";
import type { CalendarEntry } from "@/contracts/workspace-calendar";
import { calendarRange, dayLayout, entriesOnDay, entryTime, moveCalendar, weekStart } from "@/lib/calendar-dates";
const event = (id: string, start: string, end: string): CalendarEntry => ({ id, when: "time", source: "schedule", title: id, href: "/schedule", startAt: start, endAt: end });
describe("日历日期与布局", () => {
  it("一周从周一开始，跨年与月底导航不丢失月份", () => {
    expect(weekStart("2027-01-03")).toBe("2026-12-28");
    expect(calendarRange("2026-10-31", "month")).toEqual({ startDate: "2026-09-28", endDate: "2026-11-08" });
    expect(moveCalendar("2026-10-31", "month", 1)).toBe("2026-11-01");
    expect(calendarRange("2026-12-31", "agenda").endDate).toBe("2027-01-10");
  });
  it("日期节点不生成虚构时段，迭代包含起止日", () => {
    const node: CalendarEntry = { id: "task", title: "任务", when: "date", source: "deadline", kind: "task", date: "2026-10-15", href: "/" };
    const round: CalendarEntry = { id: "i", title: "迭代", when: "range", source: "deadline", kind: "iteration", date: "2026-10-14", endDate: "2026-10-15", href: "/" };
    expect(entriesOnDay([node, round], "2026-10-15")).toHaveLength(2);
    expect(entriesOnDay([node, round], "2026-10-16")).toHaveLength(0);
    expect(dayLayout([node, round], "2026-10-15")).toHaveLength(0);
  });
  it("凌晨跨日事件按北京时间切片，零点结束不会出现在次日", () => {
    const e = event("跨日", "2026-10-14T15:30:00Z", "2026-10-14T16:30:00Z");
    expect(dayLayout([e], "2026-10-14")[0]).toMatchObject({ start: 1410, end: 1440 });
    expect(dayLayout([e], "2026-10-15")[0]).toMatchObject({ start: 0, end: 30 });
    expect(entryTime(e, "2026-10-15")).toContain("10-14 23:30");
    const long = event("多日", "2026-10-13T10:00:00+08:00", "2026-10-16T11:00:00+08:00");
    expect(entryTime(long, "2026-10-15")).toBe("10-13 10:00 — 10-16 11:00");
    expect(entriesOnDay([event("零点", "2026-10-14T15:30:00Z", "2026-10-14T16:00:00Z")], "2026-10-15")).toHaveLength(0);
  });
  it("重叠事件并排，连续事件复用栏位，不遮挡另一条真实安排", () => {
    const list = [event("a", "2026-10-15T10:00:00+08:00", "2026-10-15T11:00:00+08:00"), event("b", "2026-10-15T10:30:00+08:00", "2026-10-15T11:30:00+08:00"), event("c", "2026-10-15T11:00:00+08:00", "2026-10-15T12:00:00+08:00"), event("d", "2026-10-15T12:00:00+08:00", "2026-10-15T13:00:00+08:00")];
    expect(dayLayout(list, "2026-10-15").map(e => [e.lane, e.lanes])).toEqual([[0, 2], [1, 2], [0, 2], [0, 1]]);
  });
});
