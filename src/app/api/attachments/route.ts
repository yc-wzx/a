import { auth } from "@/lib/auth";
import { AppError, ForbiddenError } from "@/lib/errors";
import { listAttachments, MAX_ATTACHMENT_BYTES, uploadAttachment } from "@/lib/attachments";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const session = await auth(); if (!session?.user) return Response.json({ error:"请先登录" },{status:401});
  try { return Response.json(await listAttachments(session.user.id,Object.fromEntries(new URL(request.url).searchParams)),{headers:{"Cache-Control":"private, no-store"}}); }
  catch(error) { return Response.json({error:error instanceof AppError ? error.message : "附件加载失败"},{status:error instanceof ForbiddenError ? 403 : 400}); }
}
export async function POST(request: Request) {
  const session = await auth(); if (!session?.user) return Response.json({error:"请先登录"},{status:401});
  try {
    const origin = request.headers.get("origin"), allowed = [new URL(request.url).origin,process.env.AUTH_URL && new URL(process.env.AUTH_URL).origin,process.env.AGILECAMPUS_URL && new URL(process.env.AGILECAMPUS_URL).origin];
    if (!origin || !allowed.includes(origin)) throw new ForbiddenError();
    const limit = MAX_ATTACHMENT_BYTES + 65536;
    if (Number(request.headers.get("content-length")) > limit) return Response.json({error:"单个附件不能超过20 MB"},{status:413});
    const reader = request.body?.getReader(); if (!reader) throw new AppError("请选择文件");
    const chunks: Uint8Array[] = []; let size = 0;
    while (true) { const part = await reader.read(); if (part.done) break; size += part.value.byteLength; if (size > limit) { await reader.cancel(); return Response.json({error:"单个附件不能超过20 MB"},{status:413}); } chunks.push(part.value); }
    const body = Buffer.concat(chunks), form = await new Response(new Uint8Array(body),{headers:{"Content-Type":request.headers.get("content-type") ?? ""}}).formData();
    const file = form.get("file"); if (!(file instanceof File)) throw new AppError("请选择文件");
    return Response.json(await uploadAttachment(session.user.id,{ projectId:form.get("projectId"),targetType:form.get("targetType"),targetId:form.get("targetId") },{name:file.name,bytes:Buffer.from(await file.arrayBuffer())},String(form.get("requestId"))),{headers:{"Cache-Control":"no-store"}});
  } catch(error) { return Response.json({error:error instanceof AppError ? error.message : "上传未成功，请核对文件后重试"},{status:error instanceof ForbiddenError ? 403 : 400}); }
}
