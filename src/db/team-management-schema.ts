import { boolean, index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { teams, users } from "./schema";

// Kept separate from the frozen P0–P2 team and resource contracts.
export const teamManagementSettings = pgTable("team_management_settings", {
  teamId: uuid("team_id").primaryKey().references(() => teams.id, { onDelete: "cascade" }),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  inviteExpiresAt: timestamp("invite_expires_at", { withTimezone: true }),
  inviteEnabled: boolean("invite_enabled").notNull().default(true),
  requireApproval: boolean("require_approval").notNull().default(false),
  revision: integer("revision").notNull().default(1),
});

export const teamJoinRequests = pgTable("team_join_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  teamId: uuid("team_id").notNull().references(() => teams.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  status: text("status").$type<"pending" | "approved" | "rejected">().notNull().default("pending"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  reviewedById: uuid("reviewed_by_id").references(() => users.id, { onDelete: "set null" }),
}, t => [uniqueIndex("team_join_requests_user_unique").on(t.teamId, t.userId), index("team_join_requests_pending_idx").on(t.teamId, t.status)]);

export const resourceReservations = pgTable("resource_reservations", {
  id: uuid("id").primaryKey().defaultRandom(),
  teamId: uuid("team_id").notNull().references(() => teams.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  resourceName: text("resource_name").notNull(),
  resourceKey: text("resource_key").notNull(),
  purpose: text("purpose").notNull(),
  startTime: timestamp("start_time", { withTimezone: true }).notNull(),
  endTime: timestamp("end_time", { withTimezone: true }).notNull(),
  status: text("status").$type<"pending" | "approved" | "rejected" | "cancelled">().notNull().default("pending"),
  reviewNote: text("review_note"),
  reviewedById: uuid("reviewed_by_id").references(() => users.id, { onDelete: "set null" }),
  revision: integer("revision").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [index("resource_reservations_team_idx").on(t.teamId, t.status, t.startTime), index("resource_reservations_conflict_idx").on(t.teamId, t.resourceKey, t.startTime)]);
