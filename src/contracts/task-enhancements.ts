export type ChecklistItem = { id: string; text: string; checked: boolean; revision: number };
export type TaskMaterial = { id: string; title: string; kind: "resource" | "deliverable"; href: string; revision: number; sourceId: string };
export type MaterialOption = { id: string; title: string; kind: "resource" | "deliverable" };
export type TaskEnhancements = {
  taskId: string;
  checklist: ChecklistItem[];
  watching: boolean;
  watchCount: number;
  canWrite: boolean;
  canWatch: boolean;
  materials: TaskMaterial[];
  materialOptions: MaterialOption[];
};
export type ProjectDoingLimit = { projectId: string; doingLimit: number | null; revision: number; doingCount: number; exceeded: boolean; canManage: boolean };
