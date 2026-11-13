"use client";
export function MemberPicker({ members, selected = [], name = "assigneeIds", onChange }: {
  members: { id: string; name: string }[];
  selected?: string[];
  name?: string;
  onChange?: (ids: string[]) => void;
}) {
  return <fieldset className="rounded-xl border border-line p-3">
    <legend className="px-1 text-sm text-ink-soft">执行成员（可多选）</legend>
    <div className="flex flex-wrap gap-x-4 gap-y-2">{members.map(member => <label key={member.id} className="flex cursor-pointer items-center gap-2 text-sm">
      <input type="checkbox" name={name} value={member.id}
        checked={onChange ? selected.includes(member.id) : undefined}
        defaultChecked={onChange ? undefined : selected.includes(member.id)}
        onChange={onChange ? event => onChange(event.target.checked ? [...selected, member.id] : selected.filter(id => id !== member.id)) : undefined}
        className="accent-primary" />{member.name}
    </label>)}</div>
  </fieldset>;
}
