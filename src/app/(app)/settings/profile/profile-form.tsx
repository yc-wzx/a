"use client";
import { useActionState, useState } from "react";
import Link from "next/link";
import { AVATAR_COLORS, AVATAR_NAMES } from "@/contracts/member-profile";
import type { getMyProfile } from "@/lib/member-profile";
import { MemberAvatar } from "@/components/people/member-avatar";
import { saveMyProfileAction } from "./actions";

export function ProfileForm({ profile }: { profile: Awaited<ReturnType<typeof getMyProfile>> }) {
  const [state, action, pending] = useActionState(saveMyProfileAction, null);
  const [name, setName] = useState(profile.name), [label, setLabel] = useState(profile.avatarLabel), [color, setColor] = useState(profile.avatarColor);
  const [bio, setBio] = useState(profile.bio), [skills, setSkills] = useState(profile.skills.join("，"));
  return <form action={action} className="ac-card space-y-6 p-6" data-profile-editor>
    <input type="hidden" name="expectedRevision" value={profile.revision} />
    <div className="flex items-center gap-5 border-b border-line pb-6"><MemberAvatar name={name || "姓名"} color={color} label={label} large />
      <div><h2 className="font-semibold">个人头像</h2><p className="mt-1 text-sm text-ink-soft">选择颜色和文字作为站内标识。</p></div></div>
    <div className="grid grid-cols-2 gap-5">
      <label className="text-sm">姓名<input className="ac-field mt-2" name="name" required maxLength={80} value={name} onChange={event => setName(event.target.value)} /></label>
      <label className="text-sm">头像文字（可选）<input className="ac-field mt-2" name="avatarLabel" maxLength={4} placeholder="默认使用姓名前两个字" value={label} onChange={event => setLabel(event.target.value)} /></label>
    </div>
    <fieldset><legend className="mb-2 text-sm">头像颜色</legend><div className="flex gap-3">{AVATAR_COLORS.map(value => <label key={value} className={`flex cursor-pointer items-center gap-2 rounded-field border px-3 py-2 text-sm ${color === value ? "border-primary bg-primary-soft" : "border-line"}`}><input type="radio" name="avatarColor" value={value} checked={color === value} onChange={() => setColor(value)} />{AVATAR_NAMES[value]}</label>)}</div></fieldset>
    <label className="block text-sm">个人简介<textarea name="bio" maxLength={500} rows={4} value={bio} onChange={event => setBio(event.target.value)} placeholder="介绍自己在团队中的职责、关注的方向和协作习惯。" className="ac-field mt-2" /></label>
    <label className="block text-sm">技能标签<input name="skills" maxLength={500} value={skills} onChange={event => setSkills(event.target.value)} placeholder="例如：前端开发，交互设计，测试，项目组织" className="ac-field mt-2" /><span className="mt-2 block text-xs text-ink-soft">用逗号分隔，最多 12 个；由本人填写，供团队分工参考。</span></label>
    <p className="text-xs leading-5 text-ink-soft">资料向共同团队成员展示。任务与成果来自项目记录；编辑介绍不会改变团队角色或任务状态。</p>
    {state?.error && <p role="alert" className="text-sm text-high">{state.error}</p>}
    <div className="flex gap-3"><button disabled={pending} className="ac-btn">{pending ? "保存中…" : "保存个人资料"}</button><Link href={`/people/${profile.id}`} className="ac-btn-ghost">查看我的主页</Link></div>
    {profile.revision > 0 && <p role="status" className="text-xs text-ink-soft">个人资料已保存，可打开主页核对。</p>}
  </form>;
}
