import { and,asc,eq,isNull,sql } from "drizzle-orm";
import { db,type DbTx } from "@/db";
import { iterationTrendSamples } from "@/db/course-extensions-schema";
import { iterations,tasks } from "@/db/schema";
import { getProjectForUser } from "./project";
import { ForbiddenError } from "./errors";
const dayOf=(date:Date)=>new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Shanghai",year:"numeric",month:"2-digit",day:"2-digit"}).format(date);
export async function captureIterationTrend(tx:DbTx,iterationId:string|null){
  if(!iterationId)return;
  // Serialize same-iteration samples without inverting the iteration/task row locks.
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${"trend:"+iterationId},0))`);
  const [iteration]=await tx.select().from(iterations).where(eq(iterations.id,iterationId));if(!iteration||iteration.status!=="active")return;
  const states=await tx.select({id:tasks.id,status:tasks.status}).from(tasks).where(and(eq(tasks.sprintId,iterationId),isNull(tasks.parentTaskId))).orderBy(tasks.id);
  const now=new Date(),value={projectId:iteration.projectId,iterationId,day:dayOf(now),total:states.length,done:states.filter(t=>t.status==="done").length,taskStates:states,sampledAt:now};
  await tx.insert(iterationTrendSamples).values(value).onConflictDoUpdate({target:[iterationTrendSamples.iterationId,iterationTrendSamples.day],set:value});
}
export async function captureActiveIterationTrends(){return db.transaction(async tx=>{const rows=await tx.select({id:iterations.id}).from(iterations).where(eq(iterations.status,"active"));for(const row of rows)await captureIterationTrend(tx,row.id);return rows.length;});}
export async function getIterationTrend(actorId:string,projectId:string,iterationId:string){
  if(!await getProjectForUser(actorId,projectId))throw new ForbiddenError();
  const [iteration]=await db.select().from(iterations).where(and(eq(iterations.id,iterationId),eq(iterations.projectId,projectId)));if(!iteration)throw new ForbiddenError();
  if(iteration.status==="active")await db.transaction(tx=>captureIterationTrend(tx,iterationId));
  const samples=await db.select().from(iterationTrendSamples).where(and(eq(iterationTrendSamples.projectId,projectId),eq(iterationTrendSamples.iterationId,iterationId))).orderBy(asc(iterationTrendSamples.day));
  return {startDate:iteration.startDate,endDate:iteration.endDate,availableFrom:samples[0]?.day??null,status:iteration.status,points:samples.map((s,i)=>{const prior=new Set((samples[i-1]?.taskStates??s.taskStates).map(x=>x.id)),current=new Set(s.taskStates.map(x=>x.id));return {day:s.day,total:s.total,done:s.done,remaining:s.total-s.done,added:[...current].filter(x=>!prior.has(x)).length,removed:[...prior].filter(x=>!current.has(x)).length};}),note:"按主任务数量统计，不使用故事点。每日保留最后一次真实记录；未采集日期不补造历史，范围增减单独显示。"};
}
