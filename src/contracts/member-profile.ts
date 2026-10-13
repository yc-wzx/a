import { z } from "zod";

export const AVATAR_COLORS = ["blue", "violet", "emerald", "amber", "rose", "slate"] as const;
export const AVATAR_NAMES: Record<(typeof AVATAR_COLORS)[number], string> = {
  blue: "蓝色", violet: "紫色", emerald: "绿色", amber: "橙色", rose: "玫红", slate: "灰色",
};
export const profileEditSchema = z.strictObject({
  name: z.string().trim().min(1, "请填写姓名").max(80, "姓名最多 80 字"),
  bio: z.string().trim().max(500, "简介最多 500 字"),
  skills: z.array(z.string().trim().min(1).max(24, "单个技能最多 24 字")).max(12, "最多填写 12 个技能"),
  avatarColor: z.enum(AVATAR_COLORS),
  avatarLabel: z.string().trim().max(4, "头像文字最多 4 字"),
  expectedRevision: z.number().int().min(0).max(2147483646),
});
export type ProfileEditInput = z.infer<typeof profileEditSchema>;
export const profileBrowseSchema = z.strictObject({
  teamId: z.uuid().optional(),
  filter: z.enum(["all", "todo", "doing", "done", "overdue"]).default("all"),
  page: z.number().int().min(1).max(500).default(1),
});
export const TEAM_ROLE_NAMES = { admin: "团队管理员", student: "项目成员", teacher: "指导教师" };
