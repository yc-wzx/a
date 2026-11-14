"use client";

import { useState } from "react";
import { FileText, Link2, Package } from "lucide-react";
import type {
  MaterialOption,
  TaskMaterial,
} from "@/contracts/task-enhancements";
import {
  inferMaterialPurpose,
  MATERIAL_PURPOSES,
  MATERIAL_PURPOSE_LABELS,
  type MaterialPurpose,
} from "@/lib/material-purpose";

export type MaterialFile = {
  id: string;
  filename: string;
  mediaType: string;
  size: number;
  href: string;
  canDelete: boolean;
  canClassify?: boolean;
  materialPurpose?: MaterialPurpose;
  revision?: number;
  createdAt: string;
};
export type TaskMaterialControls = {
  materials: TaskMaterial[];
  materialOptions: MaterialOption[];
  canWrite: boolean;
  pending: boolean;
  onLink: (option: MaterialOption) => void;
  onUnlink: (item: TaskMaterial) => void;
  onPurposeChange: (
    item: TaskMaterial,
    purpose: MaterialPurpose | null,
  ) => void;
};

function PurposeSelect({
  title,
  value,
  disabled,
  onChange,
}: {
  title: string;
  value: MaterialPurpose;
  disabled: boolean;
  onChange: (value: MaterialPurpose | null) => void;
}) {
  return (
    <select
      aria-label={`材料用途：${title}`}
      value={value}
      disabled={disabled}
      className="ac-field w-auto max-w-28 py-1 text-xs"
      onChange={(event) =>
        onChange(
          event.target.value ? (event.target.value as MaterialPurpose) : null,
        )
      }
    >
      <option value="">自动识别</option>
      {MATERIAL_PURPOSES.map((purpose) => (
        <option key={purpose} value={purpose}>
          {MATERIAL_PURPOSE_LABELS[purpose]}
        </option>
      ))}
    </select>
  );
}

export function TaskMaterialList({
  files,
  links,
  busy,
  onPreview,
  onDelete,
  onClassify,
}: {
  files: MaterialFile[];
  links: TaskMaterialControls;
  busy: boolean;
  onPreview: (file: MaterialFile) => void;
  onDelete: (file: MaterialFile) => void;
  onClassify: (file: MaterialFile, purpose: MaterialPurpose | null) => void;
}) {
  const [source, setSource] = useState("");
  const disabled = busy || links.pending;
  const linked = new Set(
    links.materials.map((item) => `${item.kind}:${item.sourceId}`),
  );
  const options = links.materialOptions.filter(
    (item) => !linked.has(`${item.kind}:${item.id}`),
  );
  return (
    <div className="space-y-4">
      {MATERIAL_PURPOSES.map((purpose) => {
        const groupFiles = files.filter(
          (item) =>
            (item.materialPurpose ?? inferMaterialPurpose(item.filename)) ===
            purpose,
        );
        const groupLinks = links.materials.filter(
          (item) =>
            (item.materialPurpose ??
              inferMaterialPurpose(item.title, item.href)) === purpose,
        );
        if (!groupFiles.length && !groupLinks.length) return null;
        return (
          <section
            key={purpose}
            aria-label={MATERIAL_PURPOSE_LABELS[purpose]}
            className="space-y-2"
          >
            <h4 className="text-sm font-medium text-ink">
              {MATERIAL_PURPOSE_LABELS[purpose]}{" "}
              <span className="font-normal text-ink-soft">
                {groupFiles.length + groupLinks.length}
              </span>
            </h4>
            <ul className="divide-y divide-line">
              {groupFiles.map((item) => (
                <li
                  key={item.id}
                  className="flex flex-wrap items-center gap-2 py-2 text-sm"
                >
                  {purpose === "code" ? (
                    <Package
                      aria-hidden
                      size={16}
                      className="shrink-0 text-ink-soft"
                    />
                  ) : (
                    <FileText
                      aria-hidden
                      size={16}
                      className="shrink-0 text-ink-soft"
                    />
                  )}
                  <div className="min-w-28 flex-1">
                    <a
                      className="break-all text-primary hover:underline"
                      href={item.href + "?download=1"}
                    >
                      {item.filename}
                    </a>
                    <p className="mt-0.5 text-xs text-ink-soft">
                      {item.size < 1024
                        ? `${item.size} B`
                        : item.size < 1048576
                          ? `${(item.size / 1024).toFixed(1)} KB`
                          : `${(item.size / 1048576).toFixed(2)} MB`}
                    </p>
                  </div>
                  {item.canClassify && (
                    <PurposeSelect
                      title={item.filename}
                      value={purpose}
                      disabled={disabled}
                      onChange={(value) => onClassify(item, value)}
                    />
                  )}
                  <div className="flex items-center gap-3 text-xs text-primary">
                    {(item.mediaType.startsWith("image/") ||
                      item.mediaType === "application/pdf") && (
                      <button type="button" onClick={() => onPreview(item)}>
                        预览
                      </button>
                    )}
                    <a href={item.href + "?download=1"}>下载</a>
                    {item.canDelete && (
                      <button
                        type="button"
                        disabled={disabled}
                        aria-label={`删除材料：${item.filename}`}
                        className="text-ink-soft hover:text-high"
                        onClick={() => onDelete(item)}
                      >
                        删除
                      </button>
                    )}
                  </div>
                </li>
              ))}
              {groupLinks.map((item) => (
                <li
                  key={item.id}
                  className="flex flex-wrap items-center gap-2 py-2 text-sm"
                >
                  <Link2
                    aria-hidden
                    size={16}
                    className="shrink-0 text-ink-soft"
                  />
                  <a
                    className="min-w-28 flex-1 break-words text-primary hover:underline"
                    href={item.href}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {item.title}
                  </a>
                  {links.canWrite && (
                    <>
                      <PurposeSelect
                        title={item.title}
                        value={purpose}
                        disabled={disabled}
                        onChange={(value) => links.onPurposeChange(item, value)}
                      />
                      <button
                        type="button"
                        disabled={disabled}
                        aria-label={`解除关联：${item.title}`}
                        className="text-xs text-ink-soft hover:text-high"
                        onClick={() => links.onUnlink(item)}
                      >
                        解除
                      </button>
                    </>
                  )}
                </li>
              ))}
            </ul>
          </section>
        );
      })}
      {!files.length && !links.materials.length && (
        <p className="text-sm text-ink-soft">
          上传任务文件，或关联已有问卷、资料与正式成果版本。
        </p>
      )}
      {links.canWrite && options.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer text-primary">关联资料</summary>
          <form
            className="mt-3 flex gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              const selected = options.find(
                (item) => `${item.kind}:${item.id}` === source,
              );
              if (selected) links.onLink(selected);
            }}
          >
            <select
              aria-label="选择关联资料"
              value={source}
              disabled={disabled}
              className="ac-field min-w-0 flex-1"
              onChange={(event) => setSource(event.target.value)}
            >
              <option value="">选择项目资料或成果版本</option>
              {options.map((item) => (
                <option
                  key={`${item.kind}:${item.id}`}
                  value={`${item.kind}:${item.id}`}
                >
                  {item.kind === "resource" ? "资料" : "成果"} · {item.title}
                </option>
              ))}
            </select>
            <button
              className="ac-btn-ghost shrink-0"
              disabled={
                disabled ||
                links.materials.length >= 50 ||
                !options.some((item) => `${item.kind}:${item.id}` === source)
              }
            >
              关联
            </button>
          </form>
        </details>
      )}
    </div>
  );
}
