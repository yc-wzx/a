import { bigint, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { projects, users, tasks, iterations } from "./schema";

export const projectAttachments = pgTable("project_attachments", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  ownerId: uuid("owner_id").notNull().references(() => users.id),
  targetType: text("target_type").notNull().$type<"project" | "task" | "document" | "deliverable">(),
  targetId: uuid("target_id").notNull(),
  filename: text("filename").notNull(),
  mediaType: text("media_type").notNull(),
  size: bigint("size", { mode: "number" }).notNull(),
  storageKey: text("storage_key").notNull(),
  digest: text("digest").notNull(),
  requestId: uuid("request_id").notNull(),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [uniqueIndex("attachment_owner_request_uq").on(t.ownerId, t.requestId), index("attachment_target_idx").on(t.projectId, t.targetType, t.targetId)]);

export const discussionTaskOrigins = pgTable("discussion_task_origins", {
  taskId: uuid("task_id").primaryKey().references(() => tasks.id, { onDelete: "cascade" }),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  sourceType: text("source_type").notNull().$type<"comment" | "discussion" | "retrospective">(),
  sourceId: uuid("source_id").notNull(),
  sourceTaskId: uuid("source_task_id"),
  sourceRevision: text("source_revision").notNull(),
  createdById: uuid("created_by_id").notNull().references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [index("discussion_origins_source_idx").on(t.projectId, t.sourceType, t.sourceId)]);

export const iterationTrendSamples = pgTable("iteration_trend_samples", {
  id: uuid("id").primaryKey().defaultRandom(),
  iterationId: uuid("iteration_id").notNull().references(() => iterations.id, { onDelete: "cascade" }),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  day: text("day").notNull(),
  total: integer("total").notNull(),
  done: integer("done").notNull(),
  taskStates: jsonb("task_states").notNull().$type<{ id: string; status: string }[]>(),
  sampledAt: timestamp("sampled_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [uniqueIndex("iteration_trend_day_uq").on(t.iterationId, t.day)]);
