export type CalendarSource = "schedule" | "work" | "deadline";
type CalendarBase = {
  id: string;
  title: string;
  href: string;
  projectName?: string;
  stale?: boolean;
  done?: boolean;
};
export type CalendarEntry = CalendarBase & (
  | { when: "time"; source: "schedule" | "work"; startAt: string; endAt: string }
  | { when: "date"; source: "deadline"; date: string; kind: "task" | "milestone" | "project" }
  | { when: "range"; source: "deadline"; date: string; endDate: string; kind: "iteration" }
);
export type WorkspaceCalendar = {
  startDate: string;
  endDate: string;
  entries: CalendarEntry[];
  /** A capped source must never be interpreted as a complete availability view. */
  truncated: boolean;
};
