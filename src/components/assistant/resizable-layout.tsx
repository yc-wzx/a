"use client";

import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";

const DEFAULT_WIDTH = 228;
const MIN_WIDTH = 180;
const MAX_WIDTH = 440;
const EVENT = "agilecampus:assistant-sidebar-width";
const widths = new Map<string, number>();

function subscribe(listener: () => void) {
  window.addEventListener("storage", listener);
  window.addEventListener(EVENT, listener);
  return () => { window.removeEventListener("storage", listener); window.removeEventListener(EVENT, listener); };
}

export function AssistantLayout({ userId, sidebar, children }: { userId: string; sidebar: ReactNode; children: ReactNode }) {
  const root = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(1100);
  const key = `agilecampus:assistant-sidebar:${userId}`;
  const savedWidth = useSyncExternalStore(subscribe, () => {
    try {
      const raw = localStorage.getItem(key);
      const value = raw === null ? widths.get(key) ?? DEFAULT_WIDTH : Number(raw);
      return Number.isFinite(value) ? Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, value)) : DEFAULT_WIDTH;
    } catch { return widths.get(key) ?? DEFAULT_WIDTH; }
  }, () => DEFAULT_WIDTH);
  const maximum = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, containerWidth - 430));
  const width = Math.min(savedWidth, maximum);
  useEffect(() => {
    if (!root.current) return;
    const observer = new ResizeObserver(entries => setContainerWidth(entries[0].contentRect.width));
    observer.observe(root.current);
    return () => observer.disconnect();
  }, []);
  function resize(value: number) {
    const next = Math.round(Math.max(MIN_WIDTH, Math.min(maximum, value)));
    widths.set(key, next);
    try { localStorage.setItem(key, String(next)); } catch { /* Keep this session usable when browser storage is unavailable. */ }
    window.dispatchEvent(new Event(EVENT));
  }
  return <div ref={root} className="assistant-layout" style={{ gridTemplateColumns: `${width}px 9px minmax(0,1fr)` }}>
    <aside className="assistant-sidebar" aria-label="项目与历史对话">{sidebar}</aside>
    <div role="separator" tabIndex={0} aria-label="调整历史对话栏宽度" aria-orientation="vertical" aria-valuemin={MIN_WIDTH} aria-valuemax={maximum} aria-valuenow={width} className="assistant-resizer"
      onKeyDown={event => {
        if (event.key === "ArrowLeft" || event.key === "ArrowRight") { event.preventDefault(); resize(width + (event.key === "ArrowLeft" ? -12 : 12)); }
        if (event.key === "Home") { event.preventDefault(); resize(MIN_WIDTH); }
        if (event.key === "End") { event.preventDefault(); resize(maximum); }
      }}
      onDoubleClick={() => resize(DEFAULT_WIDTH)}
      onPointerDown={event => { if (event.button !== 0) return; event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); root.current?.setAttribute("data-resizing", "true"); }}
      onPointerMove={event => { if (!event.currentTarget.hasPointerCapture(event.pointerId) || !root.current) return; resize(event.clientX - root.current.getBoundingClientRect().left); }}
      onPointerUp={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); root.current?.removeAttribute("data-resizing"); }}
      onPointerCancel={() => root.current?.removeAttribute("data-resizing")}
      onLostPointerCapture={() => root.current?.removeAttribute("data-resizing")}><span /></div>
    <main className="assistant-main">{children}</main>
  </div>;
}
