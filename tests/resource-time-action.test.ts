import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { displayDateTime } from "@/lib/display-time";
const create = vi.hoisted(() => vi.fn());
vi.mock("@/lib/resource", () => ({ createResourceUsage: create, endResourceUsage: vi.fn() }));
vi.mock("@/lib/auth", () => ({ auth: async () => ({ user: { id: "actor" } }) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
import { createResourceAction } from "@/app/(app)/teams/[teamId]/resources/actions";
function input(startTime: string, endTime = "") {
  const form = new FormData();
  for (const [key, value] of Object.entries({ teamId: randomUUID(), resourceName: "课堂服务器", startTime, endTime })) form.set(key, value);
  return form;
}
beforeEach(() => create.mockReset());
describe("resource entry times", () => {
  it("stores 09:00–10:30 Beijing input as 01:00–02:30 UTC", async () => {
    expect(await createResourceAction(null, input("2026-10-14T09:00", "2026-10-14T10:30"))).toBeNull();
    const data = create.mock.calls[0][2];
    expect(data.startTime.toISOString()).toBe("2026-10-14T01:00:00.000Z");
    expect(data.endTime.toISOString()).toBe("2026-10-14T02:30:00.000Z");
    expect(displayDateTime(data.startTime)).toBe("2026-10-14 09:00");
  });
  it("keeps an empty end time as an ongoing usage", async () => {
    expect(await createResourceAction(null, input("2026-10-14T09:00"))).toBeNull();
    expect(create.mock.calls[0][2].endTime).toBeUndefined();
  });
  it("rejects invalid dates before writing any usage", async () => {
    expect(await createResourceAction(null, input("2026-02-30T09:00"))).toEqual({ error: "开始时间无效" });
    expect(await createResourceAction(null, input("2026-10-14T09:00", "invalid"))).toEqual({ error: "结束时间无效" });
    expect(create).not.toHaveBeenCalled();
  });
});
