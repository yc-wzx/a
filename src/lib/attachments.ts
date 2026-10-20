import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, unlink, writeFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { and, desc, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db, type DbTx } from "@/db";
import { projectAttachments as attachments } from "@/db/course-extensions-schema";
import { projects, teamMembers, tasks, deliverables } from "@/db/schema";
import { projectDocuments, documentGrants } from "@/db/documents-schema";
import { AppError, ConflictError, ForbiddenError, ValidationError } from "./errors";

export const attachmentTargetSchema = z.object({ projectId: z.uuid(), targetType: z.enum(["project","task","document","deliverable"]), targetId: z.uuid() });
export type AttachmentTarget = z.infer<typeof attachmentTargetSchema>;
export const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;
const root = () => path.resolve(/* turbopackIgnore: true */ process.env.ATTACHMENT_STORAGE_DIR ?? path.join(process.cwd(), ".data", "attachments"));
function filePath(key: string) { if (!/^[a-f0-9-]{36}$/.test(key)) throw new ValidationError("文件标识无效"); return path.join(/* turbopackIgnore: true */ root(), key); }
export function safeAttachmentName(name: string) { return name.replace(/[\x00-\x1f\x7f/\\]/g,"_").slice(0,180).trim() || "附件"; }
export function detectAttachmentType(name: string, body: Buffer): string {
  const ext = path.extname(name).toLowerCase();
  if (ext === ".png" && body.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return "image/png";
  if ([".jpg",".jpeg"].includes(ext) && body[0] === 255 && body[1] === 216 && body[2] === 255) return "image/jpeg";
  if (ext === ".gif" && /^GIF8[79]a$/.test(body.subarray(0,6).toString("ascii"))) return "image/gif";
  if (ext === ".webp" && body.subarray(0,4).toString() === "RIFF" && body.subarray(8,12).toString() === "WEBP") return "image/webp";
  if (ext === ".pdf" && body.subarray(0,5).toString() === "%PDF-") return "application/pdf";
  const office: Record<string,[string,string]> = { ".pptx": ["ppt/", "application/vnd.openxmlformats-officedocument.presentationml.presentation"], ".docx": ["word/", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"], ".xlsx": ["xl/", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"] };
  if (office[ext] && body.length >= 22 && body.readUInt32LE(0) === 0x04034b50) {
    // Inspect bounded ZIP central directory filenames; never extract or execute an archive.
    const names: string[] = []; let offset = Math.max(0,body.length - 65557), end = -1;
    for (let n = body.length - 22; n >= offset; n--) if (body.readUInt32LE(n) === 0x06054b50) { end = n; break; }
    if (end >= 0) {
      offset = body.readUInt32LE(end + 16); const entries = body.readUInt16LE(end + 10);
      if (entries > 10000) throw new ValidationError("Office 文件内容过多");
      for (let n = 0; n < entries && offset + 46 <= body.length; n++) {
        if (body.readUInt32LE(offset) !== 0x02014b50) break;
        const length = body.readUInt16LE(offset + 28), extra = body.readUInt16LE(offset + 30), comment = body.readUInt16LE(offset + 32);
        if (offset + 46 + length > body.length) break;
        names.push(body.subarray(offset + 46,offset + 46 + length).toString()); offset += 46 + length + extra + comment;
      }
      if (names.includes("[Content_Types].xml") && names.some(n => n.startsWith(office[ext][0])) && !names.some(n => /vbaProject\.bin$/i.test(n))) return office[ext][1];
    }
  }
  if ([".ppt",".doc",".xls"].includes(ext) && body.subarray(0,8).equals(Buffer.from([208,207,17,224,161,177,26,225]))) return ({ ".ppt":"application/vnd.ms-powerpoint", ".doc":"application/msword", ".xls":"application/vnd.ms-excel" })[ext]!;
  if ([".txt",".md",".csv"].includes(ext) && !body.includes(0)) {
    try { new TextDecoder("utf-8", { fatal: true }).decode(body); return "text/plain; charset=utf-8"; } catch { /* reject mislabeled binary */ }
  }
  throw new ValidationError("请选择有效的图片、PDF、PPT、Word、Excel 或 UTF-8 文本文件，不支持可执行文件和宏文档");
}
async function targetAccess(tx: DbTx, actorId: string, target: AttachmentTarget, write = false) {
  const [p] = await tx.select({ status: projects.status, role: teamMembers.role }).from(projects).innerJoin(teamMembers,eq(teamMembers.teamId,projects.teamId)).where(and(eq(projects.id,target.projectId),eq(teamMembers.userId,actorId))).for("share");
  if (!p || write && p.status === "archived") throw new ForbiddenError();
  if (target.targetType === "document") {
    const [d] = await tx.select({ row: projectDocuments, permission: documentGrants.permission }).from(projectDocuments).leftJoin(documentGrants,and(eq(documentGrants.documentId,projectDocuments.id),eq(documentGrants.userId,actorId))).where(and(eq(projectDocuments.id,target.targetId),eq(projectDocuments.projectId,target.projectId))).for("share",{of:[projectDocuments]});
    if (!d || d.row.deletedAt) throw new ForbiddenError();
    const permission = d.row.ownerId === actorId ? "edit" : d.permission ?? (d.row.visibility === "project" ? p.role === "teacher" && d.row.defaultPermission === "edit" ? "comment" : d.row.defaultPermission : null);
    if (!permission || write && permission !== "edit") throw new ForbiddenError();
  } else if (target.targetType === "task") {
    const [t] = await tx.select({ id: tasks.id }).from(tasks).where(and(eq(tasks.id,target.targetId),eq(tasks.projectId,target.projectId))).for("share");
    if (!t || write && !["student","admin"].includes(p.role)) throw new ForbiddenError();
  } else if (target.targetType === "deliverable") {
    const [d] = await tx.select().from(deliverables).where(and(eq(deliverables.id,target.targetId),eq(deliverables.projectId,target.projectId))).for("share");
    if (!d || d.status === "draft" && d.authorId !== actorId && p.role !== "admin") throw new ForbiddenError();
    if (write && !(p.role === "admin" || p.role === "student" && d.authorId === actorId) || write && d && d.status !== "draft" && !d.workingCopy) throw new ForbiddenError("请先开始成果修改，再添加附件");
  } else if (target.targetId !== target.projectId || write && !["student","admin","teacher"].includes(p.role)) throw new ForbiddenError();
  return p;
}
function dto(row: typeof attachments.$inferSelect, actorId: string, role: string, archived: boolean) {
  const { storageKey, digest, requestId, ...rest } = row; void storageKey; void digest; void requestId;
  return { ...rest, createdAt: row.createdAt.toISOString(), publishedAt: row.publishedAt?.toISOString() ?? null, href: `/api/attachments/${row.id}`, canDelete: !archived && !row.publishedAt && (row.ownerId === actorId || role === "admin") };
}
export async function listAttachments(actorId: string, input: unknown) {
  const target = attachmentTargetSchema.parse(input);
  return db.transaction(async tx => {
    const access = await targetAccess(tx,actorId,target);
    const direct = and(eq(attachments.targetType,target.targetType),eq(attachments.targetId,target.targetId));
    const linked = target.targetType === "deliverable" ? sql`${attachments.publishedAt} is not null and exists(select 1 from deliverable_versions v where v.deliverable_id=${target.targetId} and strpos(v.url || E'\n' || coalesce(v.description,''), '/api/attachments/' || ${attachments.id}::text)>0)` : undefined;
    const rows = await tx.select().from(attachments).where(and(eq(attachments.projectId,target.projectId),or(direct,linked),isNull(attachments.deletedAt))).orderBy(desc(attachments.createdAt));
    return rows.filter(r => r.targetType !== "deliverable" || r.publishedAt || r.ownerId === actorId || access.role === "admin").map(r => dto(r,actorId,access.role,access.status === "archived"));
  });
}
export async function uploadAttachment(actorId: string, input: unknown, file: { name: string; bytes: Buffer }, requestId: string) {
  const target = attachmentTargetSchema.parse(input); z.uuid().parse(requestId);
  if (!file.bytes.length || file.bytes.length > MAX_ATTACHMENT_BYTES) throw new ValidationError("单个附件须为 1 字节至 20 MB");
  const name = safeAttachmentName(file.name), mediaType = detectAttachmentType(name,file.bytes), digest = createHash("sha256").update(file.bytes).digest("hex"), key = randomUUID();
  await mkdir(root(),{ recursive: true, mode: 0o700 });
  await writeFile(filePath(key),file.bytes,{ flag: "wx", mode: 0o600 });
  let retained = false;
  try {
    return await db.transaction(async tx => {
      const access = await targetAccess(tx,actorId,target,true);
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended('attachment-quota',0))`);
      const [existing] = await tx.select().from(attachments).where(and(eq(attachments.ownerId,actorId),eq(attachments.requestId,requestId)));
      if (existing) {
        if (existing.deletedAt) throw new ConflictError("原附件已删除，请重新选择文件上传");
        if (existing.digest !== digest || existing.filename !== name || existing.projectId !== target.projectId || existing.targetId !== target.targetId || existing.targetType !== target.targetType) throw new ConflictError("同一上传请求不能用于不同文件");
        return dto(existing,actorId,access.role,false);
      }
      const [usage] = await tx.execute<{project: number;owner: number;site:number}>(sql`select coalesce(sum(size) filter(where project_id=${target.projectId}),0)::float as project,coalesce(sum(size) filter(where owner_id=${actorId}),0)::float as owner,coalesce(sum(size),0)::float as site from project_attachments`);
      if (usage.project + file.bytes.length > 250 * 1048576 || usage.owner + file.bytes.length > 500 * 1048576 || usage.site + file.bytes.length > Number(process.env.ATTACHMENT_SITE_LIMIT_BYTES ?? 2 * 1024 * 1048576)) throw new ValidationError("附件存储额度不足，请清理不需要的附件或联系负责人");
      const [row] = await tx.insert(attachments).values({ ...target, ownerId:actorId, filename:name, mediaType, size:file.bytes.length, digest, storageKey:key, requestId }).returning();
      retained = true; return dto(row,actorId,access.role,false);
    });
  } catch(error) { retained = false; throw error; }
  finally { if (!retained) await unlink(filePath(key)).catch(() => {}); }
}
export async function readAttachment(actorId: string, attachmentId: string) {
  z.uuid().parse(attachmentId);
  return db.transaction(async tx => {
    const [row] = await tx.select().from(attachments).where(eq(attachments.id,attachmentId));
    if (!row || row.deletedAt) throw new ForbiddenError("附件不存在或无权查看");
    const access = await targetAccess(tx,actorId,row.publishedAt && row.targetType === "task" ? {...row,targetType:"project",targetId:row.projectId} : row);
    if (row.targetType === "deliverable" && !row.publishedAt && row.ownerId !== actorId && access.role !== "admin") throw new ForbiddenError();
    const bytes = await readFile(filePath(row.storageKey)).catch(() => { throw new AppError("附件暂不可读取，请联系负责人恢复文件备份"); });
    return { row, bytes };
  });
}
export async function deleteAttachment(actorId: string, attachmentId: string) {
  z.uuid().parse(attachmentId);
  const key = await db.transaction(async tx => {
    const [row] = await tx.select().from(attachments).where(eq(attachments.id,attachmentId)).for("update");
    if (!row) throw new ForbiddenError();
    const access = await targetAccess(tx,actorId,row,true);
    if (row.publishedAt) throw new ValidationError("正式提交版本引用的附件须保留，请提交新版本替换");
    if (row.ownerId !== actorId && access.role !== "admin") throw new ForbiddenError();
    await tx.update(attachments).set({deletedAt:new Date()}).where(eq(attachments.id,attachmentId)); return row.storageKey;
  });
  void key; // Delay physical cleanup for one hour so a paired database/file backup remains restorable.
}
/** After cascade deletion, remove orphaned files. Recent in-flight uploads get a one-hour grace. */
export async function cleanupAttachmentFiles() {
  await db.execute(sql`update project_attachments a set deleted_at=now() where a.deleted_at is null and (
    (a.target_type='task' and a.published_at is null and not exists(select 1 from tasks t where t.id=a.target_id and t.project_id=a.project_id)) or
    (a.target_type='document' and not exists(select 1 from project_documents d where d.id=a.target_id and d.project_id=a.project_id)) or
    (a.target_type='deliverable' and not exists(select 1 from deliverables d where d.id=a.target_id and d.project_id=a.project_id)))`);
  const expired = await db.select().from(attachments).where(lt(attachments.deletedAt,new Date(Date.now()-3600000)));
  for(const row of expired){await unlink(filePath(row.storageKey)).catch(error=>{if(error.code!=="ENOENT")throw error;});await db.delete(attachments).where(and(eq(attachments.id,row.id),lt(attachments.deletedAt,new Date(Date.now()-3600000))));}
  const keys = new Set((await db.select({ key: attachments.storageKey }).from(attachments)).map(x => x.key));
  const names = await readdir(root()).catch(() => []); let removed = 0;
  for (const name of names) {
    if (!/^[a-f0-9-]{36}$/.test(name) || keys.has(name)) continue;
    const marker=filePath(name)+".orphan";
    const seen=await stat(marker).catch(()=>null);
    if(!seen){await writeFile(marker,"orphan detected",{flag:"wx",mode:0o600}).catch(()=>{});continue;}
    if (Date.now() - seen.mtimeMs > 3600000) { await unlink(filePath(name)).catch(() => {}); await unlink(marker).catch(()=>{}); removed++; }
  }
  return removed;
}
export async function publishDeliverableAttachments(tx: DbTx, projectId: string, deliverableId: string, url: string, description: string) {
  const ids = [...(url + "\n" + description).matchAll(/\/api\/attachments\/([a-f0-9-]{36})/gi)].map(x => x[1]);
  if (ids.length) await tx.update(attachments).set({ publishedAt: new Date() }).where(and(eq(attachments.projectId,projectId),or(and(eq(attachments.targetType,"deliverable"),eq(attachments.targetId,deliverableId)),inArray(attachments.targetType,["task","project"])),inArray(attachments.id,ids),isNull(attachments.deletedAt)));
}
