import { sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import type { WorkspaceSearchResult } from "@/contracts/workspace-search";

function excerpt(text: string, query: string) {
  const at = text.toLocaleLowerCase().indexOf(query.toLocaleLowerCase());
  const start = Math.max(0, at - 35);
  return (start ? "…" : "") + text.slice(start, start + 180) + (text.length > start + 180 ? "…" : "");
}
export async function searchWorkspace(actorId: string, input: unknown): Promise<WorkspaceSearchResult> {
  z.uuid().parse(actorId);
  const data = z.object({ q: z.string().trim().min(1).max(200), kind: z.enum(["all", "documents", "resources", "tasks", "projects"]).default("all"), projectId: z.uuid().optional(), offset: z.number().int().min(0).max(100000).default(0) }).parse(input);
  const project = data.projectId ? sql`and p.id=${data.projectId}` : sql``;
  const membership = sql`join team_members m on m.team_id=p.team_id and m.user_id=${actorId}`;
  // Apply membership and document ACL before both pagination and count. Literal
  // substring matching also treats %/_ as text rather than SQL wildcards.
  const hits = sql`
    select d.id,d.title as label,d.search_text as body,p.id as project_id,p.name as project_name,'文档' as category,('/projects/'||p.id||'/documents/'||d.id) as href
    from project_documents d join projects p on p.id=d.project_id ${membership}
    left join document_grants g on g.document_id=d.id and g.user_id=${actorId}
    where ${data.kind} in ('all','documents') ${project} and d.deleted_at is null and (d.visibility='project' or d.owner_id=${actorId} or g.user_id is not null)
      and (strpos(lower(d.title),lower(${data.q}))>0 or strpos(lower(d.search_text),lower(${data.q}))>0)
    union all
    select r.id,r.title,r.note,p.id,p.name,'会议与资料',('/projects/'||p.id||'/references?referenceId='||r.id||'#reference-'||r.id)
    from project_references r join projects p on p.id=r.project_id ${membership}
    where ${data.kind} in ('all','resources') ${project} and (strpos(lower(r.title),lower(${data.q}))>0 or strpos(lower(r.note),lower(${data.q}))>0)
    union all
    select t.id,t.title,coalesce(t.description,''),p.id,p.name,'任务',('/projects/'||p.id||'?task='||t.id)
    from tasks t join projects p on p.id=t.project_id ${membership}
    where ${data.kind} in ('all','tasks') ${project} and (strpos(lower(t.title),lower(${data.q}))>0 or strpos(lower(coalesce(t.description,'')),lower(${data.q}))>0)
    union all
    select p.id,p.name,coalesce(p.description,''),p.id,p.name,'项目',('/projects/'||p.id||'/overview')
    from projects p ${membership}
    where ${data.kind} in ('all','projects') ${project} and (strpos(lower(p.name),lower(${data.q}))>0 or strpos(lower(coalesce(p.description,'')),lower(${data.q}))>0)`;
  return db.transaction(async tx => {
    const choices = await tx.execute<{ id: string; name: string }>(sql`select p.id,p.name from projects p ${membership} order by p.name,p.id`);
    const totals = await tx.execute<{ total: number }>(sql`select count(*)::int as total from (${hits}) result`);
    const rows = await tx.execute<{ id: string; label: string; body: string; project_id: string; project_name: string; category: string; href: string }>(sql`select * from (${hits}) result order by (case when strpos(lower(label),lower(${data.q}))>0 then 0 else 1 end),label,category,id limit 20 offset ${data.offset}`);
    const total = totals[0].total;
    return { items: rows.map(r => ({ id: r.category + ":" + r.id, label: r.label, excerpt: excerpt(r.body, data.q), href: r.href, group: r.category, projectId: r.project_id, projectName: r.project_name })), total, nextOffset: data.offset + rows.length < total ? data.offset + rows.length : null, projects: [...choices] };
  }, { isolationLevel: "repeatable read" });
}
