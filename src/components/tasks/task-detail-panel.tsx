"use client";

import { useEffect, useRef, useState } from "react";
import { installUnsavedChangesGuard } from "@/lib/unsaved-changes";
import type {
  TaskPriorityValue,
  TaskPanelData,
  TaskStatusValue,
} from "@/contracts/p0-p2";
import { saveTaskAssociationsAction } from "@/app/(app)/projects/[projectId]/tasks/association-actions";
import {
  deleteTaskV1Action,
  getTaskPanelContextAction,
  setTaskBlockedAction,
  updateTaskV1Action,
} from "@/app/(app)/projects/[projectId]/tasks/actions";
import type { TaskSummary } from "@/contracts/p0-p2";
import { newRequestId } from "@/lib/request-id";
import { TaskCollaboration } from "./task-collaboration";
import { TaskOutcome } from "./task-outcome";
import { MemberPicker } from "./member-picker";
import { TaskEnhancementSection } from "./task-enhancements";
import { TaskDocumentLinks } from "@/components/documents/task-document-links";

// C / P0：任务详情侧边栏。取代原先卡片里的居中弹窗 EditModal。
//
// 契约（定稿 9.2）：`TaskDetailPanel({projectId,taskId,onClose,onSaved})`——
// **面板自己取数**：挂载时与 taskId 变化时各调一次 getTaskPanelContextAction，
// 每次都重新鉴权，不信任调用方传来的任务内容；也因此谁都能只拿两个 id 把它挂起来。
// `onSaved` 只在服务端确认写入成功后触发，给父级刷新看板卡片用。
//
// 打开/关闭由登录布局中的单例宿主通过 URL 驱动，面板只处理详情与权限。
//
// 保存带回载入时拿到的 expectedUpdatedAt，由服务端在事务内锁行比对（定稿 §9.1）；
// CONFLICT 时保留当前输入；用户明确放弃字段修改后才重新取数。

export type PanelOption = { id: string; name: string };

/**
 * D 的来源反馈（来源条目挂到任务上）。只取展示需要的字段，且时间是 ISO 串——
 * 客户端组件不该依赖服务端 lib 的行类型。
 */
export type TaskFeedbackItem = {
  id: string;
  decision: string;
  comment: string;
  milestoneTitle: string | null;
  createdAt: string;
};

/** 面板渲染所需的全部数据。data 与 error 恰有一个非空。 */
export type TaskPanelState = {
  taskId: string;
  data: TaskPanelData | null;
  error: string | null;
};

/** getTaskPanelContextAction 的返回：详情 + 表单选项 + D 的来源反馈。 */
export type TaskPanelContext = {
  panel: TaskPanelData;
  canWrite: boolean;
  members: PanelOption[];
  milestones: PanelOption[];
  allTasks: { id: string; title: string }[];
  allLabels: PanelOption[];
  feedback: TaskFeedbackItem[];
};

function textOrNull(form: FormData, key: string): string | null {
  const raw = form.get(key);
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed === "" ? null : trimmed;
}

const STATUS_LABEL: Record<TaskStatusValue, string> = {
  todo: "待办",
  doing: "进行中",
  done: "已完成",
};

export function TaskDetailPanel({
  projectId,
  taskId,
  onClose,
  onSaved,
}: {
  projectId: string;
  taskId: string;
  onClose: () => void;
  /** 服务端确认写入成功后触发，供父级刷新看板。失败与冲突都不会触发。 */
  onSaved?: () => void;
}) {
  /** 自取数结果。切换 taskId 时旧数据不再匹配，由下面的 ctx 判定作废。 */
  const [fetched, setFetched] = useState<TaskPanelContext | null>(null);
  const [fetchFailed, setFetchFailed] = useState<string | null>(null);
  /** 变化的只有它时重取（保存后、冲突后、以及手工重试）。 */
  const [nonce, setNonce] = useState(0);
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const [saving, setSaving] = useState(false);
  const dirty = useRef(false);
  const [dirtyFields, setDirtyFields] = useState(false);
  const childDrafts = useRef<Record<string, boolean>>({});
  const [formVersion, setFormVersion] = useState<string | null>(null);
  const [conflicted, setConflicted] = useState(false);
  const hasDraft = () => dirty.current || Object.values(childDrafts.current).some(Boolean);
  const discard = () => !hasDraft() || window.confirm("还有未保存的任务修改或未发送内容。确定放弃并离开？取消可继续编辑，再保存或发送。");
  const close = () => { if (!saving && discard()) { dirty.current = false; childDrafts.current = {}; onClose(); } };
  const closeLatest = useRef(close);
  useEffect(() => { closeLatest.current = close; });
  useEffect(() => installUnsavedChangesGuard(hasDraft, discard, dialogRef.current!), []);

  useEffect(() => {
    let cancelled = false;
    // 挂载与 taskId 切换都要重新鉴权取数——这是契约里写死的行为。
    getTaskPanelContextAction(projectId, taskId).then((res) => {
      if (cancelled) return;
      if (!res.ok) {
        setFetched(null);
        setFetchFailed(res.error);
        return;
      }
      setFetchFailed(null);
      setFetched(res.data);
    }).catch(() => {
      if (!cancelled) { setFetched(null); setFetchFailed("任务详情加载失败，请重试"); }
    });
    return () => {
      cancelled = true;
    };
  }, [projectId, taskId, nonce]);

  const refetch = () => setNonce((n) => n + 1);

  // 取回来的必须正是当前这个任务，否则就当还没到——切换任务的瞬间不会闪出上一个任务的详情。
  const ctx = fetched && fetched.panel.task.id === taskId ? fetched : null;
  const state: TaskPanelState = ctx
    ? { taskId, data: ctx.panel, error: null }
    : { taskId, data: null, error: fetchFailed };

  // 本地副本让保存后能立刻回显新值，不必等重新取数；服务端一到新数据就同步过来。
  const [local, setLocal] = useState(state.data);
  const [prevData, setPrevData] = useState(state.data);
  // 渲染期同步而非 useEffect：这是「props 变了就调整派生 state」的既有写法（原深链逻辑同款），
  // 放在 effect 里会多一轮渲染，也会触发 eslint 的 set-state-in-effect。
  if (state.data !== prevData) {
    setPrevData(state.data);
    setLocal(state.data);
  }

  const canWrite = ctx?.canWrite ?? false;
  const members = ctx?.members ?? [];
  const milestones = ctx?.milestones ?? [];
  const allTasks = ctx?.allTasks ?? [];
  const allLabels = ctx?.allLabels ?? [];
  const feedback = ctx?.feedback ?? [];

  const [saveError, setSaveError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [tab, setTab] = useState<"content" | "outcome">("content");
  const [split, setSplit] = useState(55);
  const splitRef = useRef<HTMLDivElement>(null);
  if (!dirtyFields && local && formVersion !== local.task.updatedAt) setFormVersion(local.task.updatedAt);
  useEffect(() => {
    const value = Number(localStorage.getItem("agilecampus-task-split"));
    // Restore a presentation preference only; no business data is stored here.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (value >= 38 && value <= 68) setSplit(value);
  }, []);
  const changeSplit = (value: number) => {
    const next = Math.round(Math.min(68, Math.max(38, value)));
    setSplit(next); localStorage.setItem("agilecampus-task-split", String(next));
  };

  // Modal keyboard focus stays in the drawer; closing restores its original entry.
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus({ preventScroll: true });
    return () => {
      document.body.style.overflow = overflow;
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || document.querySelector("dialog[open]")) return;
      if (e.key === "Escape") { e.preventDefault(); closeLatest.current(); }
      if (e.key !== "Tab") return;
      const root = dialogRef.current;
      if (!root) return;
      const items = Array.from(root.querySelectorAll<HTMLElement>(
        'button:not([disabled]),a[href],input:not([type="hidden"]):not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]'
      )).filter(el => el.tabIndex >= 0 && el.getClientRects().length > 0);
      const first = items[0], last = items.at(-1), active = document.activeElement;
      if (!first || !last) { e.preventDefault(); root.focus(); return; }
      if (!root.contains(active) || (e.shiftKey ? active === first : active === last)) {
        e.preventDefault(); (e.shiftKey ? last : first).focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const task = local?.task ?? null;

  async function handleSave(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!local) return;
    const form = new FormData(event.currentTarget);

    setSaving(true);
    setSaveError(null);
    let res: Awaited<ReturnType<typeof updateTaskV1Action>>;
    try { res = await updateTaskV1Action(projectId, taskId, {
      requestId: newRequestId(),
      // 原样回传服务端给的时间串，绝不在浏览器侧重新生成
      expectedUpdatedAt: formVersion ?? local.task.updatedAt,
      patch: {
        title: String(form.get("title") ?? "").trim(),
        description: textOrNull(form, "description"),
        acceptanceCriteria: textOrNull(form, "acceptanceCriteria"),
        completionNote: textOrNull(form, "completionNote"),
        assigneeIds: form.getAll("assigneeIds").map(String),
        milestoneId: textOrNull(form, "milestoneId"),
        status: form.get("status") as TaskStatusValue,
        priority: form.get("priority") as TaskPriorityValue,
        startDate: textOrNull(form, "startDate"),
        dueDate: textOrNull(form, "dueDate"),
      },
    }); }
    catch { setSaveError("保存结果暂时无法确认，输入已保留，请核对后重试"); return; }
    finally { setSaving(false); }

    if (!res.ok) {
      setSaveError(res.error);
      // 冲突保留草稿，暂停提交，避免自动重取覆盖当前输入。
      if (res.code === "CONFLICT") setConflicted(true);
      return;
    }
    dirty.current = false; setDirtyFields(false);
    setConflicted(false);
    setLocal((current) =>
      current ? { ...current, task: res.data.task } : current,
    );
    // 只有这里——服务端确认成功之后——才通知外部
    onSaved?.();
  }

  async function handleDelete() {
    if (!local) return;
    if (!confirm("确认删除该任务及其所有子任务？此操作不可恢复。")) return;
    setDeleting(true);
    setSaveError(null);
    let res: Awaited<ReturnType<typeof deleteTaskV1Action>>;
    try { res = await deleteTaskV1Action(projectId, taskId, {
      requestId: newRequestId(),
      expectedUpdatedAt: local.task.updatedAt,
    }); }
    catch { setSaveError("删除结果暂时无法确认，请重新打开任务核对"); return; }
    finally { setDeleting(false); }
    if (!res.ok) {
      setSaveError(res.error);
      if (res.code === "CONFLICT") refetch();
      return;
    }
    dirty.current = false; childDrafts.current = {};
    onSaved?.();
    onClose();
  }

  /** 子面板（标签/依赖）保存成功：重取自己，并让父级刷新看板上的标签与依赖计数。 */
  function handleLabelDependencySaved() {
    setSaveError(null);
    refetch();
    onSaved?.();
  }

  return (
    <div ref={dialogRef} tabIndex={-1} className="fixed inset-0 z-50 flex items-center justify-center p-6" role="dialog" aria-modal="true" aria-label="任务详情">
      <button type="button" aria-label="点击遮罩关闭任务" tabIndex={-1} onClick={close} className="fixed inset-0 cursor-default bg-ink/40 backdrop-blur-sm" />
      <div className="relative z-10 flex h-[min(880px,92vh)] w-[min(1200px,96vw)] flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-pop">
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-line px-6 py-4">
          <div className="min-w-0"><p className="text-xs text-ink-faint">任务协作</p><h3 className="truncate font-display text-lg font-semibold text-ink">{task?.title ?? "加载任务…"}</h3></div>
          <button ref={closeRef} type="button" onClick={close} aria-label="关闭" className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-ink-faint hover:bg-sunken">✕</button>
        </header>
        {state.error && <div className="p-6"><p role="alert" className="text-sm text-high">{state.error}</p><button onClick={refetch} className="ac-btn-ghost">重试</button></div>}
        {!state.error && !state.data && <p className="p-6 text-sm text-ink-faint">载入任务详情…</p>}
        {task && local && <div ref={splitRef} className="flex min-h-0 flex-1">
          <main className="min-w-0 overflow-y-auto p-6" style={{ width: `${split}%` }}>
            <nav className="mb-5 flex gap-2" aria-label="任务内容切换"><button className={tab === "content" ? "ac-btn" : "ac-btn-ghost"} onClick={() => setTab("content")}>任务内容</button><button className={tab === "outcome" ? "ac-btn" : "ac-btn-ghost"} onClick={() => setTab("outcome")}>提交成果</button></nav>
            <div hidden={tab !== "outcome"}><TaskOutcome key={taskId} projectId={projectId} taskId={taskId} title={task.title} canWrite={canWrite && local.allowedActions.edit} onDirtyChange={value => { childDrafts.current.outcome = value; }} onSaved={handleLabelDependencySaved} /></div>
            <div hidden={tab !== "content"} className="space-y-5">
              {canWrite && local.allowedActions.edit ? <form key={`fields-${formVersion}`} onChange={() => { dirty.current = true; setDirtyFields(true); }} onSubmit={handleSave} className="space-y-4"><fieldset disabled={saving} className="space-y-4">
                <Field label="标题"><input name="title" defaultValue={task.title} required maxLength={200} className="ac-field text-sm" /></Field>
                <div className="grid grid-cols-2 gap-3"><Field label="状态"><select name="status" defaultValue={task.status} className="ac-field text-sm"><option value="todo">待办</option><option value="doing">进行中</option><option value="done">已完成</option></select></Field><Field label="截止日"><input type="date" name="dueDate" defaultValue={task.dueDate ?? ""} className="ac-field text-sm" /></Field></div>
                <MemberPicker members={members} selected={task.assignees?.map(m => m.id) ?? (task.assigneeId ? [task.assigneeId] : [])} />
                <Field label="任务描述"><textarea name="description" defaultValue={task.description ?? ""} rows={3} className="ac-field text-sm" placeholder="说明需要完成的工作" /></Field>
                <details className="rounded-xl border border-line p-3"><summary className="cursor-pointer text-sm text-ink-soft">更多设置 · 阶段、优先级与完成记录</summary><div className="mt-3 space-y-3">
                  <div className="grid grid-cols-2 gap-3"><Field label="优先级"><select name="priority" defaultValue={task.priority} className="ac-field text-sm"><option value="low">低</option><option value="medium">中</option><option value="high">高</option></select></Field><Field label="起始日"><input type="date" name="startDate" defaultValue={task.startDate ?? ""} className="ac-field text-sm" /></Field></div>
                  <Field label="里程碑"><select name="milestoneId" defaultValue={task.milestoneId ?? ""} className="ac-field text-sm"><option value="">无里程碑</option>{milestones.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</select></Field>
                  <Field label="验收标准"><textarea name="acceptanceCriteria" defaultValue={task.acceptanceCriteria ?? ""} rows={2} className="ac-field text-sm" /></Field><Field label="完成记录"><textarea name="completionNote" defaultValue={task.completionNote ?? ""} rows={2} className="ac-field text-sm" /></Field>
                </div></details>
                {saveError && <p role="alert" className="text-sm text-high">{saveError}</p>}
                {conflicted && <button type="button" className="ac-btn-ghost" onClick={() => { if (window.confirm("重新载入会放弃本次任务字段修改，确定继续？")) { dirty.current = false; setDirtyFields(false); setConflicted(false); refetch(); } }}>放弃字段修改，载入最新版本</button>}
                <div className="flex justify-end"><button disabled={saving || conflicted} className="ac-btn">{saving ? "保存中…" : "保存任务"}</button></div>
              </fieldset></form> : <div className="space-y-3 text-sm"><p>{STATUS_LABEL[task.status]} · 截止 {task.dueDate ?? "未设置"}</p><p>执行成员：{task.assignees?.map(m => m.name).join("、") || task.assigneeName || "未分配"}</p><p className="whitespace-pre-wrap text-ink-soft">{task.description || "暂无描述"}</p>{task.acceptanceCriteria && <p>验收标准：{task.acceptanceCriteria}</p>}{task.completionNote && <p>完成记录：{task.completionNote}</p>}</div>}
              <TaskEnhancementSection key={`enhancements-${taskId}`} projectId={projectId} taskId={taskId} onSaved={onSaved} />
              <TaskDocumentLinks key={`docs-${taskId}`} projectId={projectId} taskId={taskId} />
              <p className="text-xs text-ink-faint">子任务 {local.subtaskProgress.doneCount}/{local.subtaskProgress.total} · 依赖 {local.dependencies.length} 条 · {task.iterationId ? "已加入迭代" : "未加入迭代"}</p>
              <details className="border-t border-line pt-3"><summary className="cursor-pointer text-sm text-ink-soft">标签、依赖与阻塞</summary><div className="mt-3 space-y-4">{local.labels.map(l => <span key={l.id} className="ac-badge mr-2">{l.name}</span>)}
                {canWrite && local.allowedActions.edit && <><BlockControl projectId={projectId} taskId={task.id} task={task} onUpdated={next => setLocal(current => current ? { ...current, task: next } : current)} onReload={() => { refetch(); onSaved?.(); }} /><LabelDependencyForm key={`associations-${task.updatedAt}`} projectId={projectId} taskId={task.id} expectedUpdatedAt={task.updatedAt} currentLabelIds={local.labels.map(l => l.id)} currentSuccessorIds={local.dependencies.filter(d => d.predecessorId === task.id).map(d => d.successorId)} allLabels={allLabels} allTasks={allTasks} onSaved={handleLabelDependencySaved} /></>}
              </div></details>
              {feedback.length > 0 && <details><summary className="text-sm">来源反馈（{feedback.length}）</summary>{feedback.map(f => <p key={f.id} className="my-2 rounded-lg bg-sunken p-3 text-sm">{f.comment}</p>)}</details>}
              {canWrite && local.allowedActions.delete && <button type="button" disabled={deleting} onClick={() => void handleDelete()} className="text-xs text-high underline">{deleting ? "删除中…" : "删除任务"}</button>}
            </div>
          </main>
          <div role="separator" tabIndex={0} aria-label="调整任务与沟通区宽度" aria-orientation="vertical" aria-valuemin={38} aria-valuemax={68} aria-valuenow={split} className="group relative z-10 flex w-3 shrink-0 cursor-col-resize touch-none items-center justify-center border-x border-line bg-sunken/40 outline-none hover:bg-primary/10 focus:bg-primary/20"
            onKeyDown={e => { if (e.key === "ArrowLeft" || e.key === "ArrowRight") { e.preventDefault(); changeSplit(split + (e.key === "ArrowLeft" ? -2 : 2)); } if (e.key === "Home") changeSplit(38); if (e.key === "End") changeSplit(68); }}
            onDoubleClick={() => changeSplit(55)}
            onPointerDown={e => { e.currentTarget.setPointerCapture(e.pointerId); }}
            onPointerMove={e => { if (!e.currentTarget.hasPointerCapture(e.pointerId) || !splitRef.current) return; const bounds = splitRef.current.getBoundingClientRect(); changeSplit((e.clientX - bounds.left) / bounds.width * 100); }}
            onPointerUp={e => { if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId); }}><span className="h-12 w-1 rounded-full bg-line group-hover:bg-primary" /></div>
          <aside className="min-w-0 flex-1 bg-sunken/20 p-5"><TaskCollaboration key={taskId} projectId={projectId} taskId={taskId} onDirtyChange={(key, value) => { childDrafts.current[key] = value; }} /></aside>
        </div>}
      </div>
    </div>
  );
}

/**
 * 阻塞 / 解除阻塞。
 *
 * 单独走 setTaskBlockedAction 而不是塞进上面的保存表单：这三个字段在服务层是「一起写」的，
 * 混进通用 patch 会让「改了状态顺手把阻塞也清了」这种事变得可能。所以刻意分成两个动作。
 */
function BlockControl({
  projectId,
  taskId,
  task,
  onUpdated,
  onReload,
}: {
  projectId: string;
  taskId: string;
  task: TaskSummary;
  onUpdated: (task: TaskSummary) => void;
  onReload: () => void;
}) {
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(blocked: boolean) {
    setPending(true);
    setError(null);
    let res: Awaited<ReturnType<typeof setTaskBlockedAction>>;
    try { res = await setTaskBlockedAction(projectId, taskId, {
      requestId: newRequestId(),
      expectedUpdatedAt: task.updatedAt,
      isBlocked: blocked,
      blockedReason: blocked ? reason : null,
    }); }
    catch { setError("阻塞状态保存未确认，请核对后重试"); return; }
    finally { setPending(false); }
    if (!res.ok) {
      setError(res.error);
      if (res.code === "CONFLICT") onReload();
      return;
    }
    setReason("");
    onUpdated(res.data.task);
    onReload();
  }

  if (task.isBlocked) {
    return (
      <div className="space-y-2 border-t border-line pt-4">
        <p className="text-xs font-medium text-ink-soft">已阻塞</p>
        <p className="text-sm text-ink">{task.blockedReason}</p>
        <p className="text-xs text-ink-faint">
          自 {task.blockedAt?.slice(0, 10) ?? "—"}
        </p>
        {error && <p role="alert" className="text-sm text-high">{error}</p>}
        <button
          type="button"
          disabled={pending}
          onClick={() => void submit(false)}
          className="ac-btn-ghost text-sm"
        >
          {pending ? "处理中…" : "解除阻塞"}
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-2 border-t border-line pt-4">
      <Field label="标记阻塞">
        <input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="被什么卡住了（必填）"
          className="ac-field text-sm"
        />
      </Field>
      {error && <p role="alert" className="text-sm text-high">{error}</p>}
      <button
        type="button"
        disabled={pending || reason.trim() === ""}
        onClick={() => void submit(true)}
        className="ac-btn-ghost text-sm"
      >
        {pending ? "处理中…" : "标记为阻塞"}
      </button>
    </div>
  );
}

/**
 * Save only associations, with one transaction and the task's original version.
 */
function LabelDependencyForm({
  projectId,
  taskId,
  expectedUpdatedAt,
  currentLabelIds,
  currentSuccessorIds,
  allLabels,
  allTasks,
  onSaved,
}: {
  projectId: string;
  taskId: string;
  expectedUpdatedAt: string;
  currentLabelIds: string[];
  currentSuccessorIds: string[];
  allLabels: PanelOption[];
  allTasks: { id: string; title: string }[];
  onSaved: () => void;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(newRequestId());

  return (
    <form className="space-y-2.5 border-t border-line pt-4"
      onChange={() => { requestId.current = newRequestId(); }}
      onSubmit={async event => {
        event.preventDefault();
        if (pending) return;
        const form = new FormData(event.currentTarget);
        setPending(true); setError(null);
        try {
          const result = await saveTaskAssociationsAction(projectId, taskId, {
            requestId: requestId.current, expectedUpdatedAt,
            labelIds: form.getAll("labelIds").map(String),
            successorIds: form.getAll("successorIds").map(String),
          });
          if (!result.ok) { setError(result.error); return; }
          onSaved();
        } catch { setError("标签与依赖保存未确认，选择已保留，请核对后重试"); }
        finally { setPending(false); }
      }}>

      {allLabels.length > 0 && (
        <Field label="标签（可多选）">
          <select
            multiple
            disabled={pending}
            name="labelIds"
            defaultValue={currentLabelIds}
            className="ac-field text-sm"
            size={Math.min(4, Math.max(2, allLabels.length))}
          >
            {allLabels.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </Field>
      )}

      <Field label="后置任务（可多选）">
        <select
          multiple
          disabled={pending}
          name="successorIds"
          defaultValue={currentSuccessorIds}
          className="ac-field text-sm"
          size={Math.min(4, Math.max(2, Math.max(allTasks.length - 1, 2)))}
        >
          {allTasks
            .filter((t) => t.id !== taskId)
            .map((t) => (
              <option key={t.id} value={t.id}>
                {t.title}
              </option>
            ))}
        </select>
      </Field>

      {error && <p role="alert" className="text-sm text-high">{error}</p>}

      <div className="flex justify-end">
        <button disabled={pending} className="ac-btn-ghost text-sm">
          {pending ? "保存中…" : "保存标签与依赖"}
        </button>
      </div>
    </form>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-medium text-ink-soft">{label}</span>
      {children}
    </label>
  );
}
