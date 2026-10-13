import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { getMyProfile } from "@/lib/member-profile";
import { ProfileForm } from "./profile-form";

export default async function Page() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const profile = await getMyProfile(session.user.id);
  return <main className="mx-auto max-w-3xl space-y-6 py-6">
    <header className="space-y-3"><Link href={`/people/${profile.id}`} className="text-sm text-ink-soft hover:text-primary">← 我的主页</Link><h1 className="font-display text-3xl font-semibold">编辑个人资料</h1><p className="text-sm text-ink-soft">维护个人介绍与技能，让团队了解你的分工方向。</p></header>
    <ProfileForm profile={profile} />
  </main>;
}
