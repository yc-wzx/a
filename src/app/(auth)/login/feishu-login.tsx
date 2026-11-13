"use client";

import { useEffect, useState } from "react";
import { signIn } from "next-auth/react";

// 飞书 JSSDK 全局（运行时由飞书客户端注入 window.h5sdk / window.tt）
declare global {
  interface Window {
    h5sdk?: {
      config: (c: {
        appId: string;
        timestamp: number;
        nonceStr: string;
        signature: string;
        onSuccess?: () => void;
        onFail?: (e: unknown) => void;
      }) => void;
      ready: (cb: () => void) => void;
      error: (cb: (e: unknown) => void) => void;
    };
    tt?: {
      requestAuthCode: (o: {
        appId: string;
        success: (res: { code: string }) => void;
        fail: (e: unknown) => void;
      }) => void;
    };
  }
}

export function FeishuLogin() {
  const [status, setStatus] = useState<"checking" | "unconfigured" | "unavailable" | "idle" | "silent" | "failed">("checking");
  const [reload, setReload] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    const pageUrl = window.location.href.split("#")[0];
    (async () => {
      try {
        const readiness = await fetch("/api/feishu/status", { cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]) });
        if (!readiness.ok) throw new Error("readiness unavailable");
        const configuration = await readiness.json();
        if (controller.signal.aborted) return;
        if (!configuration.login) { setStatus("unconfigured"); return; }
        if (!window.h5sdk || !window.tt) { setStatus("idle"); return; }
        setStatus("silent");
        const res = await fetch(`/api/feishu/jssdk-config?url=${encodeURIComponent(pageUrl)}`, { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]) });
        if (!res.ok) throw new Error("config fetch failed");
        const cfg = (await res.json()) as {
          appId: string; timestamp: number; nonceStr: string; signature: string;
        };
        if (controller.signal.aborted) return;
        window.h5sdk!.config({ ...cfg, onFail: () => { if (!controller.signal.aborted) setStatus("failed"); } });
        window.h5sdk!.error(() => { if (!controller.signal.aborted) setStatus("failed"); });
        window.h5sdk!.ready(() => {
          if (controller.signal.aborted) return;
          window.tt!.requestAuthCode({
            appId: cfg.appId,
            success: async ({ code }) => {
              if (controller.signal.aborted) return;
              try { await signIn("feishu", { code, redirectTo: "/teams" }); }
              catch { if (!controller.signal.aborted) setStatus("failed"); }
            },
            fail: () => setStatus("failed"),
          });
        });
      } catch {
        if (!controller.signal.aborted) setStatus(window.h5sdk ? "failed" : "unavailable");
      }
    })();
    return () => controller.abort();
  }, [reload]);

  if (status === "checking") return <p role="status" className="text-center text-xs text-ink-soft">正在检查飞书登录…</p>;
  if (status === "unconfigured") return <p className="text-center text-xs text-ink-faint">飞书登录待管理员启用</p>;
  if (status === "unavailable") return <p role="alert" className="text-center text-xs text-high">飞书状态读取失败。<button type="button" className="ml-2 underline" onClick={() => { setStatus("checking"); setReload(value => value + 1); }}>重试</button></p>;

  if (status === "silent") {
    return <p className="text-center text-sm text-ink-soft">正在通过飞书登录…</p>;
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3 text-xs text-ink-faint">
        <span className="h-px flex-1 bg-line" />
        或
        <span className="h-px flex-1 bg-line" />
      </div>
      {status === "failed" && (
        <p className="text-center text-xs text-high">飞书免登失败，请点下方按钮</p>
      )}
      {/* /api/auth/feishu/login 是 Route Handler 而非页面（规则误判）；OAuth 起点须整页跳转，
          走 next/link 的客户端路由会拿不到服务端 302。 */}
      {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
      <a href="/api/auth/feishu/login" className="ac-btn ac-btn-ghost block w-full text-center">
        飞书登录
      </a>
    </div>
  );
}
