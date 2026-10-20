import ical from "node-ical";
import { XMLParser, XMLValidator } from "fast-xml-parser";
import { ValidationError, ConflictError } from "@/lib/errors";
import { safeFetch } from "@/lib/safe-fetch";
import { normalizeIcs } from "./importer";
import { addDays, eventSchema, localInstant, type ScheduleEventInput } from "./types";

export type RemoteCalendarEvent = { key: string; href: string; uid: string; etag: string | null; recurring: boolean; event: ScheduleEventInput };
export function externalCalendarUrl(input: string, collection = false) {
  let url: URL; try { url = new URL(input); } catch { throw new ValidationError("请输入完整 HTTPS 日历地址"); }
  if (url.protocol !== "https:" || url.username || url.password || url.hash || (url.port && url.port !== "443")) throw new ValidationError("日历地址必须是标准 HTTPS，账号密码请分别填写");
  if (collection && (url.search || !url.pathname.endsWith("/"))) throw new ValidationError("CalDAV 请填写具体日历集合地址，结尾为 /，不能填写账户首页");
  return url.href;
}
export function caldavResourceUrl(collection: string, href: string) {
  const base = new URL(externalCalendarUrl(collection, true)), url = new URL(href, base);
  if (url.origin !== base.origin || !url.pathname.startsWith(base.pathname) || url.username || url.password || url.search || url.hash || /(?:^|\/)\.\.(?:\/|$)/.test(decodeURIComponent(url.pathname))) throw new ValidationError("日历服务器返回了超出所选集合的资源");
  return url.href;
}
const array = <T>(value: T | T[] | undefined): T[] => value === undefined ? [] : Array.isArray(value) ? value : [value];
export function parseDavResources(xml: string, collection: string): { href: string; etag: string | null; content: string }[] {
  if (xml.length > 1048576 || /<!DOCTYPE|<!ENTITY/i.test(xml) || XMLValidator.validate(xml) !== true) throw new ValidationError("日历服务器响应格式不受支持");
  // DTD/entity declarations are rejected above. Decode XML's predefined/numeric
  // entities once; CDATA must remain literal (e.g. a title containing "&amp;").
  const parsed = new XMLParser({ removeNSPrefix: true, ignoreAttributes: true, processEntities: true, trimValues: false }).parse(xml);
  if (!parsed || typeof parsed !== "object" || !("multistatus" in parsed)) throw new ValidationError("日历服务器没有返回标准 CalDAV 结果");
  const multi = parsed.multistatus;
  if (typeof multi === "string") {
    if (!multi.trim()) return []; // A complete empty REPORT is a valid calendar.
    throw new ValidationError("日历服务器返回了不完整的 CalDAV 结果");
  }
  if (!multi || typeof multi !== "object" || multi.error || (!multi.response && Object.keys(multi).some(k => k !== "sync-token"))) throw new ValidationError("日历服务器返回了不完整的 CalDAV 结果");
  const responses = array<Record<string, unknown>>(multi.response);
  if (responses.length > 500) throw new ValidationError("日历事件过多，请选择单独的课程日历");
  const resources: { href: string; etag: string | null; content: string }[] = [];
  for (const response of responses) {
    let readable = false;
    for (const stat of array<Record<string, unknown>>(response.propstat as Record<string, unknown> | Record<string, unknown>[] | undefined)) {
      if (!/\s200(?:\s|$)/.test(String(stat.status ?? ""))) continue;
      const prop = stat.prop as Record<string, unknown> | undefined;
      if (typeof prop?.["calendar-data"] !== "string") continue;
      const href = caldavResourceUrl(collection, String(response.href ?? "")), etag = typeof prop.getetag === "string" && /^"[^"\r\n]{1,200}"$/.test(prop.getetag.trim()) ? prop.getetag.trim() : null;
      const content = prop["calendar-data"];
      resources.push({ href, etag, content });
      readable = true;
    }
    // A partial/forbidden property response is not an empty calendar. Treating it
    // as complete would incorrectly erase the previously imported source copies.
    if (!readable) throw new ValidationError("日历服务器返回了不完整或无权限的资源，原有日程已保留");
  }
  return resources;
}
export async function parseRemoteCalendar(content: string, range: { startDate: string; endDate: string }, resource = { href: "ics", etag: null as string | null }): Promise<RemoteCalendarEvent[]> {
  if (content.length > 200000) throw new ValidationError("日历内容超过 200KB 限制");
  const parsed = await ical.async.parseICS(normalizeIcs(content));
  const results: RemoteCalendarEvent[] = [], from = localInstant(range.startDate), to = localInstant(addDays(range.endDate,1));
  for (const row of Object.values(parsed)) {
    if (row?.type !== "VEVENT" || row.status === "CANCELLED" || row.transparency === "TRANSPARENT") continue;
    if (!row.uid || row.uid.length > 512 || !row.start || !row.end) throw new ValidationError("日历日程缺少 UID 或起止时间，未修改现有数据");
    const recurring = !!row.rrule || !!row.recurrenceid || !!row.recurrences;
    for (const occurrence of ical.expandRecurringEvent(row, { from, to: new Date(to.getTime()-1), expandOngoing: true })) {
      if (occurrence.event.status === "CANCELLED") continue;
      const summary = occurrence.summary;
      const event = eventSchema.parse({ title: (typeof summary === "string" ? summary : String((summary as { val?: unknown })?.val ?? "未命名日程")).slice(0,100), startAt: occurrence.start.toISOString(), endAt: occurrence.end.toISOString(), shareBusy: false });
      const identity = recurring ? `${row.uid}/${occurrence.event.recurrenceid?.toISOString() ?? occurrence.start.toISOString()}` : row.uid;
      results.push({ key: `${resource.href}#${identity}`, href: resource.href, uid: row.uid, etag: resource.etag, recurring, event });
      if (results.length > 1000) throw new ValidationError("日历范围内超过 1000 条日程，请缩小来源日历");
    }
  }
  return results;
}
export async function fetchExternalCalendar(kind: "ics" | "caldav", url: string, range: { startDate: string; endDate: string }, credentials?: { username: string; password: string }) {
  const checked = externalCalendarUrl(url, kind === "caldav");
  if (kind === "ics") {
    const result = await safeFetch(checked, { maxBytes: 200000, timeoutMs: 6000, redirects: 1, headers: { Accept: "text/calendar" } });
    if (result.status !== 200) throw new ValidationError("日历订阅读取失败，请检查地址和访问权限");
    return parseRemoteCalendar(result.body.toString("utf8"),range);
  }
  if (!credentials) throw new ValidationError("CalDAV 需要账号和应用专用密码");
  const stamp = (day: string) => localInstant(day).toISOString().replace(/[-:]/g,"").replace(/\.\d{3}/,"");
  const body = `<?xml version="1.0" encoding="utf-8"?><c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><d:getetag/><c:calendar-data/></d:prop><c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="VEVENT"><c:time-range start="${stamp(range.startDate)}" end="${stamp(addDays(range.endDate,1))}"/></c:comp-filter></c:comp-filter></c:filter></c:calendar-query>`;
  const result = await safeFetch(checked,{ method: "REPORT", headers: { Authorization: `Basic ${Buffer.from(`${credentials.username}:${credentials.password}`).toString("base64")}`, "Content-Type": "application/xml; charset=utf-8", Depth: "1" }, body, maxBytes: 1048576, timeoutMs: 6000, redirects: 0 });
  if (result.status !== 207) throw new ValidationError(result.status === 401 || result.status === 403 ? "CalDAV 登录失败，请核对账号和应用专用密码" : "此地址没有返回标准 CalDAV 日历，请填写具体集合地址");
  const resources = parseDavResources(result.body.toString("utf8"),checked), all: RemoteCalendarEvent[] = [];
  for (const resource of resources) all.push(...await parseRemoteCalendar(resource.content,range,resource));
  if (all.length > 1000 || new Set(all.map(e => e.key)).size !== all.length) throw new ValidationError("日历响应重复或超过 1000 条，未修改现有数据");
  return all;
}
function escapeIcs(value: string) { return value.replace(/\\/g,"\\\\").replace(/\r?\n/g,"\\n").replace(/;/g,"\\;").replace(/,/g,"\\,"); }
export function serializeCalendarEvent(uid: string, event: ScheduleEventInput) {
  if (!/^[A-Za-z0-9@._-]{1,200}$/.test(uid)) throw new ValidationError("日历事件 UID 不受支持");
  const stamp = (s: string) => new Date(s).toISOString().replace(/[-:]/g,"").replace(/\.\d{3}/,"");
  const lines = ["BEGIN:VCALENDAR","VERSION:2.0","PRODID:-//AgileCampus//Personal calendar//ZH","BEGIN:VEVENT",`UID:${uid}`,`DTSTAMP:${stamp(new Date().toISOString())}`,`DTSTART:${stamp(event.startAt)}`,`DTEND:${stamp(event.endAt)}`,`SUMMARY:${escapeIcs(event.title)}`,"END:VEVENT","END:VCALENDAR"];
  return lines.map(line => { const chunks: string[] = []; let current = ""; for (const char of line) { if (Buffer.byteLength(current + char,"utf8") > 73) { chunks.push(current); current = " " + char; } else current += char; } return [...chunks,current].join("\r\n"); }).join("\r\n") + "\r\n";
}
export async function pushCaldavEvent(collection: string, credentials: { username: string; password: string }, uid: string, event: ScheduleEventInput, previous?: { href: string; etag: string | null }) {
  if (previous && !previous.etag) throw new ConflictError("来源没有提供版本标识，不能安全覆盖；请在来源日历修改");
  const url = previous ? caldavResourceUrl(collection,previous.href) : new URL(`${encodeURIComponent(uid)}.ics`,externalCalendarUrl(collection,true)).href;
  const result = await safeFetch(url,{ method: "PUT", headers: { Authorization: `Basic ${Buffer.from(`${credentials.username}:${credentials.password}`).toString("base64")}`, "Content-Type": "text/calendar; charset=utf-8", ...(previous ? { "If-Match": previous.etag! } : { "If-None-Match": "*" }) }, body: serializeCalendarEvent(uid,event), redirects: 0 });
  if (result.status === 412) throw new ConflictError("来源日历已经更新。请先拉取核对，未覆盖来源内容");
  if (![200,201,204].includes(result.status)) throw new ValidationError("推送失败，请检查日历写入权限；未标记为成功");
  const etag = result.headers.etag;
  return { href: url, etag: etag && /^"[^"\r\n]{1,200}"$/.test(etag) ? etag : null };
}
