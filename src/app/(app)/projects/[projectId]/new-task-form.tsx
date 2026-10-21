"use client";

import { MemberPicker } from "@/components/tasks/member-picker";
import { startTransition, useActionState, useRef, useState } from "react";
import { createTaskAction, type FormState } from "./actions";

export function NewTaskForm({
  projectId,
  members,
  milestones, iterations = [],
}: {
  projectId: string;
  members: { id: string; name: string }[];
  milestones: { id: string; title: string }[];
  iterations?: { id: string; name: string; revision: number }[];
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [requestId, setRequestId] = useState(() => crypto.randomUUID()), [iterationId, setIterationId] = useState("");
  const [state, formAction, pending] = useActionState<FormState, FormData>(
    async (previous, form) => { const result = await createTaskAction(previous, form); if (result?.createdId) { formRef.current?.reset(); setIterationId(""); setRequestId(crypto.randomUUID()); } return result; },
    null,
  );

  return (
    <details className="project-new-task"><summary className="ac-btn cursor-pointer">＋ 新建任务</summary><form ref={formRef} id="new-task" onSubmit={event => { event.preventDefault(); const form = new FormData(event.currentTarget); startTransition(() => formAction(form)); }} onChange={() => setRequestId(crypto.randomUUID())} className="project-new-task-form scroll-mt-24 space-y-3 p-5"><fieldset disabled={pending} className="space-y-3">
      <h2 className="font-medium text-ink">新建任务</h2>
      <input type="hidden" name="projectId" value={projectId} /><input type="hidden" name="requestId" value={requestId} /><input type="hidden" name="iterationRevision" value={iterations.find(i => i.id === iterationId)?.revision ?? ""} />
      <input name="title" aria-label="新任务标题" required maxLength={200} placeholder="任务标题" className="ac-field" />
      <textarea name="description" placeholder="任务描述（可选）" rows={2} className="ac-field" />
      <div className="flex flex-wrap gap-2">
        <MemberPicker members={members} />
        <label className="text-sm">所属迭代<select name="iterationId" className="ac-field" value={iterationId} onChange={e => setIterationId(e.target.value)}><option value="">暂放任务池</option>{iterations.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}</select></label>
        <select name="milestoneId" defaultValue="" className="ac-field w-auto text-sm">
          <option value="">无里程碑</option>
          {milestones.map((m) => (
            <option key={m.id} value={m.id}>
              {m.title}
            </option>
          ))}
        </select>
        <select name="priority" defaultValue="medium" className="ac-field w-auto text-sm">
          <option value="low">低</option>
          <option value="medium">中</option>
          <option value="high">高</option>
        </select>
        <label className="flex items-center gap-1 text-sm text-ink-faint">
          起
          <input type="date" name="startDate" className="ac-field w-auto text-sm" />
        </label>
        <label className="flex items-center gap-1 text-sm text-ink-faint">
          止
          <input type="date" name="dueDate" className="ac-field w-auto text-sm" />
        </label>
      </div>
      {state?.error && <p className="text-sm text-high">{state.error}</p>}
      <button disabled={pending} className="ac-btn px-3 py-2 text-sm">
        {pending ? "创建中…" : "创建任务"}
      </button>{state?.createdId && <p role="status" className="text-sm text-done">任务已创建。</p>}</fieldset>
    </form></details>
  );
}
