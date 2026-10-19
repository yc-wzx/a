"use client";

import { useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { closeTaskPreview, taskPreviewTarget } from "@/lib/task-navigation";
import { TaskDetailPanel } from "./task-detail-panel";

/** One authenticated layout owns the drawer for every task entry. */
export function TaskDrawerHost() {
  const pathname = usePathname(), search = useSearchParams(), router = useRouter();
  const [, startTransition] = useTransition();
  const target = taskPreviewTarget(pathname, new URLSearchParams(search.toString()));
  return target ? <TaskDetailPanel
    key={`${target.projectId}:${target.taskId}`}
    projectId={target.projectId}
    taskId={target.taskId}
    onClose={closeTaskPreview}
    onSaved={() => startTransition(() => router.refresh())}
  /> : null;
}
