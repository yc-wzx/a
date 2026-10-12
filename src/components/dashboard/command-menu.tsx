"use client";
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Command } from "cmdk";
import { Search, ArrowUpRight, X, RefreshCw } from "lucide-react";

export type WorkspaceCommand = {
  id: string;
  label: string;
  detail?: string;
  href: string;
  group: string;
};

export function WorkspaceCommandMenu({
  entries,
}: {
  entries: WorkspaceCommand[];
}) {
  const dialog = useRef<HTMLDialogElement>(null),
    input = useRef<HTMLInputElement>(null),
    trigger = useRef<HTMLButtonElement>(null);
  const [search, setSearch] = useState("");
  const router = useRouter();
  function open() {
    setSearch("");
    dialog.current?.showModal();
    requestAnimationFrame(() => input.current?.focus());
  }
  useEffect(() => {
    function keydown(e: KeyboardEvent) {
      if (
        (e.ctrlKey || e.metaKey) &&
        e.key.toLowerCase() === "k" &&
        !e.altKey &&
        !e.repeat
      ) {
        e.preventDefault();
        if (dialog.current?.open) dialog.current.close();
        else {
          setSearch("");
          dialog.current?.showModal();
          requestAnimationFrame(() => input.current?.focus());
        }
      }
    }
    document.addEventListener("keydown", keydown);
    return () => document.removeEventListener("keydown", keydown);
  }, []);
  const groups = [...new Set(entries.map((e) => e.group))];
  return (
    <>
      <button
        type="button"
        ref={trigger}
        onClick={open}
        className="workspace-search-trigger"
        aria-label="快速查找任务或项目"
      >
        <Search aria-hidden className="size-4" />
        <span>快速查找</span>
        <kbd>Ctrl K</kbd>
      </button>
      <dialog
        ref={dialog}
        className="workspace-command"
        aria-labelledby="workspace-command-title"
        aria-describedby="workspace-command-note"
        onClose={() => trigger.current?.focus()}
        onClick={(e) => {
          if (e.target === e.currentTarget) dialog.current?.close();
        }}
      >
        <div className="workspace-command-surface">
          <div className="flex items-center justify-between px-4 pt-4">
            <h2 id="workspace-command-title" className="text-sm font-semibold">
              快速查找
            </h2>
            <button
              type="button"
              aria-label="关闭快速查找"
              onClick={() => dialog.current?.close()}
              className="rounded p-1 text-ink-soft hover:bg-sunken"
            >
              <X aria-hidden className="size-4" />
            </button>
          </div>
          <p id="workspace-command-note" className="sr-only">
            搜索已加载的本人任务、项目、当前迭代和成果。上下方向键选择，回车打开，Escape
            关闭。
          </p>
          <Command
          label="快速查找关键词"
            loop
            filter={(value, term) =>
              value
                .toLocaleLowerCase()
                .includes(term.trim().toLocaleLowerCase())
                ? 1
                : 0
            }
          >
            <div className="flex items-center gap-3 border-b border-line px-4">
              <Search aria-hidden className="size-5 text-ink-soft" />
              <Command.Input
                ref={input}
                value={search}
                onValueChange={setSearch}
                placeholder="输入任务、项目或功能名称…"
                aria-label="快速查找关键词"
              />
            </div>
            <Command.List>
              <Command.Empty>
                没有找到匹配内容。可在项目页查找其他任务。
              </Command.Empty>
              {groups.map((group) => (
                <Command.Group key={group} heading={group}>
                  {entries
                    .filter((e) => e.group === group)
                    .map((e) => (
                      <Command.Item
                        key={e.id}
                        value={`${e.label} ${e.detail ?? ""} ${e.id}`}
                        onSelect={() => {
                          dialog.current?.close();
                          router.push(e.href);
                        }}
                      >
                        <div className="min-w-0 flex-1">
                          <span className="block break-words">{e.label}</span>
                          {e.detail && (
                            <span className="mt-0.5 block text-xs text-ink-soft">
                              {e.detail}
                            </span>
                          )}
                        </div>
                        <ArrowUpRight aria-hidden className="size-4" />
                      </Command.Item>
                    ))}
                </Command.Group>
              ))}
            </Command.List>
          </Command>
          <div className="flex gap-4 border-t border-line bg-sunken/50 px-4 py-3 text-xs text-ink-soft">
            <span>↑ ↓ 选择</span>
            <span>Enter 打开</span>
            <span className="ml-auto">Esc 关闭</span>
          </div>
        </div>
      </dialog>
    </>
  );
}

export function RefreshWorkspace() {
  const router = useRouter(),
    [pending, startTransition] = useTransition();
  const [refreshed, setRefreshed] = useState(false);
  return (
    <div className="flex items-center gap-2">
      <span role="status" className="text-xs text-ink-soft">
        {pending ? "正在更新…" : refreshed ? "已更新" : ""}
      </span>
      <button
        type="button"
        className="workspace-icon-button"
        aria-label="刷新工作台"
        disabled={pending}
        onClick={() => {
          setRefreshed(true);
          startTransition(() => router.refresh());
        }}
      >
        <RefreshCw
          aria-hidden
          className={`size-4 ${pending ? "animate-spin" : ""}`}
        />
      </button>
    </div>
  );
}
