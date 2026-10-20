import Papa from "papaparse";
import { listProjectDeliverables } from "./deliverable";
import { exportDeliverableEvidenceRows,type DeliverableEvidenceOptions } from "./deliverable-reporting";
import { exportProjectEvidenceRows } from "./evidence";
import type { EvidenceFilters } from "@/contracts/p0-p2";
import { getProjectForUser } from "./project";
import { listTeamMembers } from "./team";
import { ForbiddenError } from "./errors";
/** Protect Excel/WPS formula interpretation in every untrusted textual cell. */
export function csvText(value:unknown):string { const text=value==null?"":String(value);return /^[\s\uFEFF]*[=+\-@]/.test(text)||/^[\t\r]/.test(text)?"'"+text:text; }
export function buildCsv(rows:Record<string,unknown>[],fields:string[]) {return "\uFEFF"+Papa.unparse({fields,data:rows.map(row=>fields.map(key=>typeof row[key]==="number"?row[key]:csvText(row[key])))},{quotes:true,newline:"\r\n"});}
export async function exportCourseCsv(actorId:string,projectId:string,kind:"deliverables"|"formal"|"process",filters:Record<string,unknown>={}) {
  const access=await getProjectForUser(actorId,projectId);if(!access)throw new ForbiddenError();
  const members=await listTeamMembers(access.project.teamId),name=(id:string|null|undefined)=>members.find(m=>m.id===id)?.name??(id?"已离队成员":""),origin=process.env.AGILECAMPUS_URL||process.env.AUTH_URL||"http://localhost:3000";
  let rows:Record<string,unknown>[],total:number;
  if(kind==="deliverables"){
    const items=(await listProjectDeliverables(actorId,projectId)).filter(x=>x.status!=="draft");total=items.length;
    rows=items.slice(0,1000).map(x=>({"标题":x.title,"类型":x.type,"状态":({submitted:"待验收",approved:"通过",changes_requested:"需修改"})[x.status as "submitted"|"approved"|"changes_requested"],"提交者":name(x.authorId),"说明":x.description,"成果链接":x.url,"来源":new URL(`/projects/${projectId}/deliverables/${x.id}`,origin).href}));
  }else if(kind==="formal"){
    const page=await exportDeliverableEvidenceRows(actorId,projectId,filters as DeliverableEvidenceOptions),items=page.items;total=page.total;
    rows=items.slice(0,1000).map(x=>({"标题":x.title,"类别":({submission:"正式提交",review:"版本审核",milestone_feedback:"阶段反馈"})[x.kind],"版本":x.versionNumber,"作者":name(x.authorId),"操作者":name(x.actorId),"时间":new Date(x.occurredAt).toLocaleString("zh-CN",{timeZone:"Asia/Shanghai"}),"阶段":x.milestoneTitle,"说明":x.description||x.comment,"成果链接":x.url,"来源":new URL(x.sourceHref,origin).href}));
  }else{
    const page=await exportProjectEvidenceRows(actorId,projectId,filters as EvidenceFilters);total=page.total;
    rows=page.items.map(x=>({"标题":x.title,"类别":({task_activity:"任务活动",iteration_history:"迭代历史",comment:"团队评论",deliverable_submission:"成果提交",deliverable_review:"成果审核",milestone_feedback:"阶段反馈",retrospective:"迭代复盘"})[x.kind],"说明":x.summary===x.title?"":x.summary,"参与身份":x.identities.map(i=>`${name(i.userId)}（${({actor:"操作者",assignee:"执行者",submitter:"提交者",reviewer:"审核者",author:"作者"})[i.role]??i.role}）`).join("；"),"时间":new Date(x.occurredAt).toLocaleString("zh-CN",{timeZone:"Asia/Shanghai"}),"来源":x.sourceRef.sourceHref?new URL(x.sourceRef.sourceHref,origin).href:"已不可访问"}));
  }
  if(!await getProjectForUser(actorId,projectId))throw new ForbiddenError();
  const exported=rows.length,truncated=total>exported,fields=[...new Set(rows.flatMap(Object.keys)),"符合条件总数","导出条数","是否截断"];
  if(!rows.length)rows=[{"符合条件总数":total,"导出条数":0,"是否截断":"否"}];else rows=rows.map(x=>({...x,"符合条件总数":total,"导出条数":exported,"是否截断":truncated?"是（上限1000条）":"否"}));
  return {csv:buildCsv(rows,fields),total,exported,truncated,filename:`${kind}-${projectId}.csv`};
}
