import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { listMyProjects, listProjectMilestones } from "@/lib/project";
import { listProjectTasks } from "@/lib/task";
import { listTeamMembers } from "@/lib/team";
import { getMyAiSettings } from "@/lib/agent/personal-settings";
import { AssistantWorkspace } from "@/components/assistant/workspace";
export default async function AssistantPage({ searchParams }: { searchParams: Promise<{ projectId?: string }> }) {
  const session = await auth(); if (!session?.user) redirect("/login");
  const [projects, settings, q] = await Promise.all([listMyProjects(session.user.id), getMyAiSettings(session.user.id), searchParams]);
  const selected = projects.find(p => p.id === q.projectId) ?? projects[0];
  const [tasks, members, milestones] = selected ? await Promise.all([listProjectTasks(session.user.id, selected.id), listTeamMembers(selected.teamId), listProjectMilestones(session.user.id, selected.id)]) : [[], [], []];
  return <AssistantWorkspace key={selected?.id ?? "empty"} projects={projects.map(p => ({ id: p.id, name: p.name }))} projectId={selected?.id ?? ""} assistantName={settings.assistantName} configured={settings.configured} members={members.map(m => ({ id: m.id, name: m.name }))} milestones={milestones.map(m => ({ id: m.id, name: m.title }))} tasks={tasks.slice(0, 50).map(t => ({ id: t.id, title: t.title, status: t.status }))} />;
}
