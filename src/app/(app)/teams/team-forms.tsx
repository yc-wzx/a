"use client";

import { useActionState, useState } from "react";
import { createTeamAction, joinTeamAction, type FormState } from "./actions";

export function TeamForms() {
  const [tab, setTab] = useState<"join" | "create">("join");
  const [createState, createFormAction, creating] = useActionState<FormState, FormData>(
    createTeamAction,
    null,
  );
  const [joinState, joinFormAction, joining] = useActionState<FormState, FormData>(
    joinTeamAction,
    null,
  );

  return (
    <div className="ac-card space-y-4 p-5">
      <h2 className="font-semibold">开始团队协作</h2>
      <div className="flex rounded-field bg-canvas p-1" aria-label="团队操作">
        <button type="button" disabled={creating || joining} aria-pressed={tab === "join"} onClick={() => setTab("join")} className={`flex-1 rounded px-3 py-2 text-sm ${tab === "join" ? "bg-surface text-primary shadow-sm" : "text-ink-soft"}`}>加入团队</button>
        <button type="button" disabled={creating || joining} aria-pressed={tab === "create"} onClick={() => setTab("create")} className={`flex-1 rounded px-3 py-2 text-sm ${tab === "create" ? "bg-surface text-primary shadow-sm" : "text-ink-soft"}`}>创建团队</button>
      </div>
      {tab === "create" ? <form action={createFormAction} className="space-y-4">
        <p className="text-xs leading-5 text-ink-soft">创建后你将成为管理员，可邀请成员并创建项目。</p>
        <label className="block text-sm">团队名称<input name="name" required maxLength={100} placeholder="例如：唯笃队" className="ac-field mt-1" /></label>
        {createState?.error && <p role="alert" className="text-sm text-high">{createState.error}</p>}
        <button disabled={creating} className="ac-btn">
          {creating ? "创建中…" : "确认创建"}
        </button>
      </form> : <form action={joinFormAction} className="space-y-4">
        <p className="text-xs leading-5 text-ink-soft">向团队成员获取邀请码。指导教师加入后，由管理员设置角色。</p>
        <label className="block text-sm">团队邀请码<input name="inviteCode" required placeholder="填写团队邀请码" className="ac-field mt-1" /></label>
        {joinState?.error && <p role="alert" className="text-sm text-high">{joinState.error}</p>}
        <button disabled={joining} className="ac-btn">
          {joining ? "加入中…" : "确认加入"}
        </button>
      </form>}
    </div>
  );
}
