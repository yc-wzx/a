import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { getProjectForUser, projectVersion } from "@/lib/project";
import { previewProjectDeletion } from "@/lib/project-management";
import { SettingsForm } from "./settings-form";
export const metadata = { title: "项目设置 · AgileCampus" };
export default async function ProjectSettings({ params }: { params: Promise<{ projectId: string }> }) {
  const session = await auth(); if (!session?.user?.id) redirect("/login");
  const { projectId } = await params;
  const access = await getProjectForUser(session.user.id, projectId); if (!access) notFound();
  return <main className="space-y-5"><h1 className="font-display text-2xl font-semibold">项目设置</h1>{access.role === "admin" ? <SettingsForm key={projectVersion(access.project)} project={access.project} version={projectVersion(access.project)} preview={await previewProjectDeletion(session.user.id, projectId)} /> : <p className="ac-card p-6 text-sm">项目说明、日期、归档和删除由团队管理员管理。</p>}</main>;
}
