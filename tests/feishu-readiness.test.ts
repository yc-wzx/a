import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getFeishuConfiguration } from "@/lib/feishu-configuration";
import { GET as status } from "@/app/api/feishu/status/route";
import { GET as login } from "@/app/api/auth/feishu/login/route";

const store = vi.hoisted(() => ({ set: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: async () => store }));
beforeEach(() => {
  vi.stubEnv("FEISHU_APP_ID", "cli_test");
  vi.stubEnv("FEISHU_APP_SECRET", "private-test-value");
  vi.stubEnv("FEISHU_REDIRECT_URI", "https://campus.test/api/auth/feishu/callback");
  store.set.mockClear();
});
afterEach(() => vi.unstubAllEnvs());

describe("飞书配置与入口", () => {
  it("就绪检查只返回布尔状态", async () => {
    const response = await status();
    expect(await response.json()).toEqual({ login: true, notifications: true });
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
  it("未配置时返回本站提示，不设置 OAuth 状态或跳转空应用", async () => {
    vi.stubEnv("FEISHU_APP_SECRET", "");
    expect(getFeishuConfiguration()).toEqual({ login: false, notifications: false });
    const response = await login(new Request("https://campus.test/api/auth/feishu/login"));
    expect(response.headers.get("location")).toBe("https://campus.test/login?feishu=unconfigured");
    expect(store.set).not.toHaveBeenCalled();
  });
  it("缺少或无效回调时只禁用登录，通知配置单独判定", () => {
    for (const uri of ["", "invalid", "https://campus.test/other", "https://user:pass@campus.test/api/auth/feishu/callback"]) {
      vi.stubEnv("FEISHU_REDIRECT_URI", uri);
      expect(getFeishuConfiguration()).toEqual({ login: false, notifications: true });
    }
  });
  it("已配置时保留随机状态和 HttpOnly Cookie", async () => {
    const response = await login(new Request("https://campus.test/api/auth/feishu/login"));
    const target = new URL(response.headers.get("location")!);
    expect(target.hostname).toBe("open.feishu.cn");
    expect(target.searchParams.get("app_id")).toBe("cli_test");
    expect(target.searchParams.get("state")).toMatch(/^[a-f0-9]{32}$/);
    expect(store.set).toHaveBeenCalledWith("feishu_oauth_state", target.searchParams.get("state"), expect.objectContaining({ httpOnly: true, sameSite: "lax", maxAge: 600 }));
  });
});
