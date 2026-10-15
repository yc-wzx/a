import { index, integer, jsonb, pgTable, primaryKey, text, timestamp, uuid, type AnyPgColumn } from "drizzle-orm/pg-core";
import { projects, tasks, users } from "./schema";
import type { DocumentNode, DocumentPermission, DocumentVisibility } from "@/contracts/documents";

export const projectDocuments = pgTable("project_documents", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  ownerId: uuid("owner_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  folder: text("folder").notNull().default("未分类"),
  visibility: text("visibility").$type<DocumentVisibility>().notNull().default("project"),
  defaultPermission: text("default_permission").$type<DocumentPermission>().notNull().default("edit"),
  // Yjs state is the source of truth; content/text are validated server projections.
  state: text("state").notNull(),
  content: jsonb("content").$type<DocumentNode>().notNull(),
  searchText: text("search_text").notNull().default(""),
  revision: integer("revision").notNull().default(1),
  epoch: integer("epoch").notNull().default(1),
  lastEditedById: uuid("last_edited_by_id").references(() => users.id, { onDelete: "set null" }),
  checkpointAt: timestamp("checkpoint_at", { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("project_documents_project_idx").on(t.projectId, t.deletedAt, t.updatedAt)]);

export const documentGrants = pgTable("document_grants", {
  documentId: uuid("document_id").notNull().references(() => projectDocuments.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  permission: text("permission").$type<DocumentPermission>().notNull(),
}, (t) => [primaryKey({ columns: [t.documentId, t.userId] })]);

export const documentVersions = pgTable("document_versions", {
  id: uuid("id").primaryKey().defaultRandom(),
  documentId: uuid("document_id").notNull().references(() => projectDocuments.id, { onDelete: "cascade" }),
  authorId: uuid("author_id").references(() => users.id, { onDelete: "set null" }),
  authorName: text("author_name").notNull(),
  label: text("label").notNull(),
  kind: text("kind").$type<"manual" | "restore" | "checkpoint">().notNull(),
  content: jsonb("content").$type<DocumentNode>().notNull(),
  state: text("state").notNull(),
  revision: integer("revision").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("document_versions_document_idx").on(t.documentId, t.createdAt)]);

export const documentComments = pgTable("document_comments", {
  id: uuid("id").primaryKey().defaultRandom(),
  documentId: uuid("document_id").notNull().references(() => projectDocuments.id, { onDelete: "cascade" }),
  replyToId: uuid("reply_to_id").references((): AnyPgColumn => documentComments.id, { onDelete: "set null" }),
  blockId: text("block_id"),
  quote: text("quote").notNull().default(""),
  body: text("body").notNull(),
  authorId: uuid("author_id").references(() => users.id, { onDelete: "set null" }),
  authorName: text("author_name").notNull(),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  resolvedById: uuid("resolved_by_id").references(() => users.id, { onDelete: "set null" }),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("document_comments_document_idx").on(t.documentId, t.createdAt)]);

export const documentTaskLinks = pgTable("document_task_links", {
  documentId: uuid("document_id").notNull().references(() => projectDocuments.id, { onDelete: "cascade" }),
  taskId: uuid("task_id").notNull().references(() => tasks.id, { onDelete: "cascade" }),
  createdById: uuid("created_by_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.documentId, t.taskId] })]);

export const documentPresence = pgTable("document_presence", {
  documentId: uuid("document_id").notNull().references(() => projectDocuments.id, { onDelete: "cascade" }),
  sessionId: uuid("session_id").notNull(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  awareness: text("awareness"),
  seenAt: timestamp("seen_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.documentId, t.sessionId] }), index("document_presence_seen_idx").on(t.seenAt)]);

export const documentAiRequests = pgTable("document_ai_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  documentId: uuid("document_id").notNull().references(() => projectDocuments.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("document_ai_requests_user_idx").on(t.userId, t.createdAt)]);

export const documentBookmarks = pgTable("document_bookmarks", {
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  documentId: uuid("document_id").notNull().references(() => projectDocuments.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [primaryKey({ columns: [t.userId, t.documentId] })]);

export const documentVisits = pgTable("document_visits", {
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  documentId: uuid("document_id").notNull().references(() => projectDocuments.id, { onDelete: "cascade" }),
  visitedAt: timestamp("visited_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [primaryKey({ columns: [t.userId, t.documentId] }), index("document_visits_user_time_idx").on(t.userId, t.visitedAt)]);

export const documentGuidePins = pgTable("document_guide_pins", {
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  slot: text("slot").notNull(),
  documentId: uuid("document_id").notNull().references(() => projectDocuments.id, { onDelete: "cascade" }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [primaryKey({ columns: [t.projectId, t.slot] })]);

export const documentReferences = pgTable("document_references", {
  sourceId: uuid("source_id").notNull().references(() => projectDocuments.id, { onDelete: "cascade" }),
  targetId: uuid("target_id").notNull().references(() => projectDocuments.id, { onDelete: "cascade" }),
}, t => [primaryKey({ columns: [t.sourceId, t.targetId] }), index("document_references_target_idx").on(t.targetId)]);

export const documentTaskOrigins = pgTable("document_task_origins", {
  taskId: uuid("task_id").primaryKey().references(() => tasks.id, { onDelete: "cascade" }),
  documentId: uuid("document_id").notNull().references(() => projectDocuments.id, { onDelete: "cascade" }),
  blockId: text("block_id"),
}, t => [index("document_task_origins_document_idx").on(t.documentId)]);
