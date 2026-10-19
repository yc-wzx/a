"use client";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
export function RefreshButton() {
  const router = useRouter(), [pending, start] = useTransition();
  return <button type="button" className="ac-btn-ghost" disabled={pending} onClick={() => start(() => router.refresh())}><RefreshCw size={14} className={pending ? "animate-spin" : ""} />{pending ? "刷新中…" : "刷新数据"}</button>;
}
