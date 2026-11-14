import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { db, type DbTx } from "@/db";
import {
  meetingDecisions,
  meetingDecisionVersions,
  meetingDecisionConfirmations,
} from "@/db/meeting-decisions-schema";
import { projectReferences, teamMembers, users } from "@/db/schema";
import { referenceProjectAccess } from "./project-extras";
import { readProject } from "./project-read";
import { ConflictError, ForbiddenError, NotFoundError } from "./errors";
import {
  claimWriteRequest,
  finishWriteRequest,
  hashRequest,
} from "./write-request";

const revisionSchema = z.number().int().min(1).max(2147483646);
const decisionContent = z.strictObject({
  title: z.string().trim().min(1, "请填写决策主题").max(140),
  adoptedOption: z.string().trim().min(1, "请填写采用方案").max(2000),
  background: z.string().trim().max(5000).default(""),
  confirmerIds: z
    .array(z.uuid())
    .min(1, "请至少选择一位确认成员")
    .max(100)
    .transform((ids) => [...new Set(ids)].sort()),
});
export const saveMeetingDecisionSchema = decisionContent
  .extend({
    requestId: z.uuid(),
    decisionId: z.uuid().optional(),
    expectedRevision: revisionSchema.optional(),
  })
  .refine(
    (value) => Boolean(value.decisionId) === Boolean(value.expectedRevision),
    "请刷新决策记录后再保存",
  );
const mutationSchema = z.strictObject({
  requestId: z.uuid(),
  decisionId: z.uuid(),
  expectedRevision: revisionSchema,
});

async function meetingWrite<T>(
  actorId: string,
  projectId: string,
  referenceId: string,
  requestId: string,
  operation: string,
  payload: unknown,
  run: (tx: DbTx, role: string) => Promise<T>,
): Promise<T> {
  z.uuid().parse(referenceId);
  return db.transaction(async (tx) => {
    const access = await referenceProjectAccess(tx, actorId, projectId, true);
    const [meeting] = await tx
      .select({ id: projectReferences.id })
      .from(projectReferences)
      .where(
        and(
          eq(projectReferences.id, referenceId),
          eq(projectReferences.projectId, projectId),
          eq(projectReferences.type, "meeting"),
        ),
      )
      .for("share");
    if (!meeting)
      throw new NotFoundError("会议记录不存在或类型已改变，请刷新页面");
    const claim = await claimWriteRequest(
      tx,
      { actorId, projectId, operation, requestId },
      hashRequest({ referenceId, payload }),
    );
    if (claim.replay) return claim.result as T;
    return finishWriteRequest(tx, claim.id, await run(tx, access.role));
  });
}

async function lockedDecision(
  tx: DbTx,
  projectId: string,
  referenceId: string,
  decisionId: string,
  revision: number,
) {
  const [decision] = await tx
    .select()
    .from(meetingDecisions)
    .where(
      and(
        eq(meetingDecisions.id, decisionId),
        eq(meetingDecisions.projectId, projectId),
        eq(meetingDecisions.referenceId, referenceId),
        isNull(meetingDecisions.deletedAt),
      ),
    )
    .for("update");
  if (!decision) throw new NotFoundError("决策记录不存在");
  if (decision.revision !== revision)
    throw new ConflictError("方案已更新，请载入最新版本后再操作");
  return decision;
}

export async function saveMeetingDecision(
  actorId: string,
  projectId: string,
  referenceId: string,
  input: unknown,
) {
  const data = saveMeetingDecisionSchema.parse(input);
  return meetingWrite(
    actorId,
    projectId,
    referenceId,
    data.requestId,
    data.decisionId ? "meeting.decision.update" : "meeting.decision.create",
    data,
    async (tx, role) => {
      const access = await referenceProjectAccess(tx, actorId, projectId);
      const members = await tx
        .select({ id: users.id, name: users.name })
        .from(teamMembers)
        .innerJoin(users, eq(users.id, teamMembers.userId))
        .where(
          and(
            eq(teamMembers.teamId, access.project.teamId),
            inArray(teamMembers.userId, data.confirmerIds),
          ),
        )
        .for("share", { of: [teamMembers] });
      if (members.length !== data.confirmerIds.length)
        throw new ForbiddenError("请只选择当前团队成员确认");
      let decision;
      if (data.decisionId) {
        decision = await lockedDecision(
          tx,
          projectId,
          referenceId,
          data.decisionId,
          data.expectedRevision!,
        );
        if (decision.createdById !== actorId && role !== "admin")
          throw new ForbiddenError("由记录人或管理员修改决策");
        const [current] = await tx
          .select()
          .from(meetingDecisionVersions)
          .where(
            and(
              eq(meetingDecisionVersions.decisionId, decision.id),
              eq(meetingDecisionVersions.revision, decision.revision),
            ),
          );
        const confirmations = await tx
          .select({ id: meetingDecisionConfirmations.memberId })
          .from(meetingDecisionConfirmations)
          .where(eq(meetingDecisionConfirmations.versionId, current.id));
        if (
          current.title === data.title &&
          current.adoptedOption === data.adoptedOption &&
          current.background === data.background &&
          confirmations
            .map((item) => item.id)
            .sort()
            .join() === data.confirmerIds.join()
        )
          return { id: decision.id, revision: decision.revision };
        [decision] = await tx
          .update(meetingDecisions)
          .set({ revision: decision.revision + 1 })
          .where(eq(meetingDecisions.id, decision.id))
          .returning();
      } else {
        [decision] = await tx
          .insert(meetingDecisions)
          .values({ projectId, referenceId, createdById: actorId })
          .returning();
      }
      const [version] = await tx
        .insert(meetingDecisionVersions)
        .values({
          decisionId: decision.id,
          revision: decision.revision,
          title: data.title,
          adoptedOption: data.adoptedOption,
          background: data.background,
          createdById: actorId,
        })
        .returning();
      await tx
        .insert(meetingDecisionConfirmations)
        .values(
          members.map((member) => ({
            versionId: version.id,
            memberId: member.id,
            userId: member.id,
            userName: member.name ?? "成员",
          })),
        );
      return { id: decision.id, revision: decision.revision };
    },
  );
}

export async function confirmMeetingDecision(
  actorId: string,
  projectId: string,
  referenceId: string,
  input: unknown,
) {
  const data = mutationSchema.parse(input);
  return meetingWrite(
    actorId,
    projectId,
    referenceId,
    data.requestId,
    "meeting.decision.confirm",
    data,
    async (tx) => {
      const decision = await lockedDecision(
        tx,
        projectId,
        referenceId,
        data.decisionId,
        data.expectedRevision,
      );
      const [version] = await tx
        .select()
        .from(meetingDecisionVersions)
        .where(
          and(
            eq(meetingDecisionVersions.decisionId, decision.id),
            eq(meetingDecisionVersions.revision, decision.revision),
          ),
        );
      const [confirmation] = await tx
        .select()
        .from(meetingDecisionConfirmations)
        .where(
          and(
            eq(meetingDecisionConfirmations.versionId, version.id),
            eq(meetingDecisionConfirmations.userId, actorId),
          ),
        )
        .for("update");
      if (!confirmation) throw new ForbiddenError("你不在本版方案的确认名单中");
      if (!confirmation.confirmedAt)
        await tx
          .update(meetingDecisionConfirmations)
          .set({ confirmedAt: new Date() })
          .where(
            and(
              eq(meetingDecisionConfirmations.versionId, version.id),
              eq(meetingDecisionConfirmations.memberId, actorId),
            ),
          );
      return { id: decision.id, revision: decision.revision };
    },
  );
}

export async function removeMeetingDecision(
  actorId: string,
  projectId: string,
  referenceId: string,
  input: unknown,
) {
  const data = mutationSchema.parse(input);
  return meetingWrite(
    actorId,
    projectId,
    referenceId,
    data.requestId,
    "meeting.decision.remove",
    data,
    async (tx, role) => {
      const decision = await lockedDecision(
        tx,
        projectId,
        referenceId,
        data.decisionId,
        data.expectedRevision,
      );
      if (decision.createdById !== actorId && role !== "admin")
        throw new ForbiddenError("由记录人或管理员移除决策");
      await tx
        .update(meetingDecisions)
        .set({ deletedAt: new Date() })
        .where(eq(meetingDecisions.id, decision.id));
      return { id: decision.id };
    },
  );
}

export async function listMeetingDecisions(
  actorId: string,
  projectId: string,
  referenceIds: string[],
) {
  referenceIds.forEach((id) => z.uuid().parse(id));
  return readProject(actorId, projectId, async (tx) => {
    if (!referenceIds.length) return [];
    const access = await referenceProjectAccess(tx, actorId, projectId);
    const activeMembers = await tx
      .select({ id: teamMembers.userId })
      .from(teamMembers)
      .where(eq(teamMembers.teamId, access.project.teamId));
    const activeIds = new Set(activeMembers.map((member) => member.id));
    const decisions = await tx
      .select({ decision: meetingDecisions, creatorName: users.name })
      .from(meetingDecisions)
      .innerJoin(
        projectReferences,
        and(
          eq(projectReferences.id, meetingDecisions.referenceId),
          eq(projectReferences.projectId, projectId),
          eq(projectReferences.type, "meeting"),
        ),
      )
      .leftJoin(users, eq(users.id, meetingDecisions.createdById))
      .where(
        and(
          eq(meetingDecisions.projectId, projectId),
          inArray(meetingDecisions.referenceId, referenceIds),
          isNull(meetingDecisions.deletedAt),
        ),
      )
      .orderBy(asc(meetingDecisions.createdAt));
    if (!decisions.length) return [];
    const versions = await tx
      .select()
      .from(meetingDecisionVersions)
      .where(
        inArray(
          meetingDecisionVersions.decisionId,
          decisions.map((item) => item.decision.id),
        ),
      )
      .orderBy(desc(meetingDecisionVersions.revision));
    const confirmations = await tx
      .select()
      .from(meetingDecisionConfirmations)
      .where(
        inArray(
          meetingDecisionConfirmations.versionId,
          versions.map((version) => version.id),
        ),
      )
      .orderBy(asc(meetingDecisionConfirmations.memberId));
    return decisions.map(({ decision, creatorName }) => ({
      id: decision.id,
      referenceId: decision.referenceId,
      revision: decision.revision,
      creatorName: creatorName ?? "原成员",
      createdAt: decision.createdAt.toISOString(),
      canManage:
        access.project.status !== "archived" &&
        (decision.createdById === actorId || access.role === "admin"),
      versions: versions
        .filter((version) => version.decisionId === decision.id)
        .map((version) => ({
          id: version.id,
          revision: version.revision,
          title: version.title,
          adoptedOption: version.adoptedOption,
          background: version.background,
          createdAt: version.createdAt.toISOString(),
          confirmations: confirmations
            .filter((item) => item.versionId === version.id)
            .map((item) => ({
              userId: item.memberId,
              name: item.userName,
              confirmedAt: item.confirmedAt?.toISOString() ?? null,
              active: activeIds.has(item.memberId),
              canConfirm:
                version.revision === decision.revision &&
                access.project.status !== "archived" &&
                item.userId === actorId &&
                !item.confirmedAt,
            })),
        })),
    }));
  });
}
export type MeetingDecision = Awaited<
  ReturnType<typeof listMeetingDecisions>
>[number];
