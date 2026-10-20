import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db";
import { assistantMemories, personalScheduleEvents, projects, teams, users } from "@/db/schema";
import { projectDocuments } from "@/db/documents-schema";
import { resourceReservations, teamJoinRequests, teamManagementSettings } from "@/db/team-management-schema";
import { createTeam, getTeamMembership, joinTeam, updateMemberRole } from "@/lib/team";
import { createProject, updateProject } from "@/lib/project";
import { deleteArchivedTeam, getTeamManagement, previewTeamDeletion, reviewTeamJoinRequest, setTeamArchived, updateTeamInvitation } from "@/lib/team-management";
import { cancelResourceReservation, createResourceReservation, createResourceUsage, listTeamResourceReservations, reviewResourceReservation } from "@/lib/resource";
import { resetDb } from "./helpers";

async function scene() {
  const [admin, student, teacher, outsider] = await db.insert(users).values(["admin", "student", "teacher", "outsider"].map(name => ({ name, email: `${name}@team-extension.test`, passwordHash: "fixture" }))).returning();
  const team = await createTeam(admin.id, "课程资源团队");
  await joinTeam(student.id, team.inviteCode); await joinTeam(teacher.id, team.inviteCode);
  await updateMemberRole(admin.id, team.id, teacher.id, "teacher");
  return { admin, student, teacher, outsider, team };
}
const hour = (h: number) => new Date(`2030-10-20T${String(h).padStart(2, "0")}:00:00Z`);
const booking = (start = 8, end = 9, resourceName = "GPU-01") => ({ resourceName, purpose: "课程实验", startTime: hour(start), endTime: hour(end) });
async function invitation(s: Awaited<ReturnType<typeof scene>>, patch: Partial<Parameters<typeof updateTeamInvitation>[2]> = {}) {
  const data = await getTeamManagement(s.admin.id, s.team.id);
  return updateTeamInvitation(s.admin.id, s.team.id, { revision: data.settings.revision, enabled: true, requireApproval: false, lifetimeDays: 7, rotate: false, ...patch });
}
describe("team invitation and lifecycle extensions", () => {
  beforeEach(resetDb);
  it("supports old unconfigured invitations and prevents expired or disabled use", async () => {
    const s = await scene();
    await invitation(s);
    await db.update(teamManagementSettings).set({ inviteExpiresAt: new Date(0) }).where(eq(teamManagementSettings.teamId, s.team.id));
    await expect(joinTeam(s.outsider.id, s.team.inviteCode)).rejects.toThrow("过期");
    await invitation(s, { enabled: false });
    await expect(joinTeam(s.outsider.id, s.team.inviteCode)).rejects.toThrow("已关闭");
    expect(await getTeamMembership(s.student.id, s.team.id)).toBeTruthy();
  });
  it("rotates immediately, validates stale revision and restricts management to admin", async () => {
    const s = await scene(); const initial = await getTeamManagement(s.admin.id, s.team.id);
    await invitation(s, { rotate: true });
    await expect(joinTeam(s.outsider.id, s.team.inviteCode)).rejects.toThrow("邀请码无效");
    const [team] = await db.select().from(teams).where(eq(teams.id, s.team.id));
    const member = await joinTeam(s.outsider.id, team.inviteCode);
    expect(member.teamId).toBe(s.team.id);
    await expect(updateTeamInvitation(s.admin.id, s.team.id, { revision: initial.settings.revision, enabled: true, requireApproval: false, lifetimeDays: 7, rotate: false })).rejects.toThrow("已变化");
    await expect(getTeamManagement(s.teacher.id, s.team.id)).rejects.toThrow("没有权限");
  });
  it("deduplicates pending applications and approves exactly once as student", async () => {
    const s = await scene(); await invitation(s, { requireApproval: true });
    const first = await joinTeam(s.outsider.id, s.team.inviteCode);
    const second = await joinTeam(s.outsider.id, s.team.inviteCode);
    expect(first.id).toBe(second.id); expect("pendingApproval" in first).toBe(true);
    expect(await getTeamMembership(s.outsider.id, s.team.id)).toBeNull();
    await expect(reviewTeamJoinRequest(s.teacher.id, s.team.id, first.id, true)).rejects.toThrow("没有权限");
    const results = await Promise.allSettled([reviewTeamJoinRequest(s.admin.id, s.team.id, first.id, true), reviewTeamJoinRequest(s.admin.id, s.team.id, first.id, true)]);
    expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
    expect((await getTeamMembership(s.outsider.id, s.team.id))?.role).toBe("student");
    expect(await db.select().from(teamJoinRequests)).toHaveLength(1);
  });
  it("allows rejected applicants to resubmit with a current invitation", async () => {
    const s = await scene(); await invitation(s, { requireApproval: true });
    const request = await joinTeam(s.outsider.id, s.team.inviteCode);
    await reviewTeamJoinRequest(s.admin.id, s.team.id, request.id, false);
    expect(await getTeamMembership(s.outsider.id, s.team.id)).toBeNull();
    expect((await joinTeam(s.outsider.id, s.team.inviteCode)).id).toBe(request.id);
    expect((await db.select().from(teamJoinRequests))[0].status).toBe("pending");
  });
  it("requires all projects archived, pauses writes and resumes explicitly", async () => {
    const s = await scene(); const project = await createProject(s.admin.id, s.team.id, { name: "课程项目" });
    const data = await getTeamManagement(s.admin.id, s.team.id);
    await expect(setTeamArchived(s.admin.id, s.team.id, true, data.settings.revision)).rejects.toThrow("全部项目");
    await updateProject(s.admin.id, project.id, { status: "archived" });
    const archived = await setTeamArchived(s.admin.id, s.team.id, true, data.settings.revision);
    await expect(joinTeam(s.outsider.id, s.team.inviteCode)).rejects.toThrow("归档");
    await expect(createProject(s.admin.id, s.team.id, { name: "不应创建" })).rejects.toThrow("归档");
    await expect(updateProject(s.admin.id, project.id, { status: "active" })).rejects.toThrow("归档");
    await expect(updateMemberRole(s.admin.id, s.team.id, s.student.id, "teacher")).rejects.toThrow("归档");
    await expect(createResourceReservation(s.student.id, s.team.id, booking())).rejects.toThrow("归档");
    await setTeamArchived(s.admin.id, s.team.id, false, archived.revision);
    expect((await createProject(s.admin.id, s.team.id, { name: "恢复后项目" })).name).toBe("恢复后项目");
  });
  it("requires archive, exact team name and fresh deletion preview", async () => {
    const s = await scene(); const data = await getTeamManagement(s.admin.id, s.team.id);
    const first = await previewTeamDeletion(s.admin.id, s.team.id);
    await expect(previewTeamDeletion(s.student.id, s.team.id)).rejects.toThrow("没有权限");
    await expect(deleteArchivedTeam(s.admin.id, s.team.id, { name: s.team.name, token: first.token })).rejects.toThrow("先归档");
    await setTeamArchived(s.admin.id, s.team.id, true, data.settings.revision);
    await expect(deleteArchivedTeam(s.admin.id, s.team.id, { name: s.team.name, token: first.token })).rejects.toThrow("内容已变化");
    const preview = await previewTeamDeletion(s.admin.id, s.team.id);
    await expect(deleteArchivedTeam(s.admin.id, s.team.id, { name: "打错名称", token: preview.token })).rejects.toThrow("完整团队名称");
    expect(await db.select().from(teams)).toHaveLength(1);
  });
  it("deletes team private documents and project memories while preserving global identities and other teams", async () => {
    const s = await scene(); const project = await createProject(s.admin.id, s.team.id, { name: "将删除项目" });
    const otherTeam = await createTeam(s.admin.id, "另一个团队"); const otherProject = await createProject(s.admin.id, otherTeam.id, { name: "保留项目" });
    await db.insert(projectDocuments).values([{ projectId: project.id, ownerId: s.student.id, title: "私人文档", visibility: "private", state: "", content: { type: "doc", content: [] } }, { projectId: otherProject.id, ownerId: s.student.id, title: "保留文档", state: "", content: { type: "doc", content: [] } }]);
    await db.insert(assistantMemories).values([{ userId: s.student.id, projectId: project.id, content: "项目记忆" }, { userId: s.student.id, content: "全局记忆" }]);
    await db.insert(personalScheduleEvents).values({ userId: s.student.id, title: "私人课程", startAt: hour(1), endAt: hour(2), fingerprint: "private-course", source: "manual", revision: 1 });
    await updateProject(s.admin.id, project.id, { status: "archived" });
    const data = await getTeamManagement(s.admin.id, s.team.id); await setTeamArchived(s.admin.id, s.team.id, true, data.settings.revision);
    const preview = await previewTeamDeletion(s.admin.id, s.team.id);
    expect(preview.counts.projects).toBe(1); expect(preview.counts.documents).toBe(1);
    const deleted = await deleteArchivedTeam(s.admin.id, s.team.id, { name: s.team.name, token: preview.token });
    expect(deleted.projectIds).toEqual([project.id]);
    expect(await db.select().from(users)).toHaveLength(4);
    expect(await db.select().from(teams)).toHaveLength(1);
    expect((await db.select().from(projects))[0].id).toBe(otherProject.id);
    expect((await db.select().from(projectDocuments))[0].title).toBe("保留文档");
    expect((await db.select().from(assistantMemories))[0].content).toBe("全局记忆");
    expect(await db.select().from(personalScheduleEvents)).toHaveLength(1);
  });
});
describe("resource reservation approval and conflict isolation", () => {
  beforeEach(resetDb);
  it("shows pending bookings separately and allows only teacher/admin to approve", async () => {
    const s = await scene(); const request = await createResourceReservation(s.student.id, s.team.id, booking());
    expect(request.status).toBe("pending");
    await expect(reviewResourceReservation(s.student.id, request.id, { approve: true, revision: 1 })).rejects.toThrow("没有权限");
    const approved = await reviewResourceReservation(s.teacher.id, request.id, { approve: true, revision: 1, note: "实验后归还" });
    expect(approved.status).toBe("approved"); expect(approved.reviewNote).toBe("实验后归还");
    await expect(reviewResourceReservation(s.admin.id, request.id, { approve: true, revision: 1 })).rejects.toThrow("已被处理");
    expect((await listTeamResourceReservations(s.student.id, s.team.id))[0].userName).toBe("student");
  });
  it("serializes competing approvals for normalized same resource", async () => {
    const s = await scene();
    const one = await createResourceReservation(s.student.id, s.team.id, booking(8, 10));
    const two = await createResourceReservation(s.admin.id, s.team.id, booking(9, 11, "  ｇｐｕ-01  "));
    const results = await Promise.allSettled([reviewResourceReservation(s.teacher.id, one.id, { approve: true, revision: 1 }), reviewResourceReservation(s.admin.id, two.id, { approve: true, revision: 1 })]);
    expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
    expect((await db.select().from(resourceReservations)).filter(r => r.status === "approved")).toHaveLength(1);
  });
  it("allows adjacent slots and releases an approved slot when owner cancels", async () => {
    const s = await scene(); const one = await createResourceReservation(s.student.id, s.team.id, booking());
    await reviewResourceReservation(s.teacher.id, one.id, { approve: true, revision: 1 });
    const adjacent = await createResourceReservation(s.admin.id, s.team.id, booking(9, 10));
    await reviewResourceReservation(s.teacher.id, adjacent.id, { approve: true, revision: 1 });
    await expect(cancelResourceReservation(s.admin.id, one.id, 2)).rejects.toThrow("没有权限");
    await cancelResourceReservation(s.student.id, one.id, 2);
    const replacement = await createResourceReservation(s.admin.id, s.team.id, booking());
    expect((await reviewResourceReservation(s.teacher.id, replacement.id, { approve: true, revision: 1 })).status).toBe("approved");
  });
  it("checks actual usage again on approval and preserves legacy usage registration", async () => {
    const s = await scene(); const request = await createResourceReservation(s.student.id, s.team.id, booking());
    await createResourceUsage(s.admin.id, s.team.id, { resourceName: "gpu-01", startTime: hour(8), endTime: hour(9) });
    await expect(reviewResourceReservation(s.teacher.id, request.id, { approve: true, revision: 1 })).rejects.toThrow("实际占用");
    const rejected = await reviewResourceReservation(s.teacher.id, request.id, { approve: false, revision: 1 }); expect(rejected.status).toBe("rejected");
  });
  it("prevents actual usage overwriting another member's approved booking", async () => {
    const s = await scene(); const request = await createResourceReservation(s.student.id, s.team.id, booking());
    await reviewResourceReservation(s.teacher.id, request.id, { approve: true, revision: 1 });
    await expect(createResourceUsage(s.admin.id, s.team.id, { resourceName: "GPU-01", startTime: hour(8), endTime: hour(9) })).rejects.toThrow("获批");
    expect((await createResourceUsage(s.student.id, s.team.id, { resourceName: "GPU-01", startTime: hour(8), endTime: hour(9) })).userId).toBe(s.student.id);
  });
  it("rejects outsiders and invalid ranges without exposing other teams' schedules", async () => {
    const s = await scene(); const request = await createResourceReservation(s.student.id, s.team.id, booking());
    await expect(listTeamResourceReservations(s.outsider.id, s.team.id)).rejects.toThrow("没有权限");
    await expect(reviewResourceReservation(s.outsider.id, request.id, { approve: true, revision: 1 })).rejects.toThrow("没有权限");
    await expect(createResourceReservation(s.student.id, s.team.id, booking(10, 8))).rejects.toThrow("结束时间");
    const other = await createTeam(s.outsider.id, "其他团队");
    const parallel = await createResourceReservation(s.outsider.id, other.id, booking());
    expect((await reviewResourceReservation(s.outsider.id, parallel.id, { approve: true, revision: 1 })).status).toBe("approved");
    expect(await listTeamResourceReservations(s.student.id, s.team.id)).toHaveLength(1);
  });
});
