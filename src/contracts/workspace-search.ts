export type SearchKind = "all" | "documents" | "resources" | "tasks" | "projects";
export type WorkspaceSearchItem = { id: string; label: string; excerpt: string; href: string; group: string; projectId: string; projectName: string };
export type WorkspaceSearchResult = { items: WorkspaceSearchItem[]; total: number; nextOffset: number | null; projects: { id: string; name: string }[] };
