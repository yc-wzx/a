import { randomUUID } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db";
import { projectReferences, projects, users } from "@/db/schema";
import { projectAttachments } from "@/db/course-extensions-schema";
import { createTeam, joinTeam, updateMemberRole } from "@/lib/team";
import { createProject } from "@/lib/project";
import { createTask } from "@/lib/task";
import { createProjectReference } from "@/lib/project-extras";
import {
  deleteAttachment,
  detectAttachmentType,
  listAttachments,
  updateAttachmentPurpose,
  uploadAttachment,
} from "@/lib/attachments";
import {
  getTaskEnhancements,
  linkTaskMaterial,
  updateTaskMaterialPurpose,
} from "@/lib/task-enhancements";
import { listTaskMaterialSummaries } from "@/lib/task-material-summary";
import { inferMaterialPurpose } from "@/lib/material-purpose";
import { resetDb } from "./helpers";

async function scene() {
  const [admin, student, peer, teacher, outsider] = await db
    .insert(users)
    .values(
      ["admin", "student", "peer", "teacher", "outsider"].map((name) => ({
        name,
        email: `${name}@materials.test`,
        passwordHash: "fixture",
      })),
    )
    .returning();
  const team = await createTeam(admin.id, "材料测试团队");
  for (const user of [student, peer, teacher])
    await joinTeam(user.id, team.inviteCode);
  await updateMemberRole(admin.id, team.id, teacher.id, "teacher");
  const project = await createProject(admin.id, team.id, { name: "课程项目" });
  const task = await createTask(student.id, project.id, {
    title: "提交项目材料",
  });
  const target = {
    projectId: project.id,
    targetType: "task",
    targetId: task.id,
  };
  return { admin, student, peer, teacher, outsider, project, task, target };
}

beforeAll(async () => {
  process.env.ATTACHMENT_STORAGE_DIR = await mkdtemp(
    path.join(os.tmpdir(), "agilecampus-materials-"),
  );
});
beforeEach(resetDb);

describe("task delivery materials", () => {
  it("infers purposes for existing filenames and links and validates ZIP format", () => {
    expect(inferMaterialPurpose("阶段展示.PPTX")).toBe("presentation");
    expect(
      inferMaterialPurpose(
        "开题材料",
        "https://example.com/demo.pptx?version=1",
      ),
    ).toBe("presentation");
    expect(inferMaterialPurpose("代码.zip")).toBe("code");
    expect(inferMaterialPurpose("问卷调查", "https://wj.qq.com/test")).toBe(
      "survey",
    );
    expect(
      inferMaterialPurpose("源代码", "https://github.com/team/project"),
    ).toBe("code");
    expect(inferMaterialPurpose("报告.pdf")).toBe("other");
    const emptyZip = Buffer.alloc(22);
    emptyZip.writeUInt32LE(0x06054b50);
    expect(detectAttachmentType("code.zip", emptyZip)).toBe("application/zip");
    expect(() =>
      detectAttachmentType("code.zip", Buffer.from("PK invalid")),
    ).toThrow();
    expect(() =>
      detectAttachmentType("code.zip", emptyZip.subarray(0, 21)),
    ).toThrow();
  });

  it("classifies old nullable attachments, permits correction and reset, and protects revisions and retries", async () => {
    const s = await scene();
    const file = await uploadAttachment(
      s.student.id,
      s.target,
      { name: "项目材料.pdf", bytes: Buffer.from("%PDF-1.4\n%%EOF") },
      randomUUID(),
    );
    expect(file.materialPurpose).toBe("other");
    const input = {
      requestId: randomUUID(),
      expectedRevision: 1,
      materialPurpose: "presentation",
    };
    const updated = await updateAttachmentPurpose(s.student.id, file.id, input);
    expect(updated).toMatchObject({
      revision: 2,
      materialPurpose: "presentation",
    });
    expect(await updateAttachmentPurpose(s.student.id, file.id, input)).toEqual(
      updated,
    );
    await expect(
      updateAttachmentPurpose(s.student.id, file.id, {
        ...input,
        materialPurpose: "code",
      }),
    ).rejects.toThrow("不同内容");
    await expect(
      updateAttachmentPurpose(s.student.id, file.id, {
        ...input,
        requestId: randomUUID(),
      }),
    ).rejects.toThrow("分类已更新");
    expect(
      await updateAttachmentPurpose(s.admin.id, file.id, {
        requestId: randomUUID(),
        expectedRevision: 2,
        materialPurpose: null,
      }),
    ).toMatchObject({ revision: 3, materialPurpose: "other" });
    const summaries = await listTaskMaterialSummaries(
      s.teacher.id,
      s.project.id,
      [s.task.id],
    );
    expect(summaries[s.task.id]).toMatchObject({
      total: 1,
      counts: { other: 1 },
    });
  });

  it("restricts file purpose changes to owner/admin and keeps published evidence immutable", async () => {
    const s = await scene();
    const file = await uploadAttachment(
      s.student.id,
      s.target,
      { name: "材料.md", bytes: Buffer.from("课程材料") },
      randomUUID(),
    );
    for (const actor of [s.peer, s.teacher, s.outsider])
      await expect(
        updateAttachmentPurpose(actor.id, file.id, {
          requestId: randomUUID(),
          expectedRevision: 1,
          materialPurpose: "code",
        }),
      ).rejects.toThrow();
    expect((await listAttachments(s.teacher.id, s.target))[0].canClassify).toBe(
      false,
    );
    await db
      .update(projectAttachments)
      .set({ publishedAt: new Date() })
      .where(eq(projectAttachments.id, file.id));
    await expect(
      updateAttachmentPurpose(s.admin.id, file.id, {
        requestId: randomUUID(),
        expectedRevision: 1,
        materialPurpose: "code",
      }),
    ).rejects.toThrow();
  });

  it("summarizes valid linked materials and files and removes deleted sources and files from the count", async () => {
    const s = await scene();
    const file = await uploadAttachment(
      s.student.id,
      s.target,
      { name: "报告.pdf", bytes: Buffer.from("%PDF-1.4\n%%EOF") },
      randomUUID(),
    );
    const source = await createProjectReference(s.student.id, s.project.id, {
      requestId: randomUUID(),
      type: "document",
      title: "用户问卷",
      url: "https://wj.qq.com/test",
    });
    const link = await linkTaskMaterial(s.student.id, s.project.id, s.task.id, {
      requestId: randomUUID(),
      kind: "resource",
      sourceId: source.id,
    });
    expect(
      (
        await listTaskMaterialSummaries(s.teacher.id, s.project.id, [s.task.id])
      )[s.task.id],
    ).toMatchObject({ total: 2, counts: { survey: 1, other: 1 } });
    const input = {
      requestId: randomUUID(),
      linkId: link.id,
      expectedRevision: 1,
      materialPurpose: "presentation",
    };
    await updateTaskMaterialPurpose(s.peer.id, s.project.id, s.task.id, input);
    await updateTaskMaterialPurpose(s.peer.id, s.project.id, s.task.id, input);
    expect(
      (await getTaskEnhancements(s.teacher.id, s.project.id, s.task.id))
        .materials[0],
    ).toMatchObject({ revision: 2, materialPurpose: "presentation" });
    await expect(
      updateTaskMaterialPurpose(s.teacher.id, s.project.id, s.task.id, {
        ...input,
        requestId: randomUUID(),
        expectedRevision: 2,
      }),
    ).rejects.toThrow();
    await db
      .delete(projectReferences)
      .where(eq(projectReferences.id, source.id));
    await deleteAttachment(s.student.id, file.id);
    expect(
      await listTaskMaterialSummaries(s.teacher.id, s.project.id, [s.task.id]),
    ).toEqual({});
    await expect(
      listTaskMaterialSummaries(s.outsider.id, s.project.id, [s.task.id]),
    ).rejects.toThrow();
  });

  it("serializes simultaneous classifications and blocks writes after archive", async () => {
    const s = await scene();
    const file = await uploadAttachment(
      s.student.id,
      s.target,
      { name: "材料.md", bytes: Buffer.from("课程材料") },
      randomUUID(),
    );
    const results = await Promise.allSettled(
      ["code", "presentation"].map((materialPurpose) =>
        updateAttachmentPurpose(s.student.id, file.id, {
          requestId: randomUUID(),
          expectedRevision: 1,
          materialPurpose,
        }),
      ),
    );
    expect(results.filter((item) => item.status === "fulfilled")).toHaveLength(
      1,
    );
    expect(results.filter((item) => item.status === "rejected")).toHaveLength(
      1,
    );
    await db
      .update(projects)
      .set({ status: "archived" })
      .where(eq(projects.id, s.project.id));
    await expect(
      updateAttachmentPurpose(s.student.id, file.id, {
        requestId: randomUUID(),
        expectedRevision: 2,
        materialPurpose: "code",
      }),
    ).rejects.toThrow();
    expect((await listAttachments(s.student.id, s.target))[0].canClassify).toBe(
      false,
    );
  });
});
