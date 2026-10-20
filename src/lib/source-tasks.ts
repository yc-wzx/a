import { and, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { discussionTaskOrigins } from "@/db/course-extensions-schema";
import { retrospectives, taskComments, taskDiscussionMessages, tasks } from "@/db/schema";
import { createTask } from "./task";
import { getProjectForUser } from "./project";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "./errors";
import { lockTaskWriteAccess } from "./task-write-access";
import { runIdempotent } from "./write-request";
import { notifyTaskAssigned } from "./notify";
const sourceSchema = z.object({sourceType:z.enum(["comment","discussion","retrospective"]),sourceId:z.uuid(),sourceTaskId:z.uuid().optional()});
export async function createTaskFromSource(actorId:string,projectId:string,input:unknown) {
  const data = sourceSchema.extend({requestId:z.uuid(),title:z.string().trim().min(1).max(200),description:z.string().trim().max(10000),assigneeId:z.uuid().optional(),dueDate:z.iso.date().optional(),expectedSourceRevision:z.string().max(100),confirmShare:z.boolean().default(false)}).strict().parse(input);
  const result = await db.transaction(async tx => {
    await lockTaskWriteAccess(tx,actorId,projectId);
    let revision:string, sourceTaskId:string|null=null;
    if(data.sourceType==="retrospective") {
      const [row]=await tx.select().from(retrospectives).where(and(eq(retrospectives.id,data.sourceId),eq(retrospectives.projectId,projectId))).for("share");
      if(!row)throw new NotFoundError("复盘已删除或不可访问");revision=String(row.revision);
    } else {
      const table=data.sourceType==="comment"?taskComments:taskDiscussionMessages;
      const [row]=await tx.select({taskId:table.taskId,revision:data.sourceType==="comment"?sql<string>`${taskComments.revision}::text`:sql<string>`${taskDiscussionMessages.createdAt}::text`,createdAt:table.createdAt}).from(table).innerJoin(tasks,eq(table.taskId,tasks.id)).where(and(eq(table.id,data.sourceId),eq(tasks.projectId,projectId),data.sourceType==="comment"?isNull(taskComments.deletedAt):undefined)).for("share");
      if(!row)throw new ForbiddenError("来源消息不可访问");
      const message=row;
      sourceTaskId=message.taskId;
      if(data.sourceType==="discussion") {
        const [allowed]=await tx.execute(sql`select t.id from tasks t where t.id=${sourceTaskId} and (t.created_by_id=${actorId} or t.assignee_id=${actorId} or exists(select 1 from task_assignees a where a.task_id=t.id and a.user_id=${actorId}) or exists(select 1 from task_discussion_invites i where i.task_id=t.id and i.user_id=${actorId}))`);
        if(!allowed)throw new ForbiddenError("仅当前讨论成员可以转为任务");
        if(!data.confirmShare)throw new ValidationError("任务对全队可见，请明确确认公开本次整理的内容");
      }
      revision=data.sourceType==="comment"?String(message.revision):message.createdAt.toISOString();
    }
    return runIdempotent(tx,{actorId,projectId,operation:"source-task.create",requestId:data.requestId},data,async()=>{
      if(revision!==data.expectedSourceRevision)throw new ConflictError("来源内容已变化，请重新核对后创建");
      const task=await createTask(actorId,projectId,{title:data.title,description:data.description,assigneeId:data.assigneeId,dueDate:data.dueDate},{tx});
      await tx.insert(discussionTaskOrigins).values({taskId:task.id,projectId,sourceType:data.sourceType,sourceId:data.sourceId,sourceTaskId,sourceRevision:revision,createdById:actorId});
      return {id:task.id,assigneeId:task.assigneeId,title:task.title};
    });
  });
  if(result.assigneeId)void notifyTaskAssigned({...result,projectId});
  return {id:result.id,href:`/projects/${projectId}?task=${result.id}`};
}
export async function getTaskOrigin(actorId:string,projectId:string,taskId:string) {
  if(!await getProjectForUser(actorId,projectId))throw new ForbiddenError();
  const [origin]=await db.select().from(discussionTaskOrigins).where(and(eq(discussionTaskOrigins.taskId,taskId),eq(discussionTaskOrigins.projectId,projectId)));
  if(!origin)return null;
  if(origin.sourceType==="retrospective") {
    const [r]=await db.select().from(retrospectives).where(and(eq(retrospectives.id,origin.sourceId),eq(retrospectives.projectId,projectId)));
    return r?{label:"来源：迭代复盘",href:`/projects/${projectId}/iterations/${r.iterationId}`}:{label:"来源复盘已不可访问",href:null};
  }
  if(origin.sourceType==="discussion") {
    const [allowed]=await db.execute(sql`select m.id from task_discussion_messages m join tasks t on t.id=m.task_id join projects p on p.id=t.project_id join team_members tm on tm.team_id=p.team_id and tm.user_id=${actorId} where m.id=${origin.sourceId} and t.project_id=${projectId} and (t.created_by_id=${actorId} or t.assignee_id=${actorId} or exists(select 1 from task_assignees a where a.task_id=t.id and a.user_id=${actorId}) or exists(select 1 from task_discussion_invites i where i.task_id=t.id and i.user_id=${actorId}))`);
    return allowed?{label:"来源：任务讨论",href:`/projects/${projectId}?task=${origin.sourceTaskId}&discussion=${origin.sourceId}`}:{label:"来源为成员讨论，仅授权成员可查看",href:null};
  }
  const [comment]=await db.select().from(taskComments).where(and(eq(taskComments.id,origin.sourceId),eq(taskComments.projectId,projectId),isNull(taskComments.deletedAt)));
  return comment?{label:"来源：团队评论",href:`/projects/${projectId}?task=${comment.taskId}&comment=${comment.id}`}:{label:"来源评论已删除",href:null};
}
