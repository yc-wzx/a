import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ actor: "", service: vi.fn() }));
vi.mock("@/lib/auth", () => ({ auth: async () => mock.actor ? { user: { id: mock.actor } } : null }));
vi.mock("@/lib/workspace-calendar", () => ({ getWorkspaceCalendar: mock.service }));
import { GET } from "@/app/api/workspace/calendar/route";
import { ValidationError } from "@/lib/errors";
describe("日历接口鉴权与私有响应", () => {
  beforeEach(() => { mock.actor = ""; mock.service.mockReset(); });
  const request = () => new NextRequest("http://localhost/api/workspace/calendar?startDate=2026-10-12&endDate=2026-10-18&actorId=someone-else");
  it("未登录不调用日历服务", async () => {
    const response = await GET(request());
    expect(response.status).toBe(401);
    expect(mock.service).not.toHaveBeenCalled();
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  });
  it("只使用登录账号，忽略调用者伪造的 actorId", async () => {
    mock.actor = "real-session-actor"; mock.service.mockResolvedValue({ entries: [], truncated: false });
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(mock.service).toHaveBeenCalledWith("real-session-actor", { startDate: "2026-10-12", endDate: "2026-10-18" });
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  });
  it("无效日期返回可理解的 422，不泄露内部错误", async () => {
    mock.actor = "real-session-actor"; mock.service.mockRejectedValue(new ValidationError("请选择不超过 42 天的有效日期范围"));
    const response = await GET(request());
    expect(response.status).toBe(422);
    expect((await response.json()).error).toContain("42 天");
  });
});
