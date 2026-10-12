import { auth } from "@/lib/auth";
import { listDocuments } from "@/lib/documents";
import { getProjectForUser } from "@/lib/project";
import { DocumentLibrary } from "@/components/documents/document-library";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";

export default async function DocumentsPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  if (!z.uuid().safeParse(projectId).success) notFound();
  const access = await getProjectForUser(session.user.id, projectId);
  if (!access) notFound();
  const initial = await listDocuments(session.user.id, projectId, {});
  return <DocumentLibrary projectId={projectId} initial={initial} canCreate={access.project.status !== "archived"} />;
}
