"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";

export function WorkspaceFrame({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const assistant = pathname === "/assistant";
  const project = /^\/projects\/[^/]+(?:\/|$)/.test(pathname) && pathname !== "/projects/new";
  useEffect(() => {
    const header = document.querySelector<HTMLElement>("[data-app-header]");
    if (!header) return;
    const observer = new ResizeObserver(() => {
      document.documentElement.style.setProperty("--app-header-height", `${header.getBoundingClientRect().height}px`);
    });
    observer.observe(header);
    return () => observer.disconnect();
  }, []);
  return <div className={`app-workspace-frame ${assistant ? "app-workspace-assistant" : project ? "app-workspace-project" : ""}`}>{children}</div>;
}
