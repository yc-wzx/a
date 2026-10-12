import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db";
import { users, teamMembers } from "@/db/schema";
import { createTeam, joinTeam } from "@/lib/team";
import { createProject, updateProject } from "@/lib/project";
import { createTask, updateTask } from "@/lib/task";
import { importMySchedule } from "@/lib/schedule/store";
import {
  getDashboardContext,
  getDashboardProjects,
} from "@/lib/dashboard-context";
import { resetDb } from "./helpers";

async function scene() {
  const [owner, student, outsider] = await db
    .insert(users)
    .values(
      ["owner", "student", "outsider"].map((name) => ({
        name,
        email: name + "@workspace.test",
        passwordHash: "fixture",
      })),
    )
    .returning();
  const team = await createTeam(owner.id, "工作台测试团队");
  await joinTeam(student.id, team.inviteCode);
  const project = await createProject(owner.id, team.id, {
    name: "交互设计课程",
  });
  return { owner, student, outsider, team, project };
}
describe("personal workspace context", () => {
  beforeEach(resetDb);
  it("returns real task progress including subtasks, and each current role", async () => {
    const { owner, student, project } = await scene();
    const parent = await createTask(owner.id, project.id, { title: "主任务" });
    const child = await createTask(owner.id, project.id, {
      title: "子任务",
      parentTaskId: parent.id,
    });
    await updateTask(owner.id, child.id, { status: "done" });
    expect((await getDashboardProjects(student.id)).items[0]).toMatchObject({
      id: project.id,
      role: "student",
      taskTotal: 2,
      doneCount: 1,
    });
    expect((await getDashboardProjects(owner.id)).items[0].role).toBe("admin");
  });
  it("hides archived, unrelated and departed projects", async () => {
    const { owner, student, outsider, team, project } = await scene();
    expect(await getDashboardProjects(outsider.id)).toEqual({
      items: [],
      total: 0,
    });
    await updateProject(owner.id, project.id, { status: "archived" });
    expect((await getDashboardProjects(student.id)).total).toBe(0);
    await updateProject(owner.id, project.id, { status: "active" });
    await db
      .delete(teamMembers)
      .where(
        and(
          eq(teamMembers.teamId, team.id),
          eq(teamMembers.userId, student.id),
        ),
      );
    expect((await getDashboardProjects(student.id)).total).toBe(0);
  });
  it("bounds project cards while preserving the full accessible count", async () => {
    const { owner, student, team } = await scene();
    for (let i = 0; i < 7; i++)
      await createProject(owner.id, team.id, { name: `项目${i}` });
    const data = await getDashboardProjects(student.id);
    expect(data.total).toBe(8);
    expect(data.items).toHaveLength(6);
    expect(new Set(data.items.map((p) => p.id)).size).toBe(6);
  });
  it("includes only own events intersecting the Beijing day, without sharing settings", async () => {
    const { student, outsider } = await scene();
    await importMySchedule(student.id, {
      requestId: randomUUID(),
      source: "manual",
      events: [
        {
          title: "跨日课程",
          startAt: "2026-10-11T15:30:00Z",
          endAt: "2026-10-11T16:30:00Z",
        },
        {
          title: "今天实验",
          startAt: "2026-10-12T01:00:00Z",
          endAt: "2026-10-12T03:00:00Z",
        },
        {
          title: "明天课程",
          startAt: "2026-10-12T16:00:00Z",
          endAt: "2026-10-12T17:00:00Z",
        },
      ],
    });
    await importMySchedule(outsider.id, {
      requestId: randomUUID(),
      source: "manual",
      events: [
        {
          title: "别人的私事",
          startAt: "2026-10-12T01:00:00Z",
          endAt: "2026-10-12T02:00:00Z",
        },
      ],
    });
    const result = await getDashboardContext(student.id, "2026-10-12");
    expect(result.schedule.state).toBe("ready");
    if (result.schedule.state !== "ready") throw Error("Schedule unavailable");
    expect(result.schedule.data.items.map((e) => e.title)).toEqual([
      "跨日课程",
      "今天实验",
    ]);
    expect(Object.keys(result.schedule.data)).toEqual(["items", "nextOffset"]);
    expect(Object.keys(result.schedule.data.items[0])).toEqual([
      "id",
      "title",
      "startAt",
      "endAt",
    ]);
  });
});
