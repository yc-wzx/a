import { and, eq, gt, lt, or, isNull, sql } from "drizzle-orm";
import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { db } from "@/db";
import { calendarConnections, calendarRemoteEvents, calendarFeedTokens } from "@/db/calendar-integrations-schema";
import { personalScheduleEvents, personalScheduleState } from "@/db/schema";
import { AppError, ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { hashRequest } from "@/lib/write-request";
import { externalCalendarUrl, fetchExternalCalendar, pushCaldavEvent, serializeCalendarEvent, type RemoteCalendarEvent } from "./caldav";
import { openCalendarSecret, sealCalendarSecret } from "./calendar-crypto";
import { lockPersonalState } from "./store";
import { addDays, localInstant, shanghaiDay, type ScheduleEventInput } from "./types";

const eventHash = (event: ScheduleEventInput) => hashRequest({ title: event.title, startAt: new Date(event.startAt).toISOString(), endAt: new Date(event.endAt).toISOString() });
const asInput = (event: typeof personalScheduleEvents.$inferSelect): ScheduleEventInput => ({ title: event.title, startAt: event.startAt.toISOString(), endAt: event.endAt.toISOString(), shareBusy: event.shareBusy });
export async function listCalendarConnections(actor: string) {
  z.uuid().parse(actor);
  const rows = await db.select({ id: calendarConnections.id, kind: calendarConnections.kind, name: calendarConnections.name, lastSyncedAt: calendarConnections.lastSyncedAt, lastError: calendarConnections.lastError, revision: calendarConnections.revision }).from(calendarConnections).where(eq(calendarConnections.userId,actor)).orderBy(calendarConnections.createdAt);
  return rows.map(r => ({ ...r,lastSyncedAt: r.lastSyncedAt?.toISOString() ?? null }));
}
export async function addCalendarConnection(actor: string, input: unknown) {
  z.uuid().parse(actor);
  const data = z.strictObject({ kind: z.enum(["ics","caldav"]), name: z.string().trim().min(1).max(60), url: z.string().max(4096), username: z.string().max(300).default(""), password: z.string().max(2000).default(""), consent: z.literal(true) }).parse(input);
  const url = externalCalendarUrl(data.url,data.kind === "caldav");
  if (data.kind === "caldav" && (!data.username || !data.password || /[:\r\n]/.test(data.username))) throw new ValidationError("请输入 CalDAV 账号和应用专用密码");
  return db.transaction(async tx => {
    await lockPersonalState(tx,actor);
    const rows = await tx.select({ id: calendarConnections.id }).from(calendarConnections).where(eq(calendarConnections.userId,actor));
    if (rows.length >= 5) throw new ValidationError("最多连接 5 个外部日历，请先移除不用的连接");
    const [row] = await tx.insert(calendarConnections).values({ userId: actor, kind: data.kind, name: data.name, urlCiphertext: sealCalendarSecret(actor,url), credentialsCiphertext: data.kind === "caldav" ? sealCalendarSecret(actor,JSON.stringify({ username: data.username,password: data.password })) : null }).returning({ id: calendarConnections.id });
    return row;
  });
}
async function ownConnection(actor: string, id: string) {
  z.uuid().parse(actor); z.uuid().parse(id);
  const [row] = await db.select().from(calendarConnections).where(and(eq(calendarConnections.id,id),eq(calendarConnections.userId,actor)));
  if (!row) throw new NotFoundError();
  return row;
}
function decode(row: typeof calendarConnections.$inferSelect) {
  return { url: openCalendarSecret(row.userId,row.urlCiphertext), credentials: row.credentialsCiphertext ? JSON.parse(openCalendarSecret(row.userId,row.credentialsCiphertext)) as { username: string; password: string } : undefined };
}
export async function refreshCalendarConnection(actor: string,id: string, force = true) {
  const row = await ownConnection(actor,id);
  const cutoff = new Date(Date.now() - (force ? 15000 : 14 * 60000));
  const skipped = { added: 0, updated: 0, removed: 0, conflicts: [] as string[], skipped: true };
  if (row.lastAttemptAt && row.lastAttemptAt > cutoff) return skipped;
  // Claim an attempt before network I/O. Failed sources are throttled too, so
  // they cannot permanently starve later accounts or overlap a cron request.
  const claimed = await db.update(calendarConnections).set({ lastAttemptAt: new Date() }).where(and(eq(calendarConnections.id,id),eq(calendarConnections.userId,actor),eq(calendarConnections.revision,row.revision),or(isNull(calendarConnections.lastAttemptAt),lt(calendarConnections.lastAttemptAt,cutoff)))).returning({ id: calendarConnections.id });
  if (!claimed.length) return skipped;
  const range = { startDate: addDays(shanghaiDay(),-7),endDate: addDays(shanghaiDay(),180) }, secret = decode(row);
  let remote: RemoteCalendarEvent[];
  try { remote = await fetchExternalCalendar(row.kind,secret.url,range,secret.credentials); }
  catch (error) {
    // URLs can include private ICS tokens. Never log or persist raw provider errors.
    await db.update(calendarConnections).set({ lastError: "连接读取失败，请核对日历地址、应用专用密码或稍后重试" }).where(and(eq(calendarConnections.id,id),eq(calendarConnections.userId,actor)));
    if (error instanceof AppError) throw error;
    throw new ValidationError("外部日历暂时无法读取，原有日程已保留");
  }
  return db.transaction(async tx => {
    const state = await lockPersonalState(tx,actor);
    const [current] = await tx.select().from(calendarConnections).where(and(eq(calendarConnections.id,id),eq(calendarConnections.userId,actor))).for("update");
    if (!current) throw new NotFoundError();
    if (current.revision !== row.revision) throw new ConflictError("连接已被另一请求更新，请重新刷新");
    const mappings = await tx.select().from(calendarRemoteEvents).innerJoin(personalScheduleEvents,eq(personalScheduleEvents.id,calendarRemoteEvents.eventId)).where(eq(calendarRemoteEvents.connectionId,id));
    const map = new Map(mappings.map(m => [m.calendar_remote_events.remoteKey,m]));
    const seen = new Set(remote.map(e => e.key)); let added = 0,updated = 0,removed = 0;
    const conflicts: string[] = [];
    for (const item of remote) {
      const old = map.get(item.key), fingerprint = eventHash(item.event);
      if (old) {
        const local = old.personal_schedule_events, mapping = old.calendar_remote_events, localHash = eventHash(asInput(local));
        if (localHash !== mapping.baseHash) {
          if (fingerprint !== mapping.baseHash && fingerprint !== localHash) conflicts.push(`「${local.title}」在两端均有修改，已保留本地内容；请核对后在来源日历解决冲突`);
          else if (fingerprint === localHash) await tx.update(calendarRemoteEvents).set({ baseHash: fingerprint,etag: item.etag }).where(eq(calendarRemoteEvents.id,mapping.id));
          continue;
        }
        const [duplicate] = await tx.select({ id: personalScheduleEvents.id }).from(personalScheduleEvents).where(and(eq(personalScheduleEvents.userId,actor),eq(personalScheduleEvents.fingerprint,fingerprint)));
        if (duplicate && duplicate.id !== local.id) { conflicts.push(`「${item.event.title}」与已有日程重复，未覆盖`); continue; }
        if (localHash !== fingerprint) {
          await tx.update(personalScheduleEvents).set({ title: item.event.title,startAt: new Date(item.event.startAt),endAt: new Date(item.event.endAt),fingerprint,revision: local.revision + 1 }).where(eq(personalScheduleEvents.id,local.id)); updated++;
        }
        await tx.update(calendarRemoteEvents).set({ baseHash: fingerprint,etag: item.etag,href: item.href,recurring: item.recurring ? 1 : 0 }).where(eq(calendarRemoteEvents.id,mapping.id));
      } else {
        // Recover an interrupted successful PUT by its stable account-owned UID.
        const exported = /^agilecampus-([0-9a-f-]{36})@weidu$/.exec(item.uid)?.[1];
        const [adopt] = exported ? await tx.select().from(personalScheduleEvents).where(and(eq(personalScheduleEvents.id,exported),eq(personalScheduleEvents.userId,actor))) : [];
        const [existingMap] = adopt ? await tx.select({ id: calendarRemoteEvents.id }).from(calendarRemoteEvents).where(and(eq(calendarRemoteEvents.connectionId,id),eq(calendarRemoteEvents.eventId,adopt.id))) : [];
        if (adopt && !existingMap) {
          await tx.insert(calendarRemoteEvents).values({ connectionId: id,eventId: adopt.id,remoteKey: item.key,href: item.href,uid: item.uid,etag: item.etag,baseHash: fingerprint,recurring: item.recurring ? 1 : 0 });
          if (eventHash(asInput(adopt)) !== fingerprint) conflicts.push(`「${adopt.title}」已关联来源，内容不同，请核对后推送更新`);
          continue;
        }
        const [inserted] = await tx.insert(personalScheduleEvents).values({ userId: actor,title: item.event.title,startAt: new Date(item.event.startAt),endAt: new Date(item.event.endAt),fingerprint,source: `external:${id}`,shareBusy: false }).onConflictDoNothing().returning({ id: personalScheduleEvents.id });
        if (!inserted) { conflicts.push(`「${item.event.title}」与已有日程重复，未覆盖`); continue; }
        await tx.insert(calendarRemoteEvents).values({ connectionId: id,eventId: inserted.id,remoteKey: item.key,href: item.href,uid: item.uid,etag: item.etag,baseHash: fingerprint,recurring: item.recurring ? 1 : 0 }); added++;
      }
    }
    // Only this connection's clean, source-owned copies within the complete queried
    // range can be removed. Local manual events and unsent edits are preserved.
    for (const old of mappings) {
      const local = old.personal_schedule_events, mapping = old.calendar_remote_events;
      if (seen.has(mapping.remoteKey) || local.startAt >= localInstant(addDays(range.endDate,1)) || local.endAt <= localInstant(range.startDate)) continue;
      if (eventHash(asInput(local)) !== mapping.baseHash || local.source !== `external:${id}`) {
        conflicts.push(`「${local.title}」在来源中已移除，本地安排已保留`);
        // Retain the mapping and ETag: never silently resurrect a deleted source.
        continue;
      }
      await tx.delete(personalScheduleEvents).where(eq(personalScheduleEvents.id,local.id)); removed++;
    }
    if (added || updated || removed) await tx.update(personalScheduleState).set({ revision: state.revision + 1 }).where(eq(personalScheduleState.userId,actor));
    await tx.update(calendarConnections).set({ revision: current.revision + 1,lastSyncedAt: new Date(),lastError: conflicts.length ? `${conflicts.length} 项需要核对；手动刷新查看详情` : null }).where(eq(calendarConnections.id,id));
    return { added,updated,removed,conflicts: conflicts.slice(0,20),skipped: false };
  });
}
export async function pushCalendarConnectionEvent(actor: string,id: string,input: unknown) {
  const data = z.strictObject({ eventId: z.uuid(),expectedRevision: z.number().int().positive(),consent: z.literal(true) }).parse(input), row = await ownConnection(actor,id);
  if (row.kind !== "caldav") throw new ForbiddenError("ICS 订阅为只读，不能推送");
  const secret = decode(row);
  const [event] = await db.select().from(personalScheduleEvents).where(and(eq(personalScheduleEvents.id,data.eventId),eq(personalScheduleEvents.userId,actor)));
  if (!event) throw new NotFoundError();
  if (!["manual","emergency"].includes(event.source)) throw new ForbiddenError("只可推送本人手动登记的日程，不推送课程导入或他人安排");
  if (event.revision !== data.expectedRevision) throw new ConflictError("日程已更新，请刷新后再推送");
  const [mapping] = await db.select().from(calendarRemoteEvents).where(and(eq(calendarRemoteEvents.connectionId,id),eq(calendarRemoteEvents.eventId,event.id)));
  if (mapping?.recurring) throw new ForbiddenError("重复日程请在来源日历编辑，避免覆盖整组课程");
  const uid = mapping?.uid ?? `agilecampus-${event.id}@weidu`, sent = asInput(event), result = await pushCaldavEvent(secret.url,secret.credentials!,uid,sent,mapping);
  return db.transaction(async tx => {
    await lockPersonalState(tx,actor);
    const [current] = await tx.select().from(calendarConnections).where(and(eq(calendarConnections.id,id),eq(calendarConnections.userId,actor))).for("update");
    if (!current) throw new ConflictError("连接已移除。来源可能已接收日程，请在来源日历核对");
    const [live] = await tx.select().from(personalScheduleEvents).where(and(eq(personalScheduleEvents.id,event.id),eq(personalScheduleEvents.userId,actor)));
    if (!live) throw new ConflictError("本地日程已移除。来源可能已接收日程，请在来源日历核对");
    await tx.insert(calendarRemoteEvents).values({ connectionId: id,eventId: event.id,remoteKey: `${result.href}#${uid}`,href: result.href,uid,etag: result.etag,baseHash: eventHash(sent) }).onConflictDoUpdate({ target: [calendarRemoteEvents.connectionId,calendarRemoteEvents.eventId],set: { remoteKey: `${result.href}#${uid}`,href: result.href,etag: result.etag,baseHash: eventHash(sent) } });
    await tx.update(calendarConnections).set({ revision: current.revision + 1 }).where(eq(calendarConnections.id,id));
    return { pushed: true,localChanged: live.revision !== event.revision,versionProtected: !!result.etag };
  });
}
export async function removeCalendarConnection(actor: string,id: string, removeImported: boolean) {
  return db.transaction(async tx => {
    const state = await lockPersonalState(tx,actor);
    const [row] = await tx.select().from(calendarConnections).where(and(eq(calendarConnections.id,z.uuid().parse(id)),eq(calendarConnections.userId,actor))).for("update");
    if (!row) throw new NotFoundError();
    if (removeImported) await tx.delete(personalScheduleEvents).where(and(eq(personalScheduleEvents.userId,actor),eq(personalScheduleEvents.source,`external:${id}`)));
    else await tx.update(personalScheduleEvents).set({ source: "manual",revision: sql`${personalScheduleEvents.revision} + 1` }).where(and(eq(personalScheduleEvents.userId,actor),eq(personalScheduleEvents.source,`external:${id}`)));
    await tx.delete(calendarConnections).where(eq(calendarConnections.id,id));
    await tx.update(personalScheduleState).set({ revision: state.revision + 1 }).where(eq(personalScheduleState.userId,actor));
    return { removed: true };
  });
}
export async function runCalendarRefreshBatch() {
  const due = await db.select({ id: calendarConnections.id,userId: calendarConnections.userId }).from(calendarConnections).where(sql`${calendarConnections.lastAttemptAt} is null or ${calendarConnections.lastAttemptAt} < now() - interval '15 minutes'`).orderBy(sql`${calendarConnections.lastAttemptAt} asc nulls first`,calendarConnections.createdAt).limit(12);
  let synced = 0,failed = 0;
  const started = Date.now();
  for (let offset = 0; offset < due.length && Date.now() - started < 60000; offset += 3) {
    await Promise.all(due.slice(offset,offset + 3).map(async row => { try { const result = await refreshCalendarConnection(row.userId,row.id,false); if (!result.skipped) synced++; } catch { failed++; } }));
  }
  return { synced,failed };
}
export async function listCalendarFeeds(actor: string) {
  return db.select({ id: calendarFeedTokens.id,label: calendarFeedTokens.label,includeDetails: calendarFeedTokens.includeDetails,createdAt: calendarFeedTokens.createdAt }).from(calendarFeedTokens).where(eq(calendarFeedTokens.userId,z.uuid().parse(actor)));
}
export async function createCalendarFeed(actor: string,input: unknown) {
  const data = z.strictObject({ label: z.string().trim().min(1).max(60),includeDetails: z.boolean().default(false),consent: z.literal(true) }).parse(input);
  return db.transaction(async tx => {
    await lockPersonalState(tx,actor);
    const rows = await tx.select({ id: calendarFeedTokens.id }).from(calendarFeedTokens).where(eq(calendarFeedTokens.userId,actor));
    if (rows.length >= 5) throw new ValidationError("最多创建 5 个订阅地址，请先撤销不用的地址");
    const token = randomBytes(32).toString("base64url"), [row] = await tx.insert(calendarFeedTokens).values({ userId: actor,label: data.label,includeDetails: data.includeDetails ? 1 : 0,tokenHash: createHash("sha256").update(token).digest("hex") }).returning({ id: calendarFeedTokens.id });
    return { ...row,token };
  });
}
export async function revokeCalendarFeed(actor: string,id: string) {
  const rows = await db.delete(calendarFeedTokens).where(and(eq(calendarFeedTokens.id,z.uuid().parse(id)),eq(calendarFeedTokens.userId,z.uuid().parse(actor)))).returning({ id: calendarFeedTokens.id });
  if (!rows.length) throw new NotFoundError(); return { revoked: true };
}
export async function getCalendarFeed(token: string) {
  if (!/^[\w-]{43}$/.test(token)) throw new NotFoundError();
  const [row] = await db.select().from(calendarFeedTokens).where(eq(calendarFeedTokens.tokenHash,createHash("sha256").update(token).digest("hex")));
  if (!row) throw new NotFoundError();
  const now = shanghaiDay(), entries = await db.select().from(personalScheduleEvents).where(and(eq(personalScheduleEvents.userId,row.userId),lt(personalScheduleEvents.startAt,localInstant(addDays(now,181))),gt(personalScheduleEvents.endAt,localInstant(addDays(now,-7))))).limit(1001);
  if (entries.length > 1000) throw new ValidationError("订阅日程超过范围限制，请整理后重试");
  const chunks = entries.map(e => serializeCalendarEvent(`agilecampus-${e.id}@weidu`,{ ...asInput(e),title: row.includeDetails ? e.title : "忙碌" }).split("BEGIN:VEVENT\r\n")[1].split("END:VCALENDAR")[0]);
  return ["BEGIN:VCALENDAR","VERSION:2.0","PRODID:-//AgileCampus//Readonly subscription//ZH","X-WR-CALNAME:AgileCampus 个人安排",...chunks.map(s => `BEGIN:VEVENT\r\n${s}`),"END:VCALENDAR",""] .join("\r\n");
}
