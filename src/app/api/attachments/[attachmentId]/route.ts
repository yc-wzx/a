import { auth } from "@/lib/auth";
import { AppError, ForbiddenError } from "@/lib/errors";
import { deleteAttachment, readAttachment } from "@/lib/attachments";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = {params:Promise<{attachmentId:string}>};
export async function GET(request: Request, context: Context) {
  const session = await auth(); if (!session?.user) return Response.json({error:"请先登录"},{status:401});
  try {
    const {row,bytes} = await readAttachment(session.user.id,(await context.params).attachmentId);
    const inline = !new URL(request.url).searchParams.has("download") && (row.mediaType.startsWith("image/") || row.mediaType === "application/pdf");
    const headers: Record<string,string> = {"Content-Type":row.mediaType,"Content-Disposition":`${inline ? "inline" : "attachment"}; filename="attachment"; filename*=UTF-8''${encodeURIComponent(row.filename).replace(/'/g,"%27")}`,"Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff","Cross-Origin-Resource-Policy":"same-origin","Content-Security-Policy":"default-src 'none'; frame-ancestors 'self'","Accept-Ranges":"bytes"};
    const range = request.headers.get("range");
    if (range) {
      const match = /^bytes=(\d+)-(\d*)$/.exec(range), start = Number(match?.[1]), end = match?.[2] ? Number(match[2]) : bytes.length - 1;
      if (!match || start > end || end >= bytes.length) return new Response(null,{status:416,headers:{...headers,"Content-Range":`bytes */${bytes.length}`}});
      return new Response(new Uint8Array(bytes.subarray(start,end+1)),{status:206,headers:{...headers,"Content-Length":String(end-start+1),"Content-Range":`bytes ${start}-${end}/${bytes.length}`}});
    }
    return new Response(new Uint8Array(bytes),{headers:{...headers,"Content-Length":String(bytes.length)}});
  } catch(error) { return Response.json({error:error instanceof AppError ? error.message : "附件读取失败"},{status:error instanceof ForbiddenError ? 403 : 400}); }
}
export async function DELETE(request:Request,context:Context) {
  const session = await auth(); if (!session?.user) return Response.json({error:"请先登录"},{status:401});
  const origin = request.headers.get("origin");
  if (!origin || ![new URL(request.url).origin,process.env.AUTH_URL && new URL(process.env.AUTH_URL).origin,process.env.AGILECAMPUS_URL && new URL(process.env.AGILECAMPUS_URL).origin].includes(origin)) return Response.json({error:"没有权限"},{status:403});
  try { await deleteAttachment(session.user.id,(await context.params).attachmentId); return Response.json({ok:true}); }
  catch(error) { return Response.json({error:error instanceof AppError ? error.message : "删除失败"},{status:403}); }
}
