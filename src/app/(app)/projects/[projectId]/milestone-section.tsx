"use client";

import { useActionState, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  previewMilestoneDeletionAction,
  deleteMilestoneAction,
} from "./milestone-actions";
import { createMilestoneAction, type FormState } from "./actions";

type Milestone = {
  id: string;
  title: string;
  targetDate: string | null;
  status: string;
};

export function MilestoneSection({
  projectId,
  milestones,
  isAdmin,
  compact = false,
}: {
  projectId: string;
  milestones: Milestone[];
  isAdmin: boolean;
  compact?: boolean;
}) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(
    createMilestoneAction,
    null,
  );
  const [deleting, startDelete] = useTransition();
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const router = useRouter();
  function remove(id: string) {
    startDelete(async () => {
      setDeleteError(null);
      const preview = await previewMilestoneDeletionAction(projectId, id);
      if (!preview.ok) {
        setDeleteError(preview.error);
        return;
      }
      if (
        !confirm(
          `删除「${preview.data.expected.title}」？关联的 ${preview.data.taskCount} 个任务和 ${preview.data.deliverableCount} 项成果将保留，仅取消阶段关联。已提交版本和教师反馈历史保留。`,
        )
      )
        return;
      const result = await deleteMilestoneAction(projectId, id, {
        requestId: crypto.randomUUID(),
        expected: preview.data.expected,
      });
      if (!result.ok) setDeleteError(result.error);
      else router.refresh();
    });
  }

  const content = (
    <section className="space-y-2" data-tour="milestones">
      <h2 className="font-medium text-ink">里程碑</h2>
      <ul className="flex flex-wrap gap-2">
        {milestones.map((m) => (
          <li key={m.id} className="ac-card px-3 py-1.5 text-sm text-ink">
            {m.title}
            {m.targetDate && (
              <span className="ml-1 text-xs text-ink-faint">
                {m.targetDate}
              </span>
            )}
            <span className="ml-1 text-xs text-ink-soft">
              [{m.status === "done" ? "已完成" : "未完成"}]
            </span>
            {isAdmin && (
              <button
                type="button"
                disabled={deleting}
                onClick={() => remove(m.id)}
                aria-label={`删除里程碑 ${m.title}`}
                className="ml-3 text-xs text-high hover:underline disabled:opacity-50"
              >
                删除
              </button>
            )}
          </li>
        ))}
        {milestones.length === 0 && (
          <li className="text-sm text-ink-soft">暂无里程碑。</li>
        )}
      </ul>
      {deleteError && (
        <p role="alert" className="text-sm text-high">
          {deleteError}
        </p>
      )}
      {isAdmin && (
        <form action={formAction} className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="projectId" value={projectId} />
          <input
            name="title"
            placeholder="里程碑标题"
            className="ac-field min-w-0 flex-1 text-sm"
          />
          <input
            type="date"
            name="targetDate"
            className="ac-field w-auto text-sm"
          />
          <button disabled={pending} className="ac-btn px-3 py-2 text-sm">
            添加
          </button>
          {state?.error && <p className="text-sm text-high">{state.error}</p>}
        </form>
      )}
    </section>
  );
  return compact ? <details className="project-milestone-strip"><summary><span className="text-ink-faint">里程碑</span>{milestones.slice(0, 4).map(m => <span key={m.id} title={m.title}>{m.status === "done" ? "✓ " : ""}{m.title}</span>)}<span className="ml-auto text-primary">全部 {milestones.length} 个 ▾</span></summary><div className="project-milestone-expanded">{content}</div></details> : content;
}
