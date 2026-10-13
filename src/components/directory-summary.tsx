import type { LucideIcon } from "lucide-react";

export function DirectorySummary({ items }: {
  items: { label: string; value: string | number; detail: string; icon: LucideIcon }[];
}) {
  return <section aria-label="页面统计" className="grid grid-cols-3 gap-4">
    {items.map(({ label, value, detail, icon: Icon }) => <div key={label} className="ac-card flex items-start justify-between p-5">
      <div><p className="text-sm text-ink-soft">{label}</p><p className="mt-2 text-2xl font-semibold tabular-nums">{value}</p><p className="mt-2 text-xs text-ink-faint">{detail}</p></div>
      <Icon size={21} className="text-primary" />
    </div>)}
  </section>;
}
