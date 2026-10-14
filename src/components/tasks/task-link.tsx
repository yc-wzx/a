"use client";

import type { ComponentProps } from "react";
import Link from "next/link";
import { openTaskPreview, taskTargetFromHref } from "@/lib/task-navigation";

/** Ordinary clicks preview here; modified clicks retain the canonical deep link. */
export function TaskLink(props: Omit<ComponentProps<typeof Link>, "onNavigate">) {
  const href = props.href;
  if (typeof href !== "string" || !taskTargetFromHref(href))
    return <Link {...props} />;
  return <Link {...props} prefetch={false} onNavigate={event => {
    event.preventDefault();
    openTaskPreview(href);
  }} />;
}
