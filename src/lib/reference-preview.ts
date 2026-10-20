import { and,eq } from "drizzle-orm";
import { db } from "@/db";
import { projectReferences } from "@/db/schema";
import { getProjectForUser } from "./project";
import { ForbiddenError,ValidationError } from "./errors";
import { safeFetch } from "./safe-fetch";
function decode(text:string){return text.replace(/&(?:quot|amp|apos|lt|gt);/g,m=>({"&quot;":"\"","&amp;":"&","&apos;":"'","&lt;":"<","&gt;":">"})[m]!).replace(/&#(\d+);/g,(_,n)=>String.fromCodePoint(Math.min(Number(n),0x10ffff)));}
export function parseLinkMetadata(html:string){
  const values=new Map<string,string>();
  for(const tag of html.match(/<meta\b[^>]{0,8192}>/gi)??[]){const attrs=new Map<string,string>();for(const m of tag.matchAll(/([a-z:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi))attrs.set(m[1].toLowerCase(),decode(m[2]??m[3]));const key=attrs.get("property")??attrs.get("name"),value=attrs.get("content");if(key&&value&&!values.has(key))values.set(key,value);}
  return {title:(values.get("og:title")??decode(/<title[^>]*>([^<]{0,500})<\/title>/i.exec(html)?.[1]??"")).slice(0,200),description:(values.get("og:description")??values.get("description")??"").slice(0,500)};
}
export async function previewReference(actorId:string,projectId:string,referenceId:string,pdf=false){
  if(!await getProjectForUser(actorId,projectId))throw new ForbiddenError();
  const [record]=await db.select().from(projectReferences).where(and(eq(projectReferences.id,referenceId),eq(projectReferences.projectId,projectId)));
  if(!record)throw new ForbiddenError();
  const result=await safeFetch(record.url,{maxBytes:20*1048576,headers:{Accept:pdf?"application/pdf":"text/html,application/pdf;q=0.8"}});
  if(!await getProjectForUser(actorId,projectId))throw new ForbiddenError();
  if(result.status!==200)throw new ValidationError("原网站未提供公开预览，请打开原链接查看");
  const isPdf=result.headers["content-type"]?.includes("application/pdf")||result.body.subarray(0,5).toString()==="%PDF-";
  if(pdf){if(!isPdf||result.body.subarray(0,5).toString()!=="%PDF-")throw new ValidationError("该资料不是可公开读取的PDF");return {pdf:result.body,title:record.title,description:"",host:new URL(record.url).host,isPdf:true};}
  const meta=isPdf?{title:record.title,description:"PDF 文档，可在站内预览或打开原链接"}:parseLinkMetadata(result.body.toString("utf8"));
  return {...meta,title:meta.title||record.title,host:new URL(record.url).host,isPdf,pdf:null};
}
