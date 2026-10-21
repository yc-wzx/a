"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  applySavedView,
  MAX_SAVED_VIEWS,
  readSavedViews,
  savedViewQuery,
  savedViewsStorageKey,
  type SavedProjectView,
} from "@/lib/project-views";

export function SavedProjectViews({
  userId,
  projectId,
  compact = false,
}: {
  userId: string;
  projectId: string;
  compact?: boolean;
}) {
  const key = savedViewsStorageKey(userId, projectId);
  const [views, setViews] = useState<SavedProjectView[]>([]);
  const [legacy, setLegacy] = useState<SavedProjectView[]>([]);
  const [revision, setRevision] = useState(0);
  const [ready, setReady] = useState(false), [pending, setPending] = useState(false);
  const writing = useRef(false);
  const [name, setName] = useState("");
  const [selected, setSelected] = useState("");
  const [message, setMessage] = useState("");
  const load = useCallback(async () => {
    setReady(false);
    try {
      const response = await fetch(`/api/projects/${projectId}/saved-views`, { cache: "no-store" });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.error || "读取常用筛选失败");
      setViews(result.data.views); setRevision(result.data.revision); setReady(true);
      try { setLegacy(readSavedViews(localStorage.getItem(key) ?? "").filter(v => !result.data.views.some((old: SavedProjectView) => old.id === v.id))); } catch { /* Storage may be disabled; server preferences remain usable. */ }
    } catch (error) { setMessage(error instanceof Error ? error.message : "读取失败，请重试"); }
  }, [projectId, key]);
  useEffect(() => { let active = true; void Promise.resolve().then(() => { if (active) return load(); }); return () => { active = false; }; }, [load]);
  const router = useRouter(),
    pathname = usePathname(),
    params = useSearchParams();
  const current = views.find((v) => v.id === selected);
  async function write(next: SavedProjectView[], success: string) {
    if (!ready || writing.current) return false;
    writing.current = true; setPending(true);
    try {
      const response = await fetch(`/api/projects/${projectId}/saved-views`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ expectedRevision: revision, views: next }) });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.error || "保存失败，请重新加载后重试");
      setViews(result.data.views); setRevision(result.data.revision);
      setMessage(success);
      return true;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "保存失败，请重新加载后重试");
      return false;
    } finally { writing.current = false; setPending(false); }
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
    <details className={compact ? "project-tool-popover project-saved-views" : "rounded-xl border border-line bg-surface p-3"}>
      <summary className="cursor-pointer text-sm font-medium text-ink">
        常用筛选{" "}
        <span className="text-xs font-normal text-ink-faint">
          {views.length ? `· ${views.length} 个` : compact ? " ▾" : "· 保存常用的筛选与视图"}
        </span>
      </summary>
      <div className={compact ? "project-tool-popover-body space-y-3" : "mt-3 space-y-3"}>
        <p className="text-xs text-ink-soft">
          保存在你的账号中，按项目分开；登录其他设备后也可使用。最多保存 12 个。
        </p>
        <button className="ac-btn-ghost" type="button" disabled={pending} onClick={() => void load()}>重新加载</button>
        {!!legacy.length && <div className="rounded-lg border border-line p-2 text-sm">此浏览器还有 {legacy.length} 个旧筛选。<button type="button" className="ac-btn-ghost" disabled={!ready || pending} onClick={async () => {
          const next = [...views];
          for (const item of legacy) if (!next.some(v => v.id === item.id || v.name === item.name)) next.push(item);
          if (next.length > MAX_SAVED_VIEWS) { setMessage("合并后超过 12 个，请先删除不用的筛选。"); return; }
          if (await write(next, "旧筛选已导入账号；浏览器原数据仍保留。")) setLegacy([]);
        }}>导入我的旧筛选</button></div>}
        <fieldset disabled={!ready || pending} className="space-y-3">
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
            onClick={async () => {
              if (
                current &&
                await write(
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
          onSubmit={async (e) => {
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
            if (await write([...views, item], "已保存到账号：当前筛选、分组、视图和排序。"))
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
        </fieldset>
        <p role="status" className="text-xs text-ink-soft">
          {message}
        </p>
      </div>
    </details>
  );
}
