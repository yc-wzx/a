"use server";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { updateMyProfile } from "@/lib/member-profile";
import { AppError } from "@/lib/errors";
import { profileEditSchema } from "@/contracts/member-profile";

export type ProfileFormState = { error: string } | null;
export async function saveMyProfileAction(_state: ProfileFormState, form: FormData): Promise<ProfileFormState> {
  const session = await auth();
  if (!session?.user?.id) return { error: "请先登录" };
  const parsed = profileEditSchema.safeParse({
    name: form.get("name"), bio: form.get("bio"), avatarColor: form.get("avatarColor"), avatarLabel: form.get("avatarLabel"),
    skills: String(form.get("skills") ?? "").split(/[，,、;；\n]+/).map(s => s.trim()).filter(Boolean),
    expectedRevision: Number(form.get("expectedRevision")),
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  try {
    await updateMyProfile(session.user.id, parsed.data);
    revalidatePath("/", "layout");
  } catch (error) {
    if (error instanceof AppError) return { error: error.message };
    return { error: "资料暂时未能保存，请稍后重试。" };
  }
  // The server returns the refreshed revision with the same response. No redirect
  // is needed, so validation failures keep the member's entered content.
  return null;
}
