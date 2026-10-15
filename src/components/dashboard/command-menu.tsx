"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
export { WorkspaceSearchDialog as WorkspaceCommandMenu } from "./workspace-search-dialog";
export type WorkspaceCommand = { id: string; label: string; detail?: string; href: string; group: string };

export function RefreshWorkspace() {
  const router = useRouter(),
    [pending, startTransition] = useTransition();
  const [refreshed, setRefreshed] = useState(false);
  return (
    <div className="flex items-center gap-2">
      <span role="status" className="text-xs text-ink-soft">
        {pending ? "正在更新…" : refreshed ? "已更新" : ""}
      </span>
      <button
        type="button"
        className="workspace-icon-button"
        aria-label="刷新工作台"
        disabled={pending}
        onClick={() => {
          setRefreshed(true);
          startTransition(() => router.refresh());
        }}
      >
        <RefreshCw
          aria-hidden
          className={`size-4 ${pending ? "animate-spin" : ""}`}
        />
      </button>
    </div>
  );
}
