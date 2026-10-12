import { redirect } from "next/navigation";

// Keep existing timeline links working; all three views now share filters and the detail panel.
export default async function TimelinePage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { projectId } = await params;
  const sp = await searchParams;
  const query = new URLSearchParams(
    Object.entries(sp).flatMap(([key, value]) =>
      typeof value === "string" ? [[key, value] as [string, string]] : [],
    ),
  );
  query.set("view", "gantt");
  redirect(`/projects/${projectId}?${query}`);
}
