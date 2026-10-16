export type WorkloadTask = {
  id: string;
  title: string;
  assigneeId: string | null;
  assigneeName: string | null;
  assignees?: { id: string; name: string }[];
  status: string;
  priority: string;
  dueDate: string | null;
  parentTaskId: string | null;
};
export type MemberWorkload = {
  id: string;
  name: string;
  total: number;
  open: number;
  done: number;
  overdue: number;
  urgent: WorkloadTask[];
};
// Task counts, not estimated effort: parent and child tasks are separate records, each counted once.
export function summarizeMemberWorkload(
  members: { id: string; name: string }[],
  tasks: WorkloadTask[],
  today: string,
): MemberWorkload[] {
  const rows = new Map<string, MemberWorkload>(
    members.map((member) => [
      member.id,
      { ...member, total: 0, open: 0, done: 0, overdue: 0, urgent: [] },
    ]),
  );
  for (const task of tasks) {
    const people = task.assignees?.length ? task.assignees : [{ id: task.assigneeId ?? "none", name: task.assigneeId ? (task.assigneeName ?? "原成员") : "未指派" }];
    for (const person of people) {
    const id = person.id;
    if (!rows.has(id))
      rows.set(id, {
        id,
        name: person.name,
        total: 0,
        open: 0,
        done: 0,
        overdue: 0,
        urgent: [],
      });
    const row = rows.get(id)!;
    row.total++;
    if (task.status === "done") row.done++;
    else {
      row.open++;
      if (task.dueDate && task.dueDate < today) row.overdue++;
      row.urgent.push(task);
    }
  }
  }
  for (const row of rows.values())
    row.urgent.sort((a, b) => {
      const overdue = (task: WorkloadTask) =>
        !!task.dueDate && task.dueDate < today;
      return (
        Number(overdue(b)) - Number(overdue(a)) ||
        (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999") ||
        Number(b.priority === "high") - Number(a.priority === "high") ||
        a.id.localeCompare(b.id)
      );
    });
  return [...rows.values()];
}
