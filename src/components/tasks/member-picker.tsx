"use client";
export function MemberPicker({ members, selected = [], name = "assigneeIds" }: { members: { id: string; name: string }[]; selected?: string[]; name?: string }) {
  return <fieldset className="rounded-xl border border-line p-3"><legend className="px-1 text-sm text-ink-soft">执行成员（可多选）</legend><div className="flex flex-wrap gap-x-4 gap-y-2">{members.map(m => <label key={m.id} className="flex cursor-pointer items-center gap-2 text-sm"><input type="checkbox" name={name} value={m.id} defaultChecked={selected.includes(m.id)} className="accent-primary" />{m.name}</label>)}</div></fieldset>;
}
