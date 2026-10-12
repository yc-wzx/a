"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  ListTodo,
  Repeat2,
  ChartGantt,
  Megaphone,
  FolderOpen,
  Sparkles,
  PackageCheck,
  NotebookPen,
  History,
  ChevronDown,
  ArrowLeft,
} from "lucide-react";
import { CalendarDownload } from "@/app/(app)/projects/[projectId]/extras/calendar-download";
import {
  currentProjectSection,
  PROJECT_NAV_GROUPS,
} from "@/lib/project-navigation";

const icons = {
  overview: LayoutDashboard,
  tasks: ListTodo,
  iterations: Repeat2,
  timeline: ChartGantt,
  announcements: Megaphone,
  references: FolderOpen,
  ai: Sparkles,
  deliverables: PackageCheck,
  reports: NotebookPen,
  evidence: History,
};
export function ProjectSidebar({
  projectId,
  name,
}: {
  projectId: string;
  name: string;
}) {
  const pathname = usePathname();
  const current = currentProjectSection(pathname, projectId);
  const groups = PROJECT_NAV_GROUPS.map((group) => {
    const links = (
      <div className="space-y-1 py-2">
        {group.items.map((item) => {
          const Icon = icons[item.icon];
          const active = item.key === current;
          return (
            <Link
              key={item.key}
              href={`/projects/${projectId}${item.suffix}`}
              aria-current={active ? "page" : undefined}
              className={`flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm transition-colors ${active ? "bg-primary text-white shadow-sm" : "text-ink-soft hover:bg-primary-soft hover:text-primary"}`}
            >
              <Icon size={16} aria-hidden />
              {item.label}
            </Link>
          );
        })}
      </div>
    );
    return group.collapsible ? (
      <details
        key={`${group.label}:${current}`}
        open={group.items.some((item) => item.key === current)}
        className="group border-t border-line pt-3"
      >
        <summary className="flex cursor-pointer list-none items-center justify-between px-3 text-xs font-medium text-ink-faint">
          {group.label}
          <ChevronDown
            size={13}
            aria-hidden
            className="transition-transform group-open:rotate-180"
          />
        </summary>
        {links}
      </details>
    ) : (
      <div key={group.label}>
        <p className="px-3 text-xs font-medium text-ink-faint">{group.label}</p>
        {links}
      </div>
    );
  });
  return (
    <aside
      className="sticky top-24 self-start rounded-2xl border border-line bg-surface p-3 shadow-sm"
      data-project-sidebar
    >
      <Link
        href="/projects"
        className="flex items-center gap-1 px-3 py-2 text-xs text-ink-soft hover:text-primary"
      >
        <ArrowLeft size={13} aria-hidden />
        全部项目
      </Link>
      <p className="mb-5 mt-2 break-words px-3 font-display text-base font-semibold text-ink">
        {name}
      </p>
      <nav aria-label="项目内部导航" className="space-y-3">
        {groups}
      </nav>
      <div className="mt-5 border-t border-line pt-3">
        <CalendarDownload projectId={projectId} />
      </div>
    </aside>
  );
}
