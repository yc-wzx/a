"use client";
import { usePathname } from "next/navigation";
import { WorkspaceSearchDialog } from "./workspace-search-dialog";
export function GlobalWorkspaceSearch() { const pathname = usePathname(); return pathname === "/dashboard" ? null : <WorkspaceSearchDialog />; }
