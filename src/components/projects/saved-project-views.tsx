"use client";

import { useCallback, useMemo, useState, useSyncExternalStore } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  applySavedView,
  MAX_SAVED_VIEWS,
  readSavedViews,
  savedViewQuery,
  savedViewsStorageKey,
  type SavedProjectView,
} from "@/lib/project-views";

const EVENT = "agilecampus:saved-project-views";
function subscribe(listener: () => void) {
  window.addEventListener("storage", listener);
  window.addEventListener(EVENT, listener);
  return () => {
    window.removeEventListener("storage", listener);
    window.removeEventListener(EVENT, listener);
  };
}
const serverSnapshot = () => "";

export function SavedProjectViews({
  userId,
  projectId,
}: {
  userId: string;
  projectId: string;
}) {
  const key = savedViewsStorageKey(userId, projectId);
  const getSnapshot = useCallback(() => {
    try {
      return localStorage.getItem(key) ?? "";
    } catch {
      return "";
    }
  }, [key]);
  const raw = useSyncExternalStore(subscribe, getSnapshot, serverSnapshot);
  const views = useMemo(() => readSavedViews(raw), [raw]);
  const [name, setName] = useState("");
  const [selected, setSelected] = useState("");
  const [message, setMessage] = useState("");
  const router = useRouter(),
    pathname = usePathname(),
    params = useSearchParams();
  const current = views.find((v) => v.id === selected);
  function write(next: SavedProjectView[], success: string) {
    try {
      localStorage.setItem(key, JSON.stringify(next));
      window.dispatchEvent(new Event(EVENT));
      setMessage(success);
      return true;
    } catch {
      setMessage(
        "浏览器禁止保存设置；当前筛选仍可正常使用，请允许站点存储后重试。",
      );
      return false;
    }
  }
  function validateName() {
    const value = name.trim();
    if (!value || value.length > 30) {
      setMessage("请输入 1～30 字的名称。");
      return null;
    }
    if (views.some((v) => v.name === value && v.id !== current?.id)) {
      setMessage("已有同名筛选，请换一个名称。");
      return null;
    }
    return value;
  }
  return (
    <details className="rounded-xl border border-line bg-surface p-3">
      <summary className="cursor-pointer text-sm font-medium text-ink">
        常用筛选{" "}
        <span className="text-xs font-normal text-ink-faint">
          {views.length ? `· ${views.length} 个` : "· 保存常用的筛选与视图"}
        </span>
      </summary>
      <div className="mt-3 space-y-3">
        <p className="text-xs text-ink-soft">
          仅保存于当前浏览器，按你的账号和项目分开；更换设备或清除浏览器数据后不会保留。
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <label className="sr-only" htmlFor="saved-view-select">
            已保存的筛选
          </label>
          <select
            id="saved-view-select"
            className="ac-field w-48"
            value={current?.id ?? ""}
            onChange={(e) => {
              setSelected(e.target.value);
              setName(views.find((v) => v.id === e.target.value)?.name ?? "");
              setMessage("");
            }}
          >
            <option value="">新建常用筛选</option>
            {views.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="ac-btn-ghost"
            disabled={!current}
            onClick={() => {
              if (!current) return;
              const qs = applySavedView(
                new URLSearchParams(params.toString()),
                current.query,
              ).toString();
              router.replace(qs ? `${pathname}?${qs}` : pathname, {
                scroll: false,
              });
              setMessage(`已应用「${current.name}」。`);
            }}
          >
            应用筛选
          </button>
          <button
            type="button"
            className="ac-btn-ghost"
            disabled={!current}
            onClick={() => {
              if (
                current &&
                write(
                  views.filter((v) => v.id !== current.id),
                  "已删除保存的筛选，任务数据不受影响。",
                )
              ) {
                setSelected("");
                setName("");
              }
            }}
          >
            删除筛选
          </button>
        </div>
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const value = validateName();
            if (!value) return;
            if (views.length >= MAX_SAVED_VIEWS) {
              setMessage("最多保存 12 个筛选，请先删除不用的筛选。");
              return;
            }
            if (views.some((v) => v.name === value)) {
              setMessage("已有同名筛选，请换一个名称。");
              return;
            }
            const item = {
              id: crypto.randomUUID(),
              name: value,
              query: savedViewQuery(new URLSearchParams(params.toString())),
            };
            if (write([...views, item], "已保存当前筛选、分组、视图和排序。"))
              setSelected(item.id);
          }}
        >
          <label className="sr-only" htmlFor="saved-view-name">
            筛选名称
          </label>
          <input
            id="saved-view-name"
            className="ac-field w-48"
            placeholder="例如：我的逾期任务"
            maxLength={30}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <button className="ac-btn" type="submit">
            保存当前筛选
          </button>
          <button
            className="ac-btn-ghost"
            type="button"
            disabled={!current}
            onClick={() => {
              const value = validateName();
              if (current && value)
                write(
                  views.map((v) =>
                    v.id === current.id ? { ...v, name: value } : v,
                  ),
                  "名称已更新。",
                );
            }}
          >
            重命名
          </button>
        </form>
        <p role="status" className="text-xs text-ink-soft">
          {message}
        </p>
      </div>
    </details>
  );
}
