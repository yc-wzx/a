"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, ListTodo, LockKeyhole, RefreshCw } from "lucide-react";
import Link from "next/link";
import { TaskLink } from "@/components/tasks/task-link";
import type { CalendarEntry, CalendarSource, WorkspaceCalendar } from "@/contracts/workspace-calendar";
import { calendarDayOffset, calendarRange, dayLayout, entriesOnDay, entryTime, moveCalendar, type CalendarView } from "@/lib/calendar-dates";
import "./workspace-calendar.css";

const sources: { key: CalendarSource; label: string }[] = [{ key: "schedule", label: "课程与日程" }, { key: "work", label: "工作安排" }, { key: "deadline", label: "截止节点" }];
const weekdays = ["一", "二", "三", "四", "五", "六", "日"];
const dayTitle = (day: string) => new Intl.DateTimeFormat("zh-CN", { timeZone: "UTC", month: "long", day: "numeric", weekday: "long" }).format(new Date(`${day}T00:00:00Z`));

function EntryLink({ entry, day, today, compact = false }: { entry: CalendarEntry; day: string; today: string; compact?: boolean }) {
  const overdue = entry.when === "date" && entry.date < today && !entry.done;
  return <TaskLink href={entry.href} className={`wc-entry wc-${entry.source}${entry.stale ? " wc-stale" : ""}${entry.done ? " wc-done" : ""}${overdue ? " wc-overdue" : ""}`} title={`${entry.title} · ${entryTime(entry, day)}${overdue ? " · 已逾期" : ""}${entry.stale ? " · 需要重新核对" : ""}`}>
    <span className="wc-entry-title">{entry.title}</span>
    {!compact && <span className="wc-entry-meta">{entryTime(entry, day)}{overdue ? " · 已逾期" : ""}</span>}
    {entry.stale && <span className="wc-entry-warning">需要重新核对</span>}
  </TaskLink>;
}

export function WorkspaceCalendarPanel({ today, taskVersion, taskCount, children }: { today: string; taskVersion: string; taskCount: number | null; children: ReactNode }) {
  const [tab, setTab] = useState<"calendar" | "tasks">("calendar"), [view, setView] = useState<CalendarView>("week"), [selected, setSelected] = useState(today), [anchor, setAnchor] = useState(today);
  const [enabled, setEnabled] = useState<CalendarSource[]>(["schedule", "work", "deadline"]), [reload, setReload] = useState(0);
  const weekScroll = useRef<HTMLDivElement>(null);
  const [result, setResult] = useState<{ key: string; data?: WorkspaceCalendar; error?: string }>({ key: "" });
  const range = calendarRange(anchor, view), requestKey = `${range.startDate}/${range.endDate}/${reload}/${taskVersion}`;
  useEffect(() => {
    if (tab !== "calendar") return;
    const controller = new AbortController();
    fetch(`/api/workspace/calendar?startDate=${range.startDate}&endDate=${range.endDate}`, { cache: "no-store", signal: controller.signal })
      .then(async response => {
        const body = await response.json();
        if (controller.signal.aborted) return;
        if (!response.ok || !body.ok) setResult({ key: requestKey, error: body.error || "日历暂时不可用，请重试" });
        else setResult({ key: requestKey, data: body.data });
      }).catch(error => { if (error.name !== "AbortError" && !controller.signal.aborted) setResult({ key: requestKey, error: "日历加载失败，请检查网络后重试" }); });
    return () => controller.abort();
  }, [tab, range.startDate, range.endDate, requestKey]);
  useEffect(() => {
    const refresh = () => { if (document.visibilityState === "visible") setReload(n => n + 1); };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => { window.removeEventListener("focus", refresh); document.removeEventListener("visibilitychange", refresh); };
  }, []);
  const data = result.key === requestKey ? result.data : undefined, loading = result.key !== requestKey, error = result.key === requestKey ? result.error : undefined;
  const entries = (data?.entries ?? []).filter(e => enabled.includes(e.source));
  const days = Array.from({ length: view === "month" ? 42 : view === "agenda" ? 14 : 7 }, (_, n) => calendarDayOffset(range.startDate, n));
  const dayEntries = entriesOnDay(entries, selected);
  const miniRange = calendarRange(anchor, "month");
  const miniDays = Array.from({ length: 42 }, (_, n) => calendarDayOffset(miniRange.startDate, n));
  const choose = (day: string) => { setSelected(day); if (day < range.startDate || day > range.endDate) setAnchor(day); };
  const move = (direction: number) => { const day = moveCalendar(anchor, view, direction); setAnchor(day); setSelected(day); };
  const changeView = (next: CalendarView) => { setAnchor(selected); setView(next); };
  const timed = days.flatMap(day => dayLayout(entries, day));
  const firstHour = Math.min(8, ...timed.map(e => Math.floor(e.start / 60))), lastHour = Math.max(22, ...timed.map(e => Math.ceil(e.end / 60)));
  const hourHeight = 52;
  useEffect(() => {
    if (view === "week" && data && weekScroll.current) weekScroll.current.scrollTop = Math.max(0, 8 - firstHour) * hourHeight;
  }, [view, data, firstHour]);
  return <section id="tasks" className="workspace-panel wc-panel scroll-mt-24" data-tour="workspace-tasks">
    <div className="wc-heading"><div><h2>我的工作</h2><span className="wc-subtitle">任务推进与个人时间安排</span></div><div className="wc-tabs" role="group" aria-label="我的工作视图">
      <button type="button" aria-pressed={tab === "tasks"} onClick={() => setTab("tasks")}><ListTodo size={15} aria-hidden />任务列表{taskCount != null && <span>{taskCount}</span>}</button>
      <button type="button" aria-pressed={tab === "calendar"} onClick={() => setTab("calendar")}><CalendarDays size={15} aria-hidden />日历</button>
    </div></div>
    {tab === "tasks" ? children : <div className="wc-body">
      <div className="wc-toolbar">
        <div className="wc-navigation"><button type="button" onClick={() => move(-1)} aria-label="上一时段"><ChevronLeft size={17} /></button><button type="button" onClick={() => move(1)} aria-label="下一时段"><ChevronRight size={17} /></button><button type="button" onClick={() => { setAnchor(today); setSelected(today); }}>今天</button><h3>{view === "month" ? `${anchor.slice(0, 4)} 年 ${Number(anchor.slice(5, 7))} 月` : `${range.startDate.slice(5)} — ${range.endDate.slice(5)}`}</h3></div>
        <div className="wc-tabs" role="group" aria-label="日历显示方式">{([{ key: "week", label: "周" }, { key: "month", label: "月" }, { key: "agenda", label: "事项" }] as const).map(v => <button key={v.key} type="button" onClick={() => changeView(v.key)} aria-pressed={view === v.key}>{v.label}</button>)}<button type="button" aria-label="刷新日历" onClick={() => setReload(n => n + 1)}><RefreshCw size={14} className={loading ? "animate-spin" : ""} /></button></div>
      </div>
      <div className="wc-source-row"><div className="wc-source-options" role="group" aria-label="日历内容筛选">{sources.map(s => <label key={s.key} className={`wc-source-${s.key}`}><input type="checkbox" checked={enabled.includes(s.key)} onChange={() => setEnabled(list => list.includes(s.key) ? list.filter(k => k !== s.key) : [...list, s.key])} />{s.label}</label>)}</div><span><LockKeyhole size={12} aria-hidden />个人安排仅本人可见 · 北京时间</span></div>
      {loading ? <p className="wc-state" role="status">正在读取日历…</p> : error ? <div className="wc-state wc-error" role="alert">{error}<button type="button" onClick={() => setReload(n => n + 1)}>重新加载</button></div> : <>
        {data?.truncated && <p className="wc-warning" role="status">当前范围记录较多，日历仅显示部分内容。请缩小到周视图，或进入原页面查看全部；不能据此判断空闲。</p>}
        <div className="wc-layout"><div className="wc-main">
          {view === "week" && <div className="wc-week-scroll" ref={weekScroll} tabIndex={0} role="region" aria-label="周日历，滚动查看全天安排"><div className="wc-week">
            <div className="wc-week-head"><span className="wc-axis-label">日期</span>{days.map((day, n) => <button key={day} type="button" aria-label={`选择 ${day}`} aria-pressed={selected === day} className={`${selected === day ? "wc-selected" : ""} ${day === today ? "wc-today" : ""}`} onClick={() => choose(day)}><span>周{weekdays[n]}</span><b>{Number(day.slice(8))}</b></button>)}</div>
            <div className="wc-date-row"><span className="wc-axis-label">日期节点</span>{days.map(day => <div key={day} className={day === selected ? "wc-day-selected" : ""}>{entriesOnDay(entries, day).filter(e => e.when !== "time").map(e => <EntryLink key={e.id} entry={e} day={day} today={today} compact />)}</div>)}</div>
            <div className="wc-time-grid" style={{ height: (lastHour - firstHour) * hourHeight }}><div className="wc-axis">{Array.from({ length: lastHour - firstHour }, (_, n) => <span key={n} style={{ top: n * hourHeight }}>{String(n + firstHour).padStart(2, "0")}:00</span>)}</div>{days.map(day => <div key={day} className={`wc-time-day ${day === selected ? "wc-day-selected" : ""}`} style={{ backgroundSize: `100% ${hourHeight}px` }}>
              {dayLayout(entries, day).map(item => <div key={item.entry.id} className="wc-position" style={{ top: (item.start / 60 - firstHour) * hourHeight, height: Math.max(18, (item.end - item.start) / 60 * hourHeight), left: `${item.lane / item.lanes * 100}%`, width: `${100 / item.lanes}%` }}><EntryLink entry={item.entry} day={day} today={today} compact={item.end - item.start < 40} /></div>)}
            </div>)}</div>
          </div></div>}
          {view === "month" && <div className="wc-month"><div className="wc-month-head">{weekdays.map(d => <span key={d}>周{d}</span>)}</div><div className="wc-month-cells">{days.map(day => {
            const list = entriesOnDay(entries, day);
            return <div key={day} className={`wc-month-cell ${day.slice(0, 7) !== anchor.slice(0, 7) ? "wc-outside" : ""} ${day === selected ? "wc-day-selected" : ""}`}><button type="button" className={day === today ? "wc-today-number" : ""} aria-label={`选择 ${day}`} aria-pressed={selected === day} onClick={() => choose(day)}>{Number(day.slice(8))}</button>{list.slice(0, 3).map(e => <EntryLink key={e.id} entry={e} day={day} today={today} compact />)}{list.length > 3 && <button type="button" className="wc-more" onClick={() => choose(day)}>另有 {list.length - 3} 项</button>}</div>;
          })}</div></div>}
          {view === "agenda" && <div className="wc-agenda">{days.map(day => {
            const list = entriesOnDay(entries, day);
            return list.length ? <section key={day}><button type="button" className={`wc-agenda-date ${day === selected ? "wc-selected" : ""}`} onClick={() => choose(day)}>{dayTitle(day)}{day === today && <span>今天</span>}</button><div>{list.map(e => <EntryLink key={e.id} entry={e} day={day} today={today} />)}</div></section> : null;
          })}{!entries.length && <p className="wc-state">当前范围暂无已登记安排。未登记不代表空闲。</p>}</div>}
          <p className="wc-footnote">截止节点按日期显示，不占用工作时段。工作安排来自已确认的个人计划。</p>
          {enabled.length === 0 && <p className="wc-warning">尚未选择显示内容，请勾选上方分类。</p>}
        </div><aside className="wc-sidebar">
          <div className="wc-mini"><div className="wc-mini-title">{Number(anchor.slice(5, 7))} 月 · 快速选日</div><div className="wc-mini-grid">{weekdays.map(d => <span key={d}>{d}</span>)}{miniDays.map(day => <button key={day} type="button" aria-label={`快速选择 ${day}`} aria-pressed={day === selected} className={`${day === selected ? "wc-selected" : ""} ${day.slice(0, 7) !== anchor.slice(0, 7) ? "wc-outside" : ""}`} onClick={() => choose(day)}>{Number(day.slice(8))}</button>)}</div></div>
          <div className="wc-day-summary"><h3>{dayTitle(selected)}{selected === today && <span>今天</span>}</h3><p>{dayEntries.length ? `${dayEntries.length} 项安排与节点` : "暂无已登记安排"}</p>{!dayEntries.length && <p className="wc-muted">未登记不代表空闲。</p>}
            <div className="wc-day-items">{dayEntries.map(e => <div key={e.id}><EntryLink entry={e} day={selected} today={today} />{e.projectName && <p className="wc-project-name">{e.projectName}</p>}{e.when === "time" && e.source === "work" && <Link className="wc-plan-link" href={e.href.replace(/\?task=.*/, "/personal-plan")}>核对个人计划</Link>}</div>)}</div>
          </div>
          <div className="wc-management"><Link href="/schedule">管理课表与临时日程 ↗</Link><Link href="/projects">进入项目进行个人规划 ↗</Link><button type="button" onClick={() => setTab("tasks")}>查看任务列表与未定日期任务 →</button></div>
        </aside></div>
      </>}
    </div>}
  </section>;
}
