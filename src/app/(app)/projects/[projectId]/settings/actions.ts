"use server";
import { auth } from "@/lib/auth";
import { updateProject } from "@/lib/project";
import { deleteArchivedProject } from "@/lib/project-management";
import { AppError } from "@/lib/errors";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
export async function saveProjectSettings(projectId: string, version: string, _previous: { error?: string; success?: string } | null, form: FormData) {
  const session = await auth();
  if (!session?.user?.id) return { error: "请先登录" };
  try {
    await updateProject(session.user.id, projectId, {
      name: String(form.get("name") ?? ""), description: String(form.get("description") ?? ""),
      startDate: String(form.get("startDate") ?? "") || null, endDate: String(form.get("endDate") ?? "") || null,
      status: form.get("status") as "active" | "archived",
    }, version);
  } catch (e) { return { error: e instanceof AppError ? e.message : "保存失败，请重试" }; }
  revalidatePath(`/projects/${projectId}`, "layout"); revalidatePath("/projects"); revalidatePath("/dashboard"); revalidatePath("/teams");
  return { success: "项目设置已保存" };
}
export async function deleteProjectSettings(projectId: string, token: string, _previous: { error: string } | null, form: FormData) {
  const session = await auth();
  if (!session?.user?.id) return { error: "请先登录" };
  try { await deleteArchivedProject(session.user.id, projectId, { name: String(form.get("confirmation") ?? ""), token }); }
  catch (e) { return { error: e instanceof AppError ? e.message : "删除失败，请刷新后重试" }; }
  revalidatePath("/projects"); revalidatePath("/dashboard"); revalidatePath("/teams"); redirect("/projects");
}
