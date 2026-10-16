import { z } from "zod";
import { sql } from "drizzle-orm";
import { createDeliverableDraft, submitDeliverable } from "@/lib/deliverable";
import { getTaskDetail, requireTaskWrite } from "@/lib/task";
import { linkTaskMaterial } from "@/lib/task-enhancements";
import { readProject } from "@/lib/project-read";
import { ForbiddenError } from "@/lib/errors";
export async function submitTaskOutcome(actor: string, projectId: string, taskId: string, input: unknown) {
    const d = z.object({ requestId: z.uuid(), note: z.string().trim().max(10000), url: z.string().trim().max(2048) }).refine(v => !!v.note || !!v.url, "请填写完成说明或成果链接").parse(input);
    await requireTaskWrite(actor, projectId);
    const task = await getTaskDetail(actor, taskId);
    if (task.projectId !== projectId) throw new ForbiddenError();
    await readProject(actor, projectId, async tx => { const r = await tx.execute<{status:string}>(sql`select status from projects where id=${projectId}`); if (r[0]?.status !== "active") throw new ForbiddenError("归档项目只可查看"); });
    // A note-only outcome links to its permanent task page; it still enters formal review.
    const url = d.url || new URL(`/projects/${projectId}?task=${taskId}`, process.env.AGILECAMPUS_URL ?? process.env.AUTH_URL ?? "http://localhost:3000").href;
    const draft = await createDeliverableDraft(actor, projectId, { requestId: d.requestId, title: task.title, type: "other", url, description: d.note, milestoneId: task.milestoneId });
    const submitted = await submitDeliverable(actor, projectId, draft.id, { requestId: d.requestId, expectedRevision: 1 });
    await linkTaskMaterial(actor, projectId, taskId, { requestId: d.requestId, kind: "deliverable", sourceId: submitted.versionId });
    return { deliverableId: draft.id, versionId: submitted.versionId };
}
