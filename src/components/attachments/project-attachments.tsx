"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  TaskMaterialList,
  type MaterialFile,
  type TaskMaterialControls,
} from "@/components/tasks/task-material-list";
import type { MaterialPurpose } from "@/lib/material-purpose";

type Item = MaterialFile;
type Props = {
  projectId: string;
  targetType: "project" | "task" | "document" | "deliverable";
  targetId: string;
  canUpload: boolean;
  onUploaded?: (item: Item) => void;
  onChanged?: () => void;
  taskMaterials?: TaskMaterialControls;
};

export function ProjectAttachments({
  projectId,
  targetType,
  targetId,
  canUpload,
  onUploaded,
  onChanged,
  taskMaterials,
}: Props) {
  const [items, setItems] = useState<Item[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<Item | null>(null);
  const [notice, setNotice] = useState("");
  const [retryFile, setRetryFile] = useState<File | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const requestId = useRef("");
  const purposeRequests = useRef<Record<string, string>>({});
  const loadVersion = useRef(0);
  const section = useRef<HTMLElement>(null);
  const search = useSearchParams();
  const focusMaterials =
    Boolean(taskMaterials) && search.get("taskSection") === "materials";
  useEffect(() => {
    if (!focusMaterials) return;
    const frame = requestAnimationFrame(() => {
      section.current?.scrollIntoView({ block: "start" });
      section.current?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [focusMaterials]);
  const load = useCallback(async () => {
    const version = ++loadVersion.current;
    const response = await fetch(
      `/api/attachments?${new URLSearchParams({ projectId, targetType, targetId })}`,
      { cache: "no-store" },
    );
    const result = await response.json();
    if (!response.ok) throw Error(result.error);
    if (version === loadVersion.current) setItems(result);
  }, [projectId, targetType, targetId]);

  useEffect(() => {
    let active = true;
    const timer = setTimeout(
      () =>
        void load().catch((error) => {
          if (active) setError(error.message);
        }),
      0,
    );
    const refresh = () => void load().catch(() => {});
    window.addEventListener("agilecampus-attachments-updated", refresh);
    return () => {
      active = false;
      clearTimeout(timer);
      window.removeEventListener("agilecampus-attachments-updated", refresh);
    };
  }, [load]);

  function changed() {
    window.dispatchEvent(new Event("agilecampus-attachments-updated"));
    onChanged?.();
  }

  async function upload(file: File) {
    setError("");
    setNotice("");
    if (file.size > 20 * 1048576) {
      setError("单个附件不能超过20 MB");
      return;
    }
    setBusy(true);
    const data = new FormData();
    requestId.current ||= crypto.randomUUID();
    for (const [key, value] of Object.entries({
      projectId,
      targetType,
      targetId,
      requestId: requestId.current,
    }))
      data.set(key, value);
    data.set("file", file);
    try {
      const response = await fetch("/api/attachments", {
        method: "POST",
        body: data,
      });
      const result = await response.json();
      if (!response.ok) throw Error(result.error);
      setItems((current) => [
        result,
        ...current.filter((item) => item.id !== result.id),
      ]);
      requestId.current = "";
      if (input.current) input.current.value = "";
      setRetryFile(null);
      setNotice("上传完成");
      changed();
      onUploaded?.(result);
    } catch (error) {
      setRetryFile(file);
      setError(error instanceof Error ? error.message : "上传失败，可重试");
    } finally {
      setBusy(false);
    }
  }

  async function remove(item: Item) {
    if (!window.confirm(`删除附件「${item.filename}」？`)) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch(item.href, { method: "DELETE" });
      if (!response.ok) throw Error((await response.json()).error);
      setItems((current) => current.filter((file) => file.id !== item.id));
      changed();
      setNotice("已删除附件");
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "删除结果暂时无法确认，请重新加载核对",
      );
    } finally {
      setBusy(false);
    }
  }

  async function classify(item: Item, materialPurpose: MaterialPurpose | null) {
    const key = `${item.id}:${item.revision}:${materialPurpose}`;
    purposeRequests.current[key] ||= crypto.randomUUID();
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch(item.href, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          materialPurpose,
          expectedRevision: item.revision,
          requestId: purposeRequests.current[key],
        }),
      });
      const result = await response.json();
      if (!response.ok) throw Error(result.error);
      setItems((current) =>
        current.map((file) => (file.id === item.id ? result : file)),
      );
      changed();
      setNotice("材料用途已更新");
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "保存结果暂时无法确认，请重新加载核对",
      );
    } finally {
      setBusy(false);
    }
  }

  const count = items.length + (taskMaterials?.materials.length ?? 0);
  const disabled = busy || taskMaterials?.pending;
  return (
    <section
      ref={section}
      id={taskMaterials ? "task-delivery-materials" : undefined}
      tabIndex={taskMaterials ? -1 : undefined}
      className={
        taskMaterials
          ? "scroll-mt-4 space-y-3 border-t border-line pt-4 outline-none"
          : "space-y-3 rounded-xl border border-line p-4"
      }
      aria-label={taskMaterials ? "交付材料" : "附件"}
    >
      <div className="flex items-center justify-between gap-3">
        <h3 className="font-medium">
          {taskMaterials ? "交付材料" : "附件"}
          {count > 0 && (
            <span className="ml-2 text-sm font-normal text-ink-soft">
              {count}
            </span>
          )}
        </h3>
        {canUpload && (
          <label
            className={`ac-btn-ghost ${disabled ? "opacity-50" : "cursor-pointer"}`}
          >
            {busy ? "处理中…" : "上传文件"}
            <input
              ref={input}
              type="file"
              className="sr-only"
              aria-label="上传附件"
              disabled={disabled}
              accept=".png,.jpg,.jpeg,.gif,.webp,.pdf,.ppt,.pptx,.doc,.docx,.xls,.xlsx,.txt,.md,.csv,.zip"
              onChange={(event) => {
                requestId.current = "";
                const file = event.target.files?.[0];
                if (file) void upload(file);
              }}
            />
          </label>
        )}
      </div>
      {canUpload && (
        <p className="text-xs text-ink-soft">
          {taskMaterials
            ? "文件用途自动识别，可调整。单个不超过20 MB。"
            : "图片、PDF、PPT、Word、Excel、文本或 ZIP，单个不超过20 MB。附件沿用当前内容的访问权限。"}
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-high">
          {error}{" "}
          <button
            type="button"
            className="underline"
            onClick={() =>
              void load()
                .then(() => setError(""))
                .catch((error) => setError(error.message))
            }
          >
            重新加载
          </button>
          {retryFile && (
            <button
              type="button"
              className="ml-3 underline"
              disabled={disabled}
              onClick={() => void upload(retryFile)}
            >
              重试上传
            </button>
          )}
        </p>
      )}
      {notice && (
        <p role="status" className="text-xs text-primary">
          {notice}
        </p>
      )}
      {taskMaterials ? (
        <TaskMaterialList
          files={items}
          links={taskMaterials}
          busy={busy}
          onPreview={setPreview}
          onDelete={(item) => void remove(item)}
          onClassify={(item, purpose) => void classify(item, purpose)}
        />
      ) : (
        <>
          {!items.length && !error && (
            <p className="text-sm text-ink-faint">暂无附件</p>
          )}
          {items.map((item) => (
            <div
              key={item.id}
              className="flex items-center gap-3 border-t border-line pt-3"
            >
              <div className="min-w-0 flex-1">
                <a
                  className="block truncate text-sm text-primary"
                  href={item.href + "?download=1"}
                >
                  {item.filename}
                </a>
                <span className="text-xs text-ink-faint">
                  {(item.size / 1048576).toFixed(2)} MB
                </span>
              </div>
              <div className="flex gap-3 text-xs">
                {(item.mediaType.startsWith("image/") ||
                  item.mediaType === "application/pdf") && (
                  <button type="button" onClick={() => setPreview(item)}>
                    预览
                  </button>
                )}
                <a href={item.href + "?download=1"}>下载</a>
                <button
                  type="button"
                  onClick={() =>
                    void navigator.clipboard
                      .writeText(new URL(item.href, location.origin).href)
                      .then(() => setNotice("已复制附件链接；打开仍需相应权限"))
                      .catch(() => setError("复制失败，请使用下载入口"))
                  }
                >
                  复制链接
                </button>
                {item.canDelete && (
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => void remove(item)}
                  >
                    删除
                  </button>
                )}
              </div>
            </div>
          ))}
        </>
      )}
      {preview && (
        <div
          className="fixed inset-0 z-[95] flex items-center justify-center bg-black/50 p-8"
          role="dialog"
          aria-modal="true"
          aria-label={`预览${preview.filename}`}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.stopPropagation();
              setPreview(null);
            }
          }}
        >
          <div className="flex h-[85vh] w-[min(1100px,90vw)] flex-col rounded-xl bg-surface p-4">
            <div className="mb-3 flex justify-between">
              <strong className="truncate">{preview.filename}</strong>
              <button type="button" autoFocus onClick={() => setPreview(null)}>
                关闭预览
              </button>
            </div>
            {preview.mediaType === "application/pdf" ? (
              <iframe
                title={preview.filename}
                src={preview.href}
                className="min-h-0 flex-1 rounded border border-line"
              />
            ) : (
              <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto">
                <img
                  src={preview.href}
                  alt={preview.filename}
                  className="max-h-full max-w-full object-contain"
                />
              </div>
            )}
            <a
              className="mt-3 text-sm text-primary"
              href={preview.href + "?download=1"}
            >
              预览不可用时下载文件
            </a>
          </div>
        </div>
      )}
    </section>
  );
}
