import { eq } from "drizzle-orm";
import type { DbTx } from "@/db";
import { taskWatchers } from "@/db/task-enhancements-schema";
import { recordNotificationIntent } from "./notification";

/** Uses the existing notification transaction and event key so old recipients never receive duplicates. */
export async function notifyTaskWatchers(tx: DbTx, actorId: string, task: { id: string; projectId: string; title: string }, change: { type: "task.completed" | "task.status_changed" | "task.blocked" | "task.unblocked"; occurredAt: string; summary: string }) {
  const watchers = await tx.select({ userId: taskWatchers.userId }).from(taskWatchers).where(eq(taskWatchers.taskId, task.id));
  if (!watchers.length) return { createdCount: 0 };
  // recordNotificationIntent rechecks current membership, excludes actor, and enforces recipient/event uniqueness.
  return recordNotificationIntent(tx, { actorId, projectId: task.projectId, type: change.type,
    eventKey: `${change.type}:${task.id}:${change.occurredAt}`, recipientIds: watchers.map((w) => w.userId), summary: change.summary.slice(0, 500),
    sourceRef: { sourceKind: "task", sourceId: task.id, projectId: task.projectId, sourceHref: `/projects/${task.projectId}?task=${task.id}`, evidenceKey: `task:${task.id}`, availability: "available" } });
}
