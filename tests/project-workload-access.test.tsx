import { beforeEach, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ForbiddenError } from "@/lib/errors";
const mocks = vi.hoisted(() => ({
  access: vi.fn(),
  tasks: vi.fn(),
  members: vi.fn(),
}));
vi.mock("@/lib/project", () => ({ getProjectForUser: mocks.access }));
vi.mock("@/lib/task", () => ({ listProjectTasks: mocks.tasks }));
vi.mock("@/lib/team", () => ({ listTeamMembers: mocks.members }));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw Error("404");
  },
}));
vi.mock("next/link", () => ({
  default: (props: React.ComponentProps<"a">) => <a {...props} />,
}));
import { MemberWorkloadPanel } from "@/components/projects/member-workload";
beforeEach(() => {
  vi.clearAllMocks();
  mocks.access.mockResolvedValue({ project: { teamId: "team" } });
  mocks.tasks.mockResolvedValue([]);
  mocks.members.mockResolvedValue([{ id: "member", name: "成员" }]);
});
it("非成员在任何任务和成员查询前被拒绝", async () => {
  mocks.access.mockResolvedValue(null);
  await expect(
    MemberWorkloadPanel({
      actorId: "outsider",
      projectId: "project",
      today: "2026-10-12",
    }),
  ).rejects.toThrow("404");
  expect(mocks.tasks).not.toHaveBeenCalled();
  expect(mocks.members).not.toHaveBeenCalled();
});
it("任务层二次权限拒绝不会降级为零任务", async () => {
  mocks.tasks.mockRejectedValue(new ForbiddenError());
  await expect(
    MemberWorkloadPanel({
      actorId: "member",
      projectId: "project",
      today: "2026-10-12",
    }),
  ).rejects.toThrow("404");
});
it("实际查询故障显示不可用，不显示假的零任务", async () => {
  mocks.tasks.mockRejectedValue(Error("database unavailable"));
  const html = renderToStaticMarkup(
    await MemberWorkloadPanel({
      actorId: "member",
      projectId: "project",
      today: "2026-10-12",
    }),
  );
  expect(html).toContain("暂时无法读取");
  expect(html).not.toContain("未完成 0");
});
