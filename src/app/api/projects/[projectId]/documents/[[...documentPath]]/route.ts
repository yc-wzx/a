import { NextRequest, NextResponse } from "next/server";
import { runAction } from "@/lib/action-result";
import { ForbiddenError, ValidationError } from "@/lib/errors";
import { addDocumentComment, changeDocumentComment, changeDocumentTaskLink, createDocument, createDocumentVersion, exportDocument, getDocumentDetail, getDocumentVersion, listDocuments, previewDocumentAi, restoreDocumentVersion, syncDocument, trashDocument, updateDocument } from "@/lib/documents";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ projectId: string; documentPath?: string[] }> };
const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
function status(code: string) { return ({ UNAUTHENTICATED: 401, FORBIDDEN: 403, VALIDATION: 422, CONFLICT: 409, INTERNAL: 500 } as Record<string, number>)[code] ?? 500; }
async function body(request: NextRequest): Promise<unknown> {
  const origin = request.headers.get("origin");
  if (origin) {
    let host: string; try { host = new URL(origin).host; } catch { throw new ForbiddenError("请求来源不正确"); }
    if (host !== request.headers.get("host") && host !== new URL(request.url).host) throw new ForbiddenError("请求来源不正确");
  }
  if (Number(request.headers.get("content-length") ?? "0") > 2000000) throw new ValidationError("请求内容过大");
  if (!request.body) throw new ValidationError("请求内容不能为空");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = []; let length = 0;
  try {
    for (;;) { const { done, value } = await reader.read(); if (done) break; length += value.length; if (length > 2000000) { await reader.cancel(); throw new ValidationError("请求内容过大"); } chunks.push(value); }
  } finally { reader.releaseLock(); }
  const text = Buffer.concat(chunks, length).toString("utf8");
  try { return JSON.parse(text); } catch { throw new ValidationError("请求格式不正确"); }
}
async function handle(request: NextRequest, context: Context) {
  const { projectId, documentPath = [] } = await context.params;
  const [documentId, section, itemId] = documentPath;
  const method = request.method;
  if (documentPath.length > 3) return NextResponse.json({ ok: false, code: "FORBIDDEN", error: "入口不存在" }, { status: 404, headers });
  if (method === "GET" && documentId && section === "export" && !itemId) {
    const result = await runAction(actor => exportDocument(actor, projectId, documentId));
    if (!result.ok) return NextResponse.json(result, { status: status(result.code), headers });
    const filename = encodeURIComponent(result.data.title.replace(/[\r\n\u0000-\u001f]/g, "").slice(0, 100) + ".md").replace(/'/g, "%27");
    return new NextResponse(result.data.markdown, { headers: { ...headers, "Content-Type": "text/markdown; charset=utf-8", "Content-Disposition": `attachment; filename="document.md"; filename*=UTF-8''${filename}` } });
  }
  const result = await runAction(async actor => {
    if (method === "GET") {
      if (!documentId) {
        const q = request.nextUrl.searchParams;
        return listDocuments(actor, projectId, { q: q.get("q") ?? "", folder: q.get("folder") ?? undefined, trash: q.get("trash") === "true", offset: Number(q.get("offset") ?? 0), taskId: q.get("taskId") ?? undefined });
      }
      if (!section) return getDocumentDetail(actor, projectId, documentId);
      if (section === "versions") return itemId ? getDocumentVersion(actor, projectId, documentId, itemId) : (await getDocumentDetail(actor, projectId, documentId)).versions;
      throw new ForbiddenError("入口不存在");
    }
    const input = await body(request);
    if (!documentId && method === "POST") return createDocument(actor, projectId, input);
    if (!documentId) throw new ForbiddenError("入口不存在");
    if (!section) {
      if (method === "PATCH") return updateDocument(actor, projectId, documentId, input);
      if (method === "DELETE") return trashDocument(actor, projectId, documentId, input);
      if (method === "POST" && input && typeof input === "object" && "operation" in input && input.operation === "restore") return trashDocument(actor, projectId, documentId, input, true);
    }
    if (section === "sync" && !itemId && method === "POST") return syncDocument(actor, projectId, documentId, input);
    if (section === "versions" && method === "POST") return itemId ? restoreDocumentVersion(actor, projectId, documentId, itemId, input) : createDocumentVersion(actor, projectId, documentId, input);
    if (itemId) throw new ForbiddenError("入口不存在");
    if (section === "comments") {
      if (method === "POST") return addDocumentComment(actor, projectId, documentId, input);
      if (method === "PATCH" || method === "DELETE") return changeDocumentComment(actor, projectId, documentId, input, method === "DELETE");
    }
    if (section === "links" && ["POST", "DELETE"].includes(method)) return changeDocumentTaskLink(actor, projectId, documentId, input, method === "DELETE");
    if (section === "ai" && method === "POST") return previewDocumentAi(actor, projectId, documentId, input);
    throw new ForbiddenError("入口不存在");
  });
  return NextResponse.json(result, { status: result.ok ? 200 : status(result.code), headers });
}
export const GET = handle;
export const POST = handle;
export const PATCH = handle;
export const DELETE = handle;
