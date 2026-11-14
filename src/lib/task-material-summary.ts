import { and, eq, inArray, isNotNull, isNull, or } from "drizzle-orm";
import {
  deliverables,
  deliverableVersions,
  projectReferences,
  tasks,
} from "@/db/schema";
import { projectAttachments } from "@/db/course-extensions-schema";
import { taskMaterialLinks } from "@/db/task-enhancements-schema";
import {
  inferMaterialPurpose,
  type MaterialPurpose,
  type MaterialSummary,
} from "./material-purpose";
import { readProject } from "./project-read";

export async function listTaskMaterialSummaries(
  actorId: string,
  projectId: string,
  taskIds: string[],
) {
  return readProject(actorId, projectId, async (tx) => {
    const result: Record<string, MaterialSummary> = {};
    if (!taskIds.length) return result;
    const files = await tx
      .select({
        taskId: tasks.id,
        name: projectAttachments.filename,
        purpose: projectAttachments.materialPurpose,
      })
      .from(projectAttachments)
      .innerJoin(
        tasks,
        and(
          eq(tasks.id, projectAttachments.targetId),
          eq(tasks.projectId, projectId),
        ),
      )
      .where(
        and(
          eq(projectAttachments.projectId, projectId),
          eq(projectAttachments.targetType, "task"),
          inArray(tasks.id, taskIds),
          isNull(projectAttachments.deletedAt),
        ),
      );
    const links = await tx
      .select({
        taskId: tasks.id,
        purpose: taskMaterialLinks.materialPurpose,
        resourceTitle: projectReferences.title,
        resourceUrl: projectReferences.url,
        versionTitle: deliverableVersions.title,
      })
      .from(taskMaterialLinks)
      .innerJoin(
        tasks,
        and(
          eq(tasks.id, taskMaterialLinks.taskId),
          eq(tasks.projectId, projectId),
        ),
      )
      .leftJoin(
        projectReferences,
        and(
          eq(projectReferences.id, taskMaterialLinks.resourceId),
          eq(projectReferences.projectId, projectId),
        ),
      )
      .leftJoin(
        deliverableVersions,
        eq(deliverableVersions.id, taskMaterialLinks.deliverableVersionId),
      )
      .leftJoin(
        deliverables,
        and(
          eq(deliverables.id, deliverableVersions.deliverableId),
          eq(deliverables.projectId, projectId),
        ),
      )
      .where(
        and(
          inArray(tasks.id, taskIds),
          or(isNotNull(projectReferences.id), isNotNull(deliverables.id)),
        ),
      );
    function add(taskId: string, purpose: MaterialPurpose) {
      result[taskId] ??= {
        total: 0,
        counts: { presentation: 0, survey: 0, code: 0, other: 0 },
      };
      result[taskId].total++;
      result[taskId].counts[purpose]++;
    }
    files.forEach((file) =>
      add(file.taskId, file.purpose ?? inferMaterialPurpose(file.name)),
    );
    links.forEach((link) =>
      add(
        link.taskId,
        link.purpose ??
          inferMaterialPurpose(
            link.resourceTitle ?? link.versionTitle ?? "",
            link.resourceUrl ?? "",
          ),
      ),
    );
    return result;
  });
}
