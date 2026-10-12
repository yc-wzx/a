import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import {
  deliverables,
  deliverableFeedback,
  deliverableVersions,
  milestones,
  projects,
  tasks,
  users,
} from "@/db/schema";
import { createTeam, joinTeam, updateMemberRole } from "@/lib/team";
import { createProject, createMilestone } from "@/lib/project";
import { createTask } from "@/lib/task";
import {
  createDeliverableDraft,
  submitDeliverable,
  updateDeliverableDraft,
  reviewDeliverable,
  startDeliverableRevision,
} from "@/lib/deliverable";
import { deleteMilestone, previewMilestoneDeletion } from "@/lib/milestone";
import { resetDb } from "./helpers";
async function scene() {
  const [admin, student, teacher, outsider] = await db
    .insert(users)
    .values(
      ["admin", "student", "teacher", "outsider"].map((name) => ({
        name,
        email: `${name}@milestone-delete.test`,
        passwordHash: "fixture",
      })),
    )
    .returning();
  const team = await createTeam(admin.id, "删除验证");
  for (const member of [student, teacher])
    await joinTeam(member.id, team.inviteCode);
  await updateMemberRole(admin.id, team.id, teacher.id, "teacher");
  const project = await createProject(admin.id, team.id, { name: "阶段节点" });
  const other = await createProject(admin.id, team.id, { name: "另一个项目" });
  const milestone = await createMilestone(admin.id, project.id, {
    title: "中期展示",
    targetDate: "2026-11-01",
  });
  return { admin, student, teacher, outsider, project, other, milestone };
}
beforeEach(resetDb);
describe("milestone deletion preserves work", () => {
  it("unlinks tasks/drafts, invalidates stale edits and preserves immutable submissions/feedback", async () => {
    const s = await scene();
    const task = await createTask(s.student.id, s.project.id, {
      title: "保留的任务",
      milestoneId: s.milestone.id,
    });
    const draft = await createDeliverableDraft(s.student.id, s.project.id, {
      requestId: randomUUID(),
      title: "阶段报告",
      type: "report",
      url: "https://example.com/report",
      milestoneId: s.milestone.id,
    });
    await submitDeliverable(s.student.id, s.project.id, draft.id, {
      requestId: randomUUID(),
      expectedRevision: draft.revision,
    });
    const [submittedVersion] = await db
      .select()
      .from(deliverableVersions)
      .where(eq(deliverableVersions.deliverableId, draft.id));
    const review = await reviewDeliverable(
      s.teacher.id,
      s.project.id,
      draft.id,
      {
        requestId: randomUUID(),
        versionId: submittedVersion.id,
        decision: "approved",
        comment: "通过",
      },
    );
    const editable = await startDeliverableRevision(
      s.student.id,
      s.project.id,
      draft.id,
      {
        requestId: randomUUID(),
        expectedRevision: review.deliverable.revision,
      },
    );
    await updateDeliverableDraft(s.student.id, s.project.id, draft.id, {
      expectedRevision: editable.revision,
      title: "下一版",
      type: "report",
      url: "https://example.com/v2",
      description: "修改",
      milestoneId: s.milestone.id,
    });
    const [before] = await db
      .select()
      .from(deliverables)
      .where(eq(deliverables.id, draft.id));
    const [version] = await db
      .select()
      .from(deliverableVersions)
      .where(eq(deliverableVersions.deliverableId, draft.id));
    await db.insert(deliverableFeedback).values({
      projectId: s.project.id,
      milestoneId: s.milestone.id,
      milestoneSnapshotId: s.milestone.id,
      milestoneTitle: s.milestone.title,
      reviewerId: s.teacher.id,
      decision: "comment",
      comment: "阶段记录",
      requestId: randomUUID(),
      requestHash: "fixture",
    });
    const preview = await previewMilestoneDeletion(
      s.admin.id,
      s.project.id,
      s.milestone.id,
    );
    expect(preview).toMatchObject({ taskCount: 1, deliverableCount: 1 });
    const request = { requestId: randomUUID(), expected: preview.expected };
    const removed = await deleteMilestone(
      s.admin.id,
      s.project.id,
      s.milestone.id,
      request,
    );
    expect(
      await deleteMilestone(s.admin.id, s.project.id, s.milestone.id, request),
    ).toEqual(removed);
    expect(
      await db
        .select()
        .from(milestones)
        .where(eq(milestones.id, s.milestone.id)),
    ).toHaveLength(0);
    const [remainingTask] = await db
      .select()
      .from(tasks)
      .where(eq(tasks.id, task.id));
    expect(remainingTask.milestoneId).toBeNull();
    expect(remainingTask.title).toBe(task.title);
    expect(remainingTask.updatedAt.getTime()).toBeGreaterThan(
      task.updatedAt.getTime(),
    );
    const [remaining] = await db
      .select()
      .from(deliverables)
      .where(eq(deliverables.id, draft.id));
    expect(remaining.milestoneId).toBeNull();
    expect(remaining.revision).toBe(before.revision + 1);
    expect(remaining.workingCopy).toMatchObject({
      title: "下一版",
      milestoneId: null,
      baseRevision: remaining.revision,
    });
    expect(
      (
        await db
          .select()
          .from(deliverableVersions)
          .where(eq(deliverableVersions.id, version.id))
      )[0],
    ).toEqual(version);
    const [feedback] = await db.select().from(deliverableFeedback);
    expect(feedback).toMatchObject({
      milestoneId: null,
      milestoneSnapshotId: s.milestone.id,
      milestoneTitle: s.milestone.title,
    });
  });
  it("denies students, teachers, outsiders, cross-project identifiers and archived projects", async () => {
    const s = await scene(),
      preview = await previewMilestoneDeletion(
        s.admin.id,
        s.project.id,
        s.milestone.id,
      );
    for (const actor of [s.student, s.teacher, s.outsider]) {
      await expect(
        previewMilestoneDeletion(actor.id, s.project.id, s.milestone.id),
      ).rejects.toThrow("没有权限");
      await expect(
        deleteMilestone(actor.id, s.project.id, s.milestone.id, {
          requestId: randomUUID(),
          expected: preview.expected,
        }),
      ).rejects.toThrow("没有权限");
    }
    await expect(
      deleteMilestone(s.admin.id, s.other.id, s.milestone.id, {
        requestId: randomUUID(),
        expected: preview.expected,
      }),
    ).rejects.toThrow("不存在");
    await db
      .update(projects)
      .set({ status: "archived" })
      .where(eq(projects.id, s.project.id));
    await expect(
      deleteMilestone(s.admin.id, s.project.id, s.milestone.id, {
        requestId: randomUUID(),
        expected: preview.expected,
      }),
    ).rejects.toThrow();
    expect(
      await db
        .select()
        .from(milestones)
        .where(eq(milestones.id, s.milestone.id)),
    ).toHaveLength(1);
  });
  it("rejects a stale confirmation and leaves the milestone intact", async () => {
    const s = await scene(),
      preview = await previewMilestoneDeletion(
        s.admin.id,
        s.project.id,
        s.milestone.id,
      );
    await db
      .update(milestones)
      .set({ title: "调整后的节点" })
      .where(eq(milestones.id, s.milestone.id));
    await expect(
      deleteMilestone(s.admin.id, s.project.id, s.milestone.id, {
        requestId: randomUUID(),
        expected: preview.expected,
      }),
    ).rejects.toThrow("已变化");
    expect(
      await db
        .select()
        .from(milestones)
        .where(eq(milestones.id, s.milestone.id)),
    ).toHaveLength(1);
  });
});
