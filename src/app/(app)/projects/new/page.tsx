import Link from "next/link";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { teams, teamMembers } from "@/db/schema";
import { ProjectForm } from "../../teams/[teamId]/projects/project-form";
export const metadata = { title: "创建项目 · AgileCampus" };
export default async function NewProjectPage({ searchParams }: { searchParams: Promise<{ team?: string }> }) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const list = await db.select({ id: teams.id, name: teams.name }).from(teams).innerJoin(teamMembers, eq(teams.id, teamMembers.teamId)).where(and(eq(teamMembers.userId, session.user.id), eq(teamMembers.role, "admin"))).orderBy(teams.name);
  const requested = (await searchParams).team;
  const selected = list.find(t => t.id === requested) ?? list[0];
  return <main className="mx-auto max-w-2xl space-y-5 py-6"><Link href="/projects" className="text-sm text-primary">← 所有项目</Link><h1 className="font-display text-2xl font-semibold">创建项目</h1>
    {selected ? <><nav className="flex flex-wrap gap-2" aria-label="选择项目所属团队">{list.map(t => <Link key={t.id} href={`/projects/new?team=${t.id}`} aria-current={selected.id === t.id ? "page" : undefined} className={selected.id === t.id ? "ac-btn" : "ac-btn-ghost"}>{t.name}</Link>)}</nav><ProjectForm key={selected.id} teamId={selected.id} requestId={randomUUID()} /></> : <section className="ac-card space-y-4 p-6"><p>仅团队管理员可以创建项目。请先创建团队，或请现有团队管理员创建项目。</p><Link href="/teams" className="ac-btn">前往团队</Link></section>}
  </main>;
}
