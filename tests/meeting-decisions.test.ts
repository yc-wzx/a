import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db";
import { projects, teamMembers, users } from "@/db/schema";
import { createProject } from "@/lib/project";
import { createTeam, joinTeam, updateMemberRole } from "@/lib/team";
import { createProjectReference } from "@/lib/project-extras";
import {
  confirmMeetingDecision,
  listMeetingDecisions,
  removeMeetingDecision,
  saveMeetingDecision,
} from "@/lib/meeting-decisions";
import { resetDb } from "./helpers";

async function scene() {
  const [admin, student, peer, teacher, outsider] = await db
    .insert(users)
    .values(
      ["admin", "student", "peer", "teacher", "outsider"].map((name) => ({
        name,
        email: `${name}@decisions.test`,
        passwordHash: "fixture",
      })),
    )
    .returning();
  const team = await createTeam(admin.id, "决策测试团队");
  for (const user of [student, peer, teacher])
    await joinTeam(user.id, team.inviteCode);
  await updateMemberRole(admin.id, team.id, teacher.id, "teacher");
  const project = await createProject(admin.id, team.id, { name: "课程项目" });
  const meeting = await createProjectReference(student.id, project.id, {
    requestId: randomUUID(),
    type: "meeting",
    title: "周会",
    url: "https://meeting.tencent.com/test",
  });
  const input = {
    requestId: randomUUID(),
    title: "演示方案",
    adoptedOption: "采用学生操作流程",
    background: "先验证协作流程",
    confirmerIds: [student.id, teacher.id],
  };
  return {
    admin,
    student,
    peer,
    teacher,
    outsider,
    team,
    project,
    meeting,
    input,
  };
}

describe("versioned meeting decisions", () => {
  beforeEach(resetDb);

  it("creates once, rejects request reuse, and allows selected teachers to confirm their own version", async () => {
    const s = await scene();
    const decision = await saveMeetingDecision(
      s.student.id,
      s.project.id,
      s.meeting.id,
      s.input,
    );
    expect(
      await saveMeetingDecision(
        s.student.id,
        s.project.id,
        s.meeting.id,
        s.input,
      ),
    ).toEqual(decision);
    await expect(
      saveMeetingDecision(s.student.id, s.project.id, s.meeting.id, {
        ...s.input,
        title: "另一个方案",
      }),
    ).rejects.toThrow("不同内容");
    const confirmation = {
      requestId: randomUUID(),
      decisionId: decision.id,
      expectedRevision: 1,
    };
    await confirmMeetingDecision(
      s.teacher.id,
      s.project.id,
      s.meeting.id,
      confirmation,
    );
    const before = (
      await listMeetingDecisions(s.student.id, s.project.id, [s.meeting.id])
    )[0];
    await confirmMeetingDecision(
      s.teacher.id,
      s.project.id,
      s.meeting.id,
      confirmation,
    );
    const after = (
      await listMeetingDecisions(s.student.id, s.project.id, [s.meeting.id])
    )[0];
    expect(after.versions).toEqual(before.versions);
    expect(
      after.versions[0].confirmations.find(
        (item) => item.userId === s.teacher.id,
      ),
    ).toMatchObject({
      name: "teacher",
      confirmedAt: expect.any(String),
      canConfirm: false,
    });
    expect(
      after.versions[0].confirmations.find(
        (item) => item.userId === s.student.id,
      )?.confirmedAt,
    ).toBeNull();
    await expect(
      confirmMeetingDecision(s.peer.id, s.project.id, s.meeting.id, {
        ...confirmation,
        requestId: randomUUID(),
      }),
    ).rejects.toThrow("确认名单");
  });

  it("retains historical receipts and creates fresh confirmations only when content or members change", async () => {
    const s = await scene();
    const decision = await saveMeetingDecision(
      s.student.id,
      s.project.id,
      s.meeting.id,
      s.input,
    );
    await confirmMeetingDecision(s.teacher.id, s.project.id, s.meeting.id, {
      requestId: randomUUID(),
      decisionId: decision.id,
      expectedRevision: 1,
    });
    const update = {
      ...s.input,
      requestId: randomUUID(),
      decisionId: decision.id,
      expectedRevision: 1,
    };
    expect(
      (
        await saveMeetingDecision(
          s.student.id,
          s.project.id,
          s.meeting.id,
          update,
        )
      ).revision,
    ).toBe(1);
    expect(
      (
        await saveMeetingDecision(s.student.id, s.project.id, s.meeting.id, {
          ...update,
          requestId: randomUUID(),
          adoptedOption: "增加教师反馈环节",
        })
      ).revision,
    ).toBe(2);
    const record = (
      await listMeetingDecisions(s.teacher.id, s.project.id, [s.meeting.id])
    )[0];
    expect(record.versions).toHaveLength(2);
    expect(
      record.versions[0].confirmations.every(
        (item) => item.confirmedAt === null,
      ),
    ).toBe(true);
    expect(
      record.versions[0].confirmations.find(
        (item) => item.userId === s.teacher.id,
      )?.canConfirm,
    ).toBe(true);
    expect(
      record.versions[1].confirmations.find(
        (item) => item.userId === s.teacher.id,
      ),
    ).toMatchObject({ confirmedAt: expect.any(String), canConfirm: false });
    await expect(
      confirmMeetingDecision(s.teacher.id, s.project.id, s.meeting.id, {
        requestId: randomUUID(),
        decisionId: decision.id,
        expectedRevision: 1,
      }),
    ).rejects.toThrow("方案已更新");
    await saveMeetingDecision(s.student.id, s.project.id, s.meeting.id, {
      ...update,
      requestId: randomUUID(),
      expectedRevision: 2,
      adoptedOption: "增加教师反馈环节",
      confirmerIds: [s.peer.id],
    });
    expect(
      (await listMeetingDecisions(s.peer.id, s.project.id, [s.meeting.id]))[0]
        .versions[0].confirmations,
    ).toMatchObject([{ userId: s.peer.id, confirmedAt: null }]);
  });

  it("authorizes project membership, creator/admin edits, valid meetings and current confirmer membership", async () => {
    const s = await scene();
    await expect(
      saveMeetingDecision(s.outsider.id, s.project.id, s.meeting.id, s.input),
    ).rejects.toThrow();
    await expect(
      listMeetingDecisions(s.outsider.id, s.project.id, [s.meeting.id]),
    ).rejects.toThrow();
    await expect(
      saveMeetingDecision(s.student.id, s.project.id, s.meeting.id, {
        ...s.input,
        confirmerIds: [s.outsider.id],
      }),
    ).rejects.toThrow("当前团队成员");
    await expect(
      saveMeetingDecision(s.student.id, s.project.id, randomUUID(), s.input),
    ).rejects.toThrow("会议记录");
    const decision = await saveMeetingDecision(
      s.student.id,
      s.project.id,
      s.meeting.id,
      s.input,
    );
    await expect(
      saveMeetingDecision(s.peer.id, s.project.id, s.meeting.id, {
        ...s.input,
        requestId: randomUUID(),
        decisionId: decision.id,
        expectedRevision: 1,
      }),
    ).rejects.toThrow("记录人或管理员");
    await db
      .delete(teamMembers)
      .where(
        and(
          eq(teamMembers.teamId, s.team.id),
          eq(teamMembers.userId, s.teacher.id),
        ),
      );
    const record = (
      await listMeetingDecisions(s.student.id, s.project.id, [s.meeting.id])
    )[0];
    expect(
      record.versions[0].confirmations.find(
        (item) => item.userId === s.teacher.id,
      )?.active,
    ).toBe(false);
    await expect(
      confirmMeetingDecision(s.teacher.id, s.project.id, s.meeting.id, {
        requestId: randomUUID(),
        decisionId: decision.id,
        expectedRevision: 1,
      }),
    ).rejects.toThrow();
    const remove = {
      requestId: randomUUID(),
      decisionId: decision.id,
      expectedRevision: 1,
    };
    await expect(
      removeMeetingDecision(s.peer.id, s.project.id, s.meeting.id, remove),
    ).rejects.toThrow("记录人或管理员");
    await removeMeetingDecision(s.admin.id, s.project.id, s.meeting.id, remove);
    await removeMeetingDecision(s.admin.id, s.project.id, s.meeting.id, remove);
    expect(
      await listMeetingDecisions(s.student.id, s.project.id, [s.meeting.id]),
    ).toEqual([]);
  });

  it("serializes simultaneous revisions and confirmation without reusing a receipt for changed content", async () => {
    const s = await scene();
    const decision = await saveMeetingDecision(
      s.student.id,
      s.project.id,
      s.meeting.id,
      s.input,
    );
    const results = await Promise.allSettled(
      ["方案 A", "方案 B"].map((adoptedOption) =>
        saveMeetingDecision(s.student.id, s.project.id, s.meeting.id, {
          ...s.input,
          requestId: randomUUID(),
          decisionId: decision.id,
          expectedRevision: 1,
          adoptedOption,
        }),
      ),
    );
    expect(results.filter((item) => item.status === "fulfilled")).toHaveLength(
      1,
    );
    expect(results.filter((item) => item.status === "rejected")).toHaveLength(
      1,
    );
    await Promise.allSettled([
      confirmMeetingDecision(s.teacher.id, s.project.id, s.meeting.id, {
        requestId: randomUUID(),
        decisionId: decision.id,
        expectedRevision: 2,
      }),
      saveMeetingDecision(s.student.id, s.project.id, s.meeting.id, {
        ...s.input,
        requestId: randomUUID(),
        decisionId: decision.id,
        expectedRevision: 2,
        adoptedOption: "最终方案",
      }),
    ]);
    const record = (
      await listMeetingDecisions(s.student.id, s.project.id, [s.meeting.id])
    )[0];
    expect(record.revision).toBe(3);
    expect(
      record.versions[0].confirmations.every(
        (item) => item.confirmedAt === null,
      ),
    ).toBe(true);
  });

  it("keeps archived project history readable and rejects every mutation including replays", async () => {
    const s = await scene();
    const decision = await saveMeetingDecision(
      s.student.id,
      s.project.id,
      s.meeting.id,
      s.input,
    );
    await db
      .update(projects)
      .set({ status: "archived" })
      .where(eq(projects.id, s.project.id));
    const record = (
      await listMeetingDecisions(s.teacher.id, s.project.id, [s.meeting.id])
    )[0];
    expect(record.canManage).toBe(false);
    expect(
      record.versions[0].confirmations.every((item) => !item.canConfirm),
    ).toBe(true);
    const input = {
      requestId: randomUUID(),
      decisionId: decision.id,
      expectedRevision: 1,
    };
    await expect(
      saveMeetingDecision(s.student.id, s.project.id, s.meeting.id, s.input),
    ).rejects.toThrow("归档");
    await expect(
      confirmMeetingDecision(s.teacher.id, s.project.id, s.meeting.id, input),
    ).rejects.toThrow("归档");
    await expect(
      removeMeetingDecision(s.admin.id, s.project.id, s.meeting.id, input),
    ).rejects.toThrow("归档");
  });
});
