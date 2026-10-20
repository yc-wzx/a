import { pgTable, uuid, text, integer, jsonb, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { users, projects, personalScheduleEvents } from "./schema";
import type { SavedProjectView } from "@/lib/project-views";

export const accountProjectViews = pgTable("account_project_views", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  views: jsonb("views").$type<SavedProjectView[]>().notNull().default([]),
  revision: integer("revision").notNull().default(0),
}, t => [uniqueIndex("account_project_views_owner").on(t.userId, t.projectId)]);

export const calendarConnections = pgTable("calendar_connections", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  kind: text("kind").$type<"ics" | "caldav">().notNull(),
  name: text("name").notNull(),
  urlCiphertext: text("url_ciphertext").notNull(),
  credentialsCiphertext: text("credentials_ciphertext"),
  revision: integer("revision").notNull().default(1),
  lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
  lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true }),
  lastError: text("last_error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
export const calendarRemoteEvents = pgTable("calendar_remote_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  connectionId: uuid("connection_id").notNull().references(() => calendarConnections.id, { onDelete: "cascade" }),
  eventId: uuid("event_id").notNull().references(() => personalScheduleEvents.id, { onDelete: "cascade" }),
  remoteKey: text("remote_key").notNull(),
  href: text("href").notNull(),
  uid: text("uid").notNull(),
  etag: text("etag"),
  baseHash: text("base_hash").notNull(),
  recurring: integer("recurring").notNull().default(0),
}, t => [uniqueIndex("calendar_remote_events_key").on(t.connectionId, t.remoteKey), uniqueIndex("calendar_remote_event_mapping").on(t.connectionId, t.eventId)]);
export const calendarFeedTokens = pgTable("calendar_feed_tokens", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull().unique(),
  label: text("label").notNull(),
  includeDetails: integer("include_details").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
