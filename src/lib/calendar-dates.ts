import type { CalendarEntry } from "@/contracts/workspace-calendar";

export const DAY_MS = 86400000;
export function calendarDayOffset(day: string, n: number) {
  return new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
}
export function weekStart(day: string) {
  return calendarDayOffset(day, -((new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7));
}
export type CalendarView = "week" | "month" | "agenda";
export function calendarRange(day: string, view: CalendarView) {
  const startDate = view === "month" ? weekStart(`${day.slice(0, 7)}-01`) : weekStart(day);
  return { startDate, endDate: calendarDayOffset(startDate, view === "month" ? 41 : view === "agenda" ? 13 : 6) };
}
export function moveCalendar(day: string, view: CalendarView, direction: number) {
  if (view !== "month") return calendarDayOffset(day, direction * (view === "agenda" ? 14 : 7));
  // Anchor to the first; Oct 31 + one month must not jump into December.
  const date = new Date(`${day.slice(0, 7)}-01T00:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + direction);
  return date.toISOString().slice(0, 10);
}
export function dayStartMs(day: string) { return Date.parse(`${day}T00:00:00+08:00`); }
export function entriesOnDay(entries: CalendarEntry[], day: string) {
  const start = dayStartMs(day);
  return entries.filter(e => e.when === "time"
    ? Date.parse(e.startAt) < start + DAY_MS && Date.parse(e.endAt) > start
    : e.when === "range" ? e.date <= day && e.endDate >= day : e.date === day)
    .sort((a, b) => a.when === "time" && b.when === "time" ? Date.parse(a.startAt) - Date.parse(b.startAt) || a.id.localeCompare(b.id)
      : a.when === "time" ? 1 : b.when === "time" ? -1 : a.id.localeCompare(b.id));
}
export function calendarClock(instant: string) {
  return new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(instant));
}
/** Inclusive date ranges become one clipped bar per visible week, with no lost overlaps. */
export function rangeLayout(entries: CalendarEntry[], startDate: string, count = 7) {
  const endDate = calendarDayOffset(startDate, count - 1);
  const ranges = entries.filter(e => e.when === "range" && e.date <= endDate && e.endDate >= startDate)
    .sort((a, b) => a.when === "range" && b.when === "range" ? a.date.localeCompare(b.date) || b.endDate.localeCompare(a.endDate) || a.id.localeCompare(b.id) : 0);
  const laneEnds: number[] = [];
  return ranges.map(entry => {
    if (entry.when !== "range") throw new Error("Expected a date range");
    const start = Math.max(0, Math.round((Date.parse(entry.date) - Date.parse(startDate)) / DAY_MS));
    const end = Math.min(count - 1, Math.round((Date.parse(entry.endDate) - Date.parse(startDate)) / DAY_MS));
    let lane = laneEnds.findIndex(last => last < start);
    if (lane < 0) lane = laneEnds.length;
    laneEnds[lane] = end;
    return { entry, start, end, lane, continuesBefore: entry.date < startDate, continuesAfter: entry.endDate > endDate };
  });
}
export function entryTime(e: CalendarEntry, day: string) {
  if (e.when === "range") return `${e.date.slice(5)} — ${e.endDate.slice(5)} · 迭代`;
  if (e.when === "date") return `${e.kind === "task" ? "任务" : e.kind === "milestone" ? "里程碑" : "项目"}截止${e.done ? " · 已完成" : ""}`;
  const localDay = (value: string) => new Date(Date.parse(value) + 8 * 3600000).toISOString().slice(0, 10);
  const startDay = localDay(e.startAt), endDay = localDay(e.endAt);
  return `${startDay !== day ? `${startDay.slice(5)} ` : ""}${calendarClock(e.startAt)} — ${endDay !== day ? `${endDay.slice(5)} ` : ""}${calendarClock(e.endAt)}`;
}
export function dayLayout(entries: CalendarEntry[], day: string) {
  const start = dayStartMs(day);
  const timed = entriesOnDay(entries, day).filter(e => e.when === "time").map(e => ({
    entry: e, start: Math.max(0, (Date.parse(e.startAt) - start) / 60000),
    end: Math.min(1440, (Date.parse(e.endAt) - start) / 60000), lane: 0, lanes: 1,
  })).sort((a, b) => a.start - b.start || b.end - a.end || a.entry.id.localeCompare(b.entry.id));
  let group: typeof timed = [], laneEnds: number[] = [], groupEnd = -1;
  const finish = () => { group.forEach(e => { e.lanes = laneEnds.length; }); group = []; laneEnds = []; };
  for (const e of timed) {
    if (e.start >= groupEnd) finish();
    let lane = laneEnds.findIndex(end => end <= e.start);
    if (lane < 0) lane = laneEnds.length;
    e.lane = lane; laneEnds[lane] = e.end; group.push(e); groupEnd = Math.max(groupEnd, e.end);
  }
  finish();
  return timed;
}
