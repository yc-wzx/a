import { auth } from "@/lib/auth";
import { getDocumentDetail } from "@/lib/documents";
import { DocumentWorkspace } from "@/components/documents/document-workspace";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { ForbiddenError } from "@/lib/errors";

export default async function DocumentPage({ params }: { params: Promise<{ projectId: string; documentId: string }> }) {
  const { projectId, documentId } = await params;
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  if (!z.uuid().safeParse(projectId).success || !z.uuid().safeParse(documentId).success) notFound();
  const detail = await getDocumentDetail(session.user.id, projectId, documentId).catch((error: unknown) => {
    if (error instanceof ForbiddenError) notFound();
    throw error;
  });
  if (detail.deletedAt) redirect(`/projects/${projectId}/documents`);
  return <DocumentWorkspace initial={detail} />;
}
