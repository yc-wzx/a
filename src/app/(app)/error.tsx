"use client";
import Link from "next/link";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return <section className="ac-card my-8 space-y-4 p-8" role="alert"><h1 className="text-xl font-semibold">页面暂时无法加载</h1><p className="text-sm text-ink-soft">请检查网络后重试。尚未提交的操作不会被当作已完成。</p><div className="flex gap-3"><button className="ac-btn" onClick={reset}>重新加载</button><Link className="ac-btn-ghost" href="/dashboard">返回工作台</Link></div></section>;
}
