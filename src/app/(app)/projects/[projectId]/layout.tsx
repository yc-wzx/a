import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { getProjectForUser } from "@/lib/project";
import { ProjectSidebar } from "@/components/projects/project-sidebar";

export default async function ProjectLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  if (!z.uuid().safeParse(projectId).success) notFound();
  const access = await getProjectForUser(session.user.id, projectId);
  if (!access) notFound();
  // The shared layout only renders navigation; each page/action still checks live access.
  return (
    <div className="grid grid-cols-[196px_minmax(0,1fr)] items-start gap-6 py-4">
      <ProjectSidebar projectId={projectId} name={access.project.name} />
      <div className="min-w-0">{children}</div>
    </div>
  );
}
