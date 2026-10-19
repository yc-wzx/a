"use client";
import { useActionState } from "react";
import { changeMemberAction } from "./actions";
export function MemberControls({ teamId, userId, role, isSelf, canManage }: { teamId: string; userId: string; role: "admin" | "teacher" | "student"; isSelf: boolean; canManage: boolean }) {
  const [state, action, pending] = useActionState(changeMemberAction, null);
  return <form action={action} className="mt-4 space-y-3 border-t border-line pt-3" onSubmit={event => { const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null; if (submitter?.value === "remove" && !window.confirm("离开团队后将失去该团队全部项目的访问权限，已提交任务、成果及作者记录保留。确认继续？")) event.preventDefault(); }}>
    <input type="hidden" name="teamId" value={teamId} /><input type="hidden" name="userId" value={userId} />
    {canManage && <div className="flex gap-2"><select name="role" aria-label="团队角色" defaultValue={role} disabled={pending} className="min-w-0 flex-1 rounded border border-line bg-canvas p-2 text-sm"><option value="student">学生</option><option value="teacher">老师</option><option value="admin">管理员</option></select><button name="operation" value="role" disabled={pending} className="ac-btn-ghost text-sm">保存角色</button></div>}
    {(canManage || isSelf) && <button name="operation" value="remove" disabled={pending} className="text-xs text-high underline">{pending ? "处理中…" : isSelf ? "退出团队" : "移除成员"}</button>}
    {state?.error && <p role="alert" className="text-xs text-high">{state.error}</p>}{state?.success && <p role="status" className="text-xs text-done">{state.success}</p>}
  </form>;
}
