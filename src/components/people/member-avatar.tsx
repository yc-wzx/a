import type { AVATAR_COLORS } from "@/contracts/member-profile";

const colors: Record<(typeof AVATAR_COLORS)[number], string> = {
  blue: "bg-blue-100 text-blue-800", violet: "bg-violet-100 text-violet-800",
  emerald: "bg-emerald-100 text-emerald-800", amber: "bg-amber-100 text-amber-800",
  rose: "bg-rose-100 text-rose-800", slate: "bg-slate-100 text-slate-700",
};
export function MemberAvatar({ name, color = "blue", label, large = false, compact = false }: {
  name: string; color?: (typeof AVATAR_COLORS)[number]; label?: string; large?: boolean; compact?: boolean;
}) {
  const text = label || Array.from(name).slice(0, 2).join("");
  const longer = Array.from(text).length > 2;
  return <span aria-hidden="true" className={`grid shrink-0 place-items-center rounded-2xl font-semibold ${colors[color]} ${large ? `h-24 w-24 ${longer ? "text-lg" : "text-3xl"}` : compact ? "h-7 w-7 rounded-lg text-[10px]" : `h-12 w-12 ${longer ? "text-xs" : "text-lg"}`}`}>
    {compact ? Array.from(text).slice(0, 2).join("") : text}
  </span>;
}
