import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { listMyProjects } from "@/lib/project";
import { ProjectDirectory } from "@/components/projects/project-directory";

export default async function AllProjectsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const projects = await listMyProjects(session.user.id);
  return <ProjectDirectory projects={projects.map(p => ({ ...p, createdAt: undefined }))} />;
}
