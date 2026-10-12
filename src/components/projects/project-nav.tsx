import Link from "next/link";
import {
  PROJECT_NAV_GROUPS,
  type ProjectNavKey,
} from "@/lib/project-navigation";
export type { ProjectNavKey } from "@/lib/project-navigation";

// The shared project layout provides the full sidebar. Pages keep a compact breadcrumb.
export function ProjectNav({
  projectId,
  current,
}: {
  projectId: string;
  current: ProjectNavKey;
}) {
  const section = PROJECT_NAV_GROUPS.flatMap((group) => [...group.items]).find(
    (item) => item.key === current,
  )!;
  return (
    <nav
      aria-label="项目当前位置"
      className="flex items-center gap-2 text-xs text-ink-soft"
    >
      <Link
        href={`/projects/${projectId}/overview`}
        className="hover:text-primary"
      >
        项目
      </Link>
      <span aria-hidden>/</span>
      <span className="font-medium text-ink">{section.label}</span>
    </nav>
  );
}
