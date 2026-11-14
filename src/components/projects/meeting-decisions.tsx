"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Plus } from "lucide-react";
import type { MeetingDecision } from "@/lib/meeting-decisions";
import {
  saveMeetingDecisionAction,
  confirmMeetingDecisionAction,
  removeMeetingDecisionAction,
} from "@/app/(app)/projects/[projectId]/references/decision-actions";
import { newRequestId } from "@/lib/request-id";

function timeLabel(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

function ConfirmationRows({
  version,
  onConfirm,
  pending,
}: {
  version: MeetingDecision["versions"][number];
  onConfirm?: () => void;
  pending: boolean;
}) {
  return (
    <ul className="divide-y divide-line text-sm">
      {version.confirmations.map((item) => (
        <li
          key={item.userId}
          className="flex flex-wrap items-center gap-3 py-2"
        >
          <span className="min-w-24">{item.name}</span>
          <span className={item.confirmedAt ? "text-done" : "text-accent"}>
            {item.confirmedAt
              ? "已确认"
              : item.active
                ? "待确认"
                : "已离队，需调整名单"}
          </span>
          {item.confirmedAt && (
            <time className="text-xs text-ink-soft" dateTime={item.confirmedAt}>
              {timeLabel(item.confirmedAt)}
            </time>
          )}
          {item.canConfirm && onConfirm && (
            <button
              type="button"
              className="ac-btn ml-auto text-xs"
              disabled={pending}
              onClick={onConfirm}
            >
              <Check aria-hidden size={14} />
              确认本版方案
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}

function DecisionForm({
  projectId,
  referenceId,
  members,
  decision,
  onClose,
  onSaved,
}: {
  projectId: string;
  referenceId: string;
  members: { id: string; name: string }[];
  decision?: MeetingDecision;
  onClose: () => void;
  onSaved: () => void;
}) {
  const router = useRouter();
  const current = decision?.versions[0];
  const requestId = useRef("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  return (
    <form
      className="space-y-3 rounded-field bg-sunken/50 p-3"
      onChange={() => {
        requestId.current = "";
      }}
      onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        requestId.current ||= newRequestId();
        const input = {
          requestId: requestId.current,
          title: String(form.get("title")),
          adoptedOption: String(form.get("adoptedOption")),
          background: String(form.get("background") ?? ""),
          confirmerIds: form.getAll("confirmerIds").map(String),
          ...(decision
            ? { decisionId: decision.id, expectedRevision: decision.revision }
            : {}),
        };
        startTransition(async () => {
          setError("");
          try {
            const result = await saveMeetingDecisionAction(
              projectId,
              referenceId,
              input,
            );
            if (!result.ok) {
              setError(result.error);
              return;
            }
            onSaved();
          } catch {
            setError("保存结果暂时无法确认，请重试或刷新核对");
          }
        });
      }}
    >
      <fieldset disabled={pending} className="space-y-3">
        <label className="block space-y-1 text-sm">
          <span>决策主题</span>
          <input
            className="ac-field"
            name="title"
            required
            maxLength={140}
            defaultValue={current?.title}
            placeholder="例如：展示方案确认"
          />
        </label>
        <label className="block space-y-1 text-sm">
          <span>采用方案</span>
          <textarea
            className="ac-field"
            name="adoptedOption"
            required
            maxLength={2000}
            rows={2}
            defaultValue={current?.adoptedOption}
          />
        </label>
        <fieldset className="space-y-2">
          <legend className="text-sm">请谁确认</legend>
          <div className="flex flex-wrap gap-x-4 gap-y-2">
            {members.map((member) => (
              <label
                key={member.id}
                className="flex items-center gap-2 text-sm"
              >
                <input
                  type="checkbox"
                  name="confirmerIds"
                  value={member.id}
                  defaultChecked={current?.confirmations.some(
                    (item) => item.userId === member.id,
                  )}
                />
                {member.name}
              </label>
            ))}
          </div>
        </fieldset>
        <details>
          <summary className="cursor-pointer text-sm text-ink-soft">
            背景与取舍理由（选填）
          </summary>
          <textarea
            aria-label="背景与取舍理由"
            name="background"
            className="ac-field mt-2"
            maxLength={5000}
            rows={3}
            defaultValue={current?.background}
          />
        </details>
        {decision && (
          <p className="text-xs text-ink-soft">
            内容或确认名单变更后，将生成新版本并重新确认。
          </p>
        )}
        {error && (
          <p role="alert" className="text-sm text-high">
            {error}{" "}
            <button
              type="button"
              className="text-primary underline"
              onClick={() => {
                onClose();
                router.refresh();
              }}
            >
              重新载入
            </button>
          </p>
        )}
        <div className="flex justify-end gap-3">
          <button type="button" className="ac-btn-ghost" onClick={onClose}>
            取消
          </button>
          <button className="ac-btn">
            {pending ? "保存中…" : "保存方案并请成员确认"}
          </button>
        </div>
      </fieldset>
    </form>
  );
}

export function MeetingDecisions({
  projectId,
  referenceId,
  items,
  members,
  canCreate,
}: {
  projectId: string;
  referenceId: string;
  items: MeetingDecision[];
  members: { id: string; name: string }[];
  canCreate: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [pending, startTransition] = useTransition();
  const requestIds = useRef<Record<string, string>>({});
  function refresh() {
    router.refresh();
  }
  function mutate(item: MeetingDecision, operation: "confirm" | "remove") {
    const key = `${operation}:${item.id}:${item.revision}`;
    requestIds.current[key] ||= newRequestId();
    const input = {
      requestId: requestIds.current[key],
      decisionId: item.id,
      expectedRevision: item.revision,
    };
    startTransition(async () => {
      setError("");
      setNotice("");
      try {
        const action =
          operation === "confirm"
            ? confirmMeetingDecisionAction
            : removeMeetingDecisionAction;
        const result = await action(projectId, referenceId, input);
        if (!result.ok) {
          setError(result.error);
          return;
        }
        setNotice(
          operation === "confirm" ? "已确认当前版本方案" : "已移除决策记录",
        );
        refresh();
      } catch {
        setError("操作结果暂时无法确认，请重试或刷新核对");
      }
    });
  }
  return (
    <section
      className="space-y-3 border-t border-line pt-3"
      aria-label="会议决策记录"
    >
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-medium">
          决策记录{" "}
          <span className="ml-1 font-normal text-ink-soft">{items.length}</span>
        </h3>
        {canCreate && editing === null && (
          <button
            type="button"
            className="inline-flex items-center gap-1 text-sm text-primary"
            onClick={() => setEditing("new")}
          >
            <Plus aria-hidden size={14} />
            记录决策
          </button>
        )}
      </div>
      {editing === "new" && (
        <DecisionForm
          projectId={projectId}
          referenceId={referenceId}
          members={members}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            setNotice("已保存方案，请所选成员确认");
            refresh();
          }}
        />
      )}
      {items.map((item) => {
        const version = item.versions[0];
        const confirmed = version.confirmations.filter(
          (response) => response.confirmedAt,
        ).length;
        const complete = confirmed === version.confirmations.length;
        return (
          <article
            key={item.id}
            className="space-y-3 rounded-field border border-line p-3"
            aria-label={`决策：${version.title}`}
          >
            {editing === item.id ? (
              <DecisionForm
                key={`${item.id}:${item.revision}`}
                projectId={projectId}
                referenceId={referenceId}
                members={members}
                decision={item}
                onClose={() => setEditing(null)}
                onSaved={() => {
                  setEditing(null);
                  setNotice("已保存新版本，请成员重新确认");
                  refresh();
                }}
              />
            ) : (
              <>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h4 className="font-medium">{version.title}</h4>
                  <span
                    className={`text-xs ${complete ? "text-done" : "text-accent"}`}
                  >
                    {complete
                      ? "已确认"
                      : item.revision > 1
                        ? "待重新确认"
                        : "待确认"}{" "}
                    {confirmed}/{version.confirmations.length}
                  </span>
                </div>
                <p className="whitespace-pre-wrap break-words text-sm">
                  <span className="font-medium">采用方案　</span>
                  {version.adoptedOption}
                </p>
                {version.background && (
                  <details className="text-sm">
                    <summary className="cursor-pointer text-ink-soft">
                      背景与取舍理由
                    </summary>
                    <p className="mt-2 whitespace-pre-wrap break-words">
                      {version.background}
                    </p>
                  </details>
                )}
                <p className="text-xs text-ink-soft">
                  记录人 {item.creatorName} · 第 {version.revision} 版 ·{" "}
                  {timeLabel(version.createdAt)}
                </p>
                <ConfirmationRows
                  version={version}
                  onConfirm={() => mutate(item, "confirm")}
                  pending={pending}
                />
                <div className="flex flex-wrap items-center gap-3 text-xs text-ink-soft">
                  <span>更改采用方案后需重新确认。</span>
                  {item.canManage && (
                    <>
                      <button
                        type="button"
                        disabled={pending}
                        className="ml-auto text-primary"
                        onClick={() => setEditing(item.id)}
                      >
                        编辑方案
                      </button>
                      <button
                        type="button"
                        disabled={pending}
                        className="hover:text-high"
                        onClick={() => {
                          if (window.confirm("移除这条决策记录？"))
                            mutate(item, "remove");
                        }}
                      >
                        移除
                      </button>
                    </>
                  )}
                </div>
              </>
            )}
            {item.versions.length > 1 && (
              <details className="border-t border-line pt-2 text-sm">
                <summary className="cursor-pointer text-primary">
                  历史版本（{item.versions.length - 1}）
                </summary>
                <ol className="mt-3 space-y-4">
                  {item.versions.slice(1).map((previous) => (
                    <li key={previous.id} className="space-y-2">
                      <h5 className="font-medium">
                        第 {previous.revision} 版 · {previous.title}
                      </h5>
                      <p className="whitespace-pre-wrap break-words">
                        {previous.adoptedOption}
                      </p>
                      {previous.background && (
                        <details>
                          <summary className="cursor-pointer text-ink-soft">
                            背景与取舍理由
                          </summary>
                          <p className="mt-2 whitespace-pre-wrap break-words">
                            {previous.background}
                          </p>
                        </details>
                      )}
                      <p className="text-xs text-ink-soft">
                        {timeLabel(previous.createdAt)}
                      </p>
                      <ConfirmationRows version={previous} pending={false} />
                    </li>
                  ))}
                </ol>
              </details>
            )}
          </article>
        );
      })}
      {!items.length && editing !== "new" && (
        <p className="text-xs text-ink-soft">
          记录最终方案，并请相关成员确认。
        </p>
      )}
      {notice && (
        <p role="status" className="text-sm text-done">
          {notice}
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-high">
          {error}{" "}
          <button
            type="button"
            className="text-primary underline"
            onClick={() => {
              setError("");
              refresh();
            }}
          >
            刷新决策记录
          </button>
        </p>
      )}
    </section>
  );
}
