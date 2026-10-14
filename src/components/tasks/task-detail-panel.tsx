"use client";

import { useEffect, useRef, useState } from "react";
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
import { TaskComments } from "@/components/task-comments";
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
// CONFLICT 时如实提示并**自己重取**，绝不假装保存成功。

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

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

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
      if (e.key === "Escape") { e.preventDefault(); onClose(); }
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
      expectedUpdatedAt: local.task.updatedAt,
      patch: {
        title: String(form.get("title") ?? "").trim(),
        description: textOrNull(form, "description"),
        acceptanceCriteria: textOrNull(form, "acceptanceCriteria"),
        completionNote: textOrNull(form, "completionNote"),
        assigneeId: textOrNull(form, "assigneeId"),
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
      // 版本对不上说明别人先改了：拉一份最新的，别让用户对着旧数据继续改
      if (res.code === "CONFLICT") refetch();
      return;
    }
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
    <div
      ref={dialogRef}
      tabIndex={-1}
      className="fixed inset-0 z-50 flex justify-end"
      role="dialog"
      aria-modal="true"
      aria-label="任务详情"
    >
      <button
        type="button"
        aria-label="关闭"
        tabIndex={-1}
        onClick={onClose}
        className="fixed inset-0 cursor-default bg-ink/40 backdrop-blur-sm"
      />
      <aside className="relative z-10 flex h-full w-full max-w-md flex-col overflow-y-auto border-l border-line bg-surface p-5 shadow-pop">
        <header className="mb-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs text-ink-faint">任务详情</p>
            <h3 className="break-words font-display text-base font-semibold text-ink">
              {task?.title ?? "任务"}
            </h3>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="关闭"
            className="grid h-7 w-7 shrink-0 place-items-center rounded-field text-ink-faint hover:bg-sunken hover:text-ink"
          >
            ✕
          </button>
        </header>

        {state.error && (
          <div className="space-y-2">
            <p role="alert" className="text-sm text-high">{state.error}</p>
            <button
              type="button"
              onClick={refetch}
              className="ac-btn-ghost text-sm"
            >
              重试
            </button>
          </div>
        )}

        {!state.error && !state.data && (
          <p className="text-sm text-ink-faint">载入任务详情…</p>
        )}

        {task && local && (
          <div className="space-y-5">
            <TaskEnhancementSection key={`enhancements-${taskId}`} projectId={projectId} taskId={taskId} onSaved={onSaved} />
            <TaskDocumentLinks key={`docs-${taskId}`} projectId={projectId} taskId={taskId} />
            <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
              <Meta label="状态" value={STATUS_LABEL[task.status]} />
              <Meta label="优先级" value={task.priority} />
              <Meta label="负责人" value={task.assigneeName ?? "未分配"} />
              <Meta
                label="所属迭代"
                value={task.iterationId ? "已入轮" : "未入轮"}
              />
              <Meta label="起始日" value={task.startDate ?? "—"} />
              <Meta label="截止日" value={task.dueDate ?? "—"} />
            </dl>

            {local.labels.length > 0 && (
              <div className="flex flex-wrap items-center gap-1">
                {local.labels.map((l) => (
                  <span
                    key={l.id}
                    className="ac-badge bg-surface text-ink-soft"
                  >
                    {l.name}
                  </span>
                ))}
              </div>
            )}

            <p className="text-xs text-ink-faint">
              子任务 {local.subtaskProgress.doneCount}/
              {local.subtaskProgress.total}
              {local.subtaskProgress.ratio !== null &&
                ` · ${Math.round(local.subtaskProgress.ratio * 100)}%`}
              {" · "}依赖 {local.dependencies.length} 条
            </p>

            {canWrite && local.allowedActions.edit ? (
              <form
                // 服务端每次回来的 updatedAt 都不同：用它当 key，冲突刷新后表单会重挂载，
                // 输入框回到最新值，而不是留着用户手里那份过期内容。
                key={`fields-${task.updatedAt}`}
                onSubmit={handleSave}
                className="space-y-2.5 border-t border-line pt-4"
              >
                <Field label="标题">
                  <input
                    name="title"
                    defaultValue={task.title}
                    required
                    className="ac-field text-sm"
                  />
                </Field>
                <Field label="描述">
                  <textarea
                    name="description"
                    defaultValue={task.description ?? ""}
                    rows={2}
                    className="ac-field text-sm"
                    placeholder="任务描述"
                  />
                </Field>
                <Field label="验收标准">
                  <textarea
                    name="acceptanceCriteria"
                    defaultValue={task.acceptanceCriteria ?? ""}
                    rows={3}
                    className="ac-field text-sm"
                    placeholder="做到什么程度算完成"
                  />
                </Field>
                <Field label="完成情况（完成时填写）">
                  <textarea
                    name="completionNote"
                    defaultValue={task.completionNote ?? ""}
                    rows={2}
                    className="ac-field text-sm"
                    placeholder="完成说明"
                  />
                </Field>

                <div className="grid grid-cols-2 gap-2.5">
                  <Field label="状态">
                    <select
                      name="status"
                      defaultValue={task.status}
                      className="ac-field text-sm"
                    >
                      <option value="todo">待办</option>
                      <option value="doing">进行中</option>
                      <option value="done">已完成</option>
                    </select>
                  </Field>
                  <Field label="优先级">
                    <select
                      name="priority"
                      defaultValue={task.priority}
                      className="ac-field text-sm"
                    >
                      <option value="low">低</option>
                      <option value="medium">中</option>
                      <option value="high">高</option>
                    </select>
                  </Field>
                  <Field label="负责人">
                    <select
                      name="assigneeId"
                      defaultValue={task.assigneeId ?? ""}
                      className="ac-field text-sm"
                    >
                      <option value="">未分配</option>
                      {members.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="里程碑">
                    <select
                      name="milestoneId"
                      defaultValue={task.milestoneId ?? ""}
                      className="ac-field text-sm"
                    >
                      <option value="">无里程碑</option>
                      {milestones.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="起始日">
                    <input
                      type="date"
                      name="startDate"
                      defaultValue={task.startDate ?? ""}
                      className="ac-field text-sm"
                    />
                  </Field>
                  <Field label="截止日">
                    <input
                      type="date"
                      name="dueDate"
                      defaultValue={task.dueDate ?? ""}
                      className="ac-field text-sm"
                    />
                  </Field>
                </div>

                {saveError && <p role="alert" className="text-sm text-high">{saveError}</p>}

                <div className="flex items-center justify-end gap-2 pt-1">
                  <button
                    type="button"
                    onClick={onClose}
                    className="ac-btn-ghost"
                  >
                    关闭
                  </button>
                  <button disabled={saving} className="ac-btn">
                    {saving ? "保存中…" : "保存"}
                  </button>
                </div>
              </form>
            ) : (
              <div className="space-y-2 border-t border-line pt-4 text-sm">
                <p className="whitespace-pre-wrap text-ink-soft">
                  {task.description ?? "（无描述）"}
                </p>
                {task.acceptanceCriteria && (
                  <p className="text-xs text-ink-soft">
                    验收标准：{task.acceptanceCriteria}
                  </p>
                )}
                {!canWrite && (
                  <p className="text-xs text-ink-faint">
                    你的角色只能查看任务。
                  </p>
                )}
              </div>
            )}

            {canWrite && local.allowedActions.edit && (
              <BlockControl
                projectId={projectId}
                taskId={task.id}
                task={task}
                onUpdated={(next) =>
                  setLocal((current) =>
                    current ? { ...current, task: next } : current,
                  )
                }
                onReload={() => {
                  refetch();
                  // 阻塞状态看板卡片上要看得到，所以顺带请父级刷新
                  onSaved?.();
                }}
              />
            )}

            {feedback.length > 0 && (
              <div className="space-y-2 border-t border-line pt-4">
                <p className="text-xs font-medium text-ink-soft">来源反馈</p>
                {feedback.map((f) => (
                  <div key={f.id} className="rounded-field bg-sunken p-2.5">
                    <p className="text-xs text-ink-faint">
                      {f.milestoneTitle ?? "成果反馈"} ·{" "}
                      {f.decision === "changes_requested" ? "退回修改" : "通过"}{" "}
                      · {f.createdAt.slice(0, 10)}
                    </p>
                    <p className="mt-1 whitespace-pre-wrap text-sm text-ink-soft">
                      {f.comment}
                    </p>
                  </div>
                ))}
              </div>
            )}

            {canWrite && local.allowedActions.edit && (
              <LabelDependencyForm
                key={`associations-${task.updatedAt}`}
                projectId={projectId}
                taskId={task.id}
                expectedUpdatedAt={task.updatedAt}
                currentLabelIds={local.labels.map((l) => l.id)}
                currentSuccessorIds={local.dependencies
                  .filter((d) => d.predecessorId === task.id)
                  .map((d) => d.successorId)}
                allLabels={allLabels}
                allTasks={allTasks}
                onSaved={handleLabelDependencySaved}
              />
            )}

            <TaskComments key={`comments-${taskId}`} projectId={projectId} taskId={taskId} />

            {canWrite && local.allowedActions.delete && (
              <div className="border-t border-line pt-3">
                <button
                  type="button"
                  disabled={deleting}
                  onClick={() => void handleDelete()}
                  className="text-xs text-high underline disabled:opacity-50"
                >
                  {deleting ? "删除中…" : "删除任务"}
                </button>
              </div>
            )}
          </div>
        )}
      </aside>
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

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-ink-faint">{label}</dt>
      <dd className="text-ink">{value}</dd>
    </div>
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
