import { sql } from "drizzle-orm";
import { boolean, check, index, integer, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { deliverableVersions, projectReferences, projects, tasks, users } from "./schema";

export const taskChecklistItems = pgTable("task_checklist_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  taskId: uuid("task_id").notNull().references(() => tasks.id, { onDelete: "cascade" }),
  text: text("text").notNull(),
  checked: boolean("checked").notNull().default(false),
  sortOrder: integer("sort_order").notNull().default(0),
  revision: integer("revision").notNull().default(1),
  createdById: uuid("created_by_id").references(() => users.id, { onDelete: "set null" }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("task_checklist_items_task_idx").on(t.taskId, t.sortOrder), check("task_checklist_items_text_nonempty", sql`length(trim(${t.text})) between 1 and 500`)]);

export const taskWatchers = pgTable("task_watchers", {
  taskId: uuid("task_id").notNull().references(() => tasks.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.taskId, t.userId] }), index("task_watchers_user_idx").on(t.userId)]);

export const projectTaskSettings = pgTable("project_task_settings", {
  projectId: uuid("project_id").primaryKey().references(() => projects.id, { onDelete: "cascade" }),
  doingLimit: integer("doing_limit"),
  revision: integer("revision").notNull().default(1),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [check("project_task_settings_limit_range", sql`${t.doingLimit} is null or ${t.doingLimit} between 1 and 99`)]);

export const taskMaterialLinks = pgTable("task_material_links", {
  id: uuid("id").primaryKey().defaultRandom(),
  taskId: uuid("task_id").notNull().references(() => tasks.id, { onDelete: "cascade" }),
  resourceId: uuid("resource_id").references(() => projectReferences.id, { onDelete: "cascade" }),
  deliverableVersionId: uuid("deliverable_version_id").references(() => deliverableVersions.id, { onDelete: "cascade" }),
  revision: integer("revision").notNull().default(1),
  createdById: uuid("created_by_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("task_material_links_task_idx").on(t.taskId),
  uniqueIndex("task_material_links_resource_unique").on(t.taskId, t.resourceId),
  uniqueIndex("task_material_links_version_unique").on(t.taskId, t.deliverableVersionId),
  check("task_material_links_one_source", sql`num_nonnulls(${t.resourceId}, ${t.deliverableVersionId}) = 1`),
]);
