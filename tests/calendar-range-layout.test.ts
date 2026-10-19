import { describe, expect, it } from "vitest";
import { rangeLayout } from "@/lib/calendar-dates";
import type { CalendarEntry } from "@/contracts/workspace-calendar";
const range = (id: string, date: string, endDate: string): CalendarEntry => ({ id, title: id, href: "/projects", when: "range", kind: "iteration", source: "deadline", date, endDate });
describe("calendar iteration bars", () => {
  it("clips spanning intervals once per week and keeps both inclusive boundary days", () => {
    const bars = rangeLayout([range("跨周", "2026-10-17", "2026-10-28"), range("周日", "2026-10-25", "2026-10-25"), range("过去", "2026-10-01", "2026-10-18")], "2026-10-19");
    expect(bars).toHaveLength(2);
    expect(bars[0]).toMatchObject({ start: 0, end: 6, continuesBefore: true, continuesAfter: true, lane: 0 });
    expect(bars[1]).toMatchObject({ start: 6, end: 6, lane: 1 });
  });
  it("places overlapping ranges in separate rows and reuses a row for the next non-overlapping range", () => {
    const bars = rangeLayout([range("a", "2026-10-19", "2026-10-20"), range("b", "2026-10-20", "2026-10-22"), range("c", "2026-10-21", "2026-10-23")], "2026-10-19");
    expect(bars.map(b => b.lane)).toEqual([0, 1, 0]);
  });
});
