import { index, integer, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { projectDocuments } from "./documents-schema";
import { users } from "./schema";

/** Confirmation is about one saved body and epoch, never a mutable title. */
export const documentConfirmationRounds = pgTable("document_confirmation_rounds", {
  id: uuid("id").primaryKey().defaultRandom(),
  documentId: uuid("document_id").notNull().references(() => projectDocuments.id, { onDelete: "cascade" }),
  requestedById: uuid("requested_by_id").references(() => users.id, { onDelete: "set null" }),
  epoch: integer("epoch").notNull(),
  revision: integer("revision").notNull(),
  bodyHash: text("body_hash").notNull(),
  invalidatedAt: timestamp("invalidated_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [index("document_confirmation_document_idx").on(t.documentId, t.createdAt)]);

export const documentConfirmations = pgTable("document_confirmations", {
  roundId: uuid("round_id").notNull().references(() => documentConfirmationRounds.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
}, t => [primaryKey({ columns: [t.roundId, t.userId] })]);
