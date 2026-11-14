import {
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { projectReferences, projects, users } from "./schema";

export const meetingDecisions = pgTable(
  "meeting_decisions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    referenceId: uuid("reference_id")
      .notNull()
      .references(() => projectReferences.id, { onDelete: "cascade" }),
    revision: integer("revision").notNull().default(1),
    createdById: uuid("created_by_id").references(() => users.id, {
      onDelete: "set null",
    }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("meeting_decisions_reference_idx").on(
      table.projectId,
      table.referenceId,
    ),
  ],
);

export const meetingDecisionVersions = pgTable(
  "meeting_decision_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    decisionId: uuid("decision_id")
      .notNull()
      .references(() => meetingDecisions.id, { onDelete: "cascade" }),
    revision: integer("revision").notNull(),
    title: text("title").notNull(),
    adoptedOption: text("adopted_option").notNull(),
    background: text("background").notNull().default(""),
    createdById: uuid("created_by_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("meeting_decision_version_uq").on(
      table.decisionId,
      table.revision,
    ),
  ],
);

export const meetingDecisionConfirmations = pgTable(
  "meeting_decision_confirmations",
  {
    versionId: uuid("version_id")
      .notNull()
      .references(() => meetingDecisionVersions.id, { onDelete: "cascade" }),
    // Keep the historical identity even after an account is removed.
    memberId: uuid("member_id").notNull(),
    userId: uuid("user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    userName: text("user_name").notNull(),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
  },
  (table) => [primaryKey({ columns: [table.versionId, table.memberId] })],
);
