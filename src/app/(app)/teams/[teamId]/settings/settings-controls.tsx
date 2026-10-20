"use client";
import { useActionState, useState, useTransition } from "react";
import { Invitation } from "@/components/team-directory";
import { displayDateTime } from "@/lib/display-time";
import { archiveTeamAction, deleteTeamAction, previewTeamDeletionAction, reviewJoinAction, saveInvitationAction, type TeamSettingsState } from "./actions";

function Feedback({ state }: { state: TeamSettingsState }) { return state?.error ? <p role="alert" className="text-sm text-high">{state.error}</p> : state?.success ? <p role="status" className="text-sm text-low">{state.success}</p> : null; }
export function InvitationSettings({ teamId, code, revision, enabled, requireApproval, expiresAt, archived }: { teamId: string; code: string; revision: number; enabled: boolean; requireApproval: boolean; expiresAt: string | null; archived: boolean }) {
  const [state, action, pending] = useActionState(saveInvitationAction, null);
  return <section className="ac-card space-y-4 p-5"><h2 className="font-semibold">邀请成员</h2><Invitation code={code} /><p className="text-xs text-ink-soft">{expiresAt ? `当前到期时间：${displayDateTime(new Date(expiresAt))}` : "当前邀请码长期有效"}。加入者默认是成员，指导教师角色由管理员设置。</p>
    <form action={action} className="space-y-4"><input type="hidden" name="teamId" value={teamId} /><input type="hidden" name="revision" value={revision} />
      <fieldset disabled={pending || archived} className="space-y-4"><label className="flex items-center gap-2 text-sm"><input name="enabled" type="checkbox" defaultChecked={enabled} />允许使用邀请码加入</label><label className="flex items-center gap-2 text-sm"><input name="requireApproval" type="checkbox" defaultChecked={requireApproval} />新成员加入需要管理员审核</label>
      <label className="block max-w-xs text-sm">从本次保存起的有效期<select name="lifetimeDays" className="ac-field mt-1" defaultValue="7"><option value="1">1天</option><option value="7">7天</option><option value="30">30天</option><option value="0">长期有效</option></select></label>
      <label className="flex items-center gap-2 text-sm"><input name="rotate" type="checkbox" />同时重新生成邀请码，旧邀请码立即失效</label><p className="text-xs text-ink-soft">关闭或重置邀请不会移除已有成员；已经提交的加入申请仍可单独审核。</p><button className="ac-btn">{pending ? "保存中…" : "保存邀请设置"}</button></fieldset><Feedback state={state} />
    </form>{archived && <p className="text-sm text-ink-soft">团队已归档，邀请暂停。</p>}</section>;
}
export function JoinRequestControls({ teamId, requestId, archived }: { teamId: string; requestId: string; archived: boolean }) {
  const [state, action, pending] = useActionState(reviewJoinAction, null);
  return <form action={action} className="space-y-2"><input type="hidden" name="teamId" value={teamId} /><input type="hidden" name="requestId" value={requestId} /><div className="flex gap-2"><button name="decision" value="approve" disabled={pending || archived} className="ac-btn text-xs">同意加入</button><button name="decision" value="reject" disabled={pending || archived} className="ac-btn-ghost text-xs">拒绝</button></div><Feedback state={state} /></form>;
}
export function TeamDangerZone({ teamId, name, revision, archived }: { teamId: string; name: string; revision: number; archived: boolean }) {
  const [archiveState, archiveAction, archiving] = useActionState(archiveTeamAction, null);
  const [deleteState, deleteAction, deleting] = useActionState(deleteTeamAction, null);
  const [preview, setPreview] = useState<Awaited<ReturnType<typeof previewTeamDeletionAction>> | null>(null);
  const [loading, start] = useTransition();
  const [confirmation, setConfirmation] = useState("");
  return <section className="ac-card space-y-4 border-high/30 p-5"><h2 className="font-semibold">团队归档与解散</h2><p className="text-sm leading-6 text-ink-soft">先将全部项目归档，再归档团队。归档后保留阅读，暂停邀请、新建项目和预约审批；可以恢复团队。</p>
    <form action={archiveAction}><input type="hidden" name="teamId" value={teamId} /><input type="hidden" name="revision" value={revision} /><input type="hidden" name="archived" value={archived ? "false" : "true"} /><button disabled={archiving} className="ac-btn-ghost">{archiving ? "处理中…" : archived ? "恢复团队" : "归档团队"}</button><Feedback state={archiveState} /></form>
    {archived && <div className="space-y-3 border-t border-line pt-4"><p className="text-sm text-high">解散将永久删除本团队全部项目、文档（含个人可见文档）、任务、讨论、预约和团队成员关系。个人账号、个人课表及其他团队保留。</p><button type="button" disabled={loading} className="ac-btn-ghost text-high" onClick={() => start(async () => { setPreview(await previewTeamDeletionAction(teamId)); setConfirmation(""); })}>{loading ? "读取中…" : "核对解散范围"}</button>
      {preview?.error && <p role="alert" className="text-sm text-high">{preview.error}</p>}{preview?.preview && <form action={deleteAction} className="space-y-3 rounded-field bg-canvas p-4"><p className="text-sm">将删除 {preview.preview.counts.projects} 个项目、{preview.preview.counts.documents} 篇文档、{preview.preview.counts.tasks} 项任务、{preview.preview.counts.members} 条成员关系、{preview.preview.counts.reservations} 条预约和 {preview.preview.counts.usages} 条占用记录。</p><input type="hidden" name="teamId" value={teamId} /><input type="hidden" name="token" value={preview.preview.token} /><label className="block text-sm">输入完整团队名称「{name}」确认<input name="name" required autoComplete="off" value={confirmation} onChange={e => setConfirmation(e.target.value)} className="ac-field mt-1" /></label><button disabled={deleting || confirmation !== name} className="ac-btn bg-high text-white">{deleting ? "解散中…" : "永久解散团队"}</button><Feedback state={deleteState} /></form>}</div>}
  </section>;
}
