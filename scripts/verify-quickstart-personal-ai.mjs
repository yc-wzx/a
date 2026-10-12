import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright");
const origin = process.env.VERIFY_ORIGIN;
if (!["http://localhost:3099", "https://weidu-agilecampus.pw"].includes(origin))
  throw Error("Unsupported verification origin");
if (origin.startsWith("https:") && process.env.ALLOW_PRODUCTION_QA !== "true")
  throw Error("Explicitly enable private production examples");
const dir = process.env.VERIFY_OUTPUT_DIR;
if (!dir || !path.isAbsolute(dir))
  throw Error("Specify an absolute private output directory");
fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
const suffix = crypto.randomBytes(5).toString("hex");
const accounts = ["教程验收示例", "隔离验收示例"].map((name, i) => ({
  name,
  email: `guide-${suffix}-${i}@example.com`,
  password: crypto.randomBytes(24).toString("base64url"),
}));
fs.writeFileSync(
  path.join(dir, "quickstart-accounts.private.json"),
  JSON.stringify(accounts),
  { mode: 0o600 },
);
const browser = await chromium.launch({
  headless: true,
  ...(process.platform === "win32" ? { channel: "msedge" } : {}),
  ...(process.env.QA_PROXY
    ? { proxy: { server: process.env.QA_PROXY } }
    : { args: ["--no-proxy-server"] }),
});
const ctx = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  }),
  page = await ctx.newPage();
page.setDefaultTimeout(30000);
page.setDefaultNavigationTimeout(45000);
const checks = [],
  errors = [];
let completed = false;
page.on("pageerror", (e) => errors.push(e.message));
async function visit(route) {
  const res = await page.goto(origin + route);
  assert.equal(res.status(), 200, route);
  await page.locator("main").last().waitFor();
}
async function registerLogin(target, account) {
  await target.goto(origin + "/register");
  for (const field of ["name", "email", "password"])
    await target.locator(`input[name=${field}]`).fill(account[field]);
  await target.getByRole("button", { name: "注册", exact: true }).click();
  await target.waitForURL("**/login?registered=1");
  await target.locator("input[name=email]").fill(account.email);
  await target.locator("input[name=password]").fill(account.password);
  await target.getByRole("button", { name: "登录", exact: true }).click();
  await target.waitForURL("**/dashboard");
}
try {
  await registerLogin(page, accounts[0]);
  checks.push("Register and log in a private example account");
  await page.getByRole("button", { name: "关闭新手提示" }).click();
  await page.reload();
  await page
    .getByRole("button", { name: "关闭新手提示" })
    .waitFor({ state: "detached" });
  assert.equal(
    await page.getByRole("button", { name: "关闭新手提示" }).count(),
    0,
  );
  checks.push("Dismissed quickstart hint survives reload");
  await visit("/help");
  for (const title of [
    "五分钟快速上手",
    "我是负责人",
    "我是组员",
    "我是指导老师",
  ])
    await page.getByRole("heading", { name: title, exact: true }).waitFor();
  checks.push("Help presents all three roles with actionable steps");
  await page
    .getByRole("button", { name: "页面引导", exact: true })
    .first()
    .click();
  await page
    .locator(".driver-popover-title")
    .filter({ hasText: "一分钟认识页面" })
    .waitFor();
  await page.getByRole("button", { name: "下一步", exact: true }).click();
  await page
    .locator(".driver-popover-title")
    .filter({ hasText: "先加入团队" })
    .waitFor();
  await page.locator(".driver-popover-close-btn").click();
  await page.locator(".driver-popover").waitFor({ state: "detached" });
  checks.push(
    "Chinese page tour opens, advances and closes without changing business data",
  );
  await visit("/teams");
  const teamName = `教程验收示例-${suffix}`;
  const teamForm = page
    .locator("form")
    .filter({
      has: page.getByRole("heading", { name: "创建团队", exact: true }),
    });
  await teamForm.locator("input[name=name]").fill(teamName);
  await teamForm.getByRole("button", { name: "创建", exact: true }).click();
  const card = page.locator("li").filter({ hasText: teamName });
  await card.waitFor();
  const teamId = (
    await card
      .getByRole("link", { name: "项目", exact: true })
      .getAttribute("href")
  ).split("/")[2];
  await visit(`/teams/${teamId}/projects`);
  const projectForm = page
    .locator("form")
    .filter({
      has: page.getByRole("heading", { name: "创建项目", exact: true }),
    });
  await projectForm.locator("input[name=name]").fill("教程验收示例项目");
  await projectForm.locator("select[name=templateId]").selectOption("course");
  await projectForm.getByRole("button", { name: "创建", exact: true }).click();
  await page.waitForURL(/\/projects\/[0-9a-f-]{36}$/);
  const projectId = page.url().split("/").at(-1),
    milestoneTitle = "可删除的验收示例阶段",
    taskTitle = "删除阶段后保留的验收示例任务";
  const section = page.locator('[data-tour="milestones"]');
  await section.locator("input[name=title]").fill(milestoneTitle);
  await section.getByRole("button", { name: "添加", exact: true }).click();
  const deleteMilestone = section.getByRole("button", {
    name: `删除里程碑 ${milestoneTitle}`,
    exact: true,
  });
  await deleteMilestone.waitFor();
  const taskForm = page
    .locator("form")
    .filter({
      has: page.getByRole("heading", { name: "新建任务", exact: true }),
    });
  await taskForm.locator("input[name=title]").fill(taskTitle);
  await taskForm
    .locator("select[name=milestoneId]")
    .selectOption({ label: milestoneTitle });
  await taskForm.getByRole("button", { name: "创建任务", exact: true }).click();
  await page.getByText(taskTitle, { exact: true }).first().waitFor();
  page.once("dialog", (d) => d.dismiss());
  await deleteMilestone.click();
  await page.waitForTimeout(500);
  assert.equal(await deleteMilestone.count(), 1);
  checks.push("Canceling deletion keeps the milestone");
  let confirmation = "";
  page.once("dialog", (d) => {
    confirmation = d.message();
    return d.accept();
  });
  await deleteMilestone.click();
  await deleteMilestone.waitFor({ state: "detached" });
  assert(confirmation.includes("1 个任务") && confirmation.includes("保留"));
  await page.reload();
  await page.getByText(taskTitle, { exact: true }).first().waitFor();
  assert.equal(
    await section.getByText(milestoneTitle, { exact: true }).count(),
    0,
  );
  checks.push(
    "Milestone deletion shows impact and preserves linked task after reload",
  );
  await page.getByText(taskTitle, { exact: true }).first().click();
  await page.getByRole("button", { name: "删除任务", exact: true }).waitFor();
  page.once("dialog", (d) => {
    assert(d.message().includes("子任务"));
    return d.accept();
  });
  await page.getByRole("button", { name: "删除任务", exact: true }).click();
  await page
    .getByText(taskTitle, { exact: true })
    .first()
    .waitFor({ state: "detached" });
  checks.push(
    "Existing task-detail deletion works with explicit subtask warning",
  );
  await visit("/settings");
  const ai = page.locator("#my-ai");
  assert((await ai.innerText()).includes("尚未配置"));
  const fakeKey = `sk-not-a-real-provider-key-${suffix}`;
  await ai.locator("input[name=apiKey]").fill(fakeKey);
  await ai.locator("input[name=assistantName]").fill("我的验收示例助手");
  await ai
    .getByRole("button", { name: "保存个人 AI 配置", exact: true })
    .click();
  await ai.getByRole("status").filter({ hasText: "已保存个人配置" }).waitFor();
  assert.equal(await ai.locator("input[name=apiKey]").inputValue(), "");
  await page.reload();
  assert.equal(await ai.locator("input[name=apiKey]").inputValue(), "");
  assert(!(await page.content()).includes(fakeKey));
  checks.push(
    "Personal settings save, clear entered key and never echo it in HTML",
  );
  await visit(`/projects/${projectId}`);
  await page
    .locator('[data-tour="assistant"]')
    .getByRole("heading", { name: "我的验收示例助手", exact: true })
    .waitFor();
  await visit(`/projects/${projectId}/ai-drafts`);
  await page.getByRole("link", { name: "我的个人会话", exact: true }).waitFor();
  assert.equal(
    await page
      .getByRole("link", { name: "我的个人会话", exact: true })
      .getAttribute("aria-current"),
    "page",
  );
  checks.push(
    "Assistant uses the personal name and defaults to a private conversation",
  );
  const otherCtx = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
    }),
    other = await otherCtx.newPage();
  await registerLogin(other, accounts[1]);
  await other.goto(origin + "/settings");
  assert((await other.locator("#my-ai").innerText()).includes("尚未配置"));
  assert.equal(
    await other.locator("input[name=assistantName]").inputValue(),
    "我的项目助手",
  );
  assert(!(await other.content()).includes(fakeKey));
  await otherCtx.close();
  checks.push("Second account has independent empty AI settings");
  await visit("/settings");
  page.once("dialog", (d) => d.accept());
  await ai
    .getByRole("button", { name: "删除个人 AI 配置", exact: true })
    .click();
  await ai.getByRole("status").filter({ hasText: "已删除个人" }).waitFor();
  await page.reload();
  assert((await ai.innerText()).includes("尚未配置"));
  checks.push(
    "Deleting own AI configuration persists and leaves the project accessible",
  );
  await visit(`/projects/${projectId}/personal-plan`);
  assert.equal(
    await page.locator("select[name=mode] option[value=ai]").evaluate(el=>el.disabled),
    true,
  );
  assert.equal(await page.locator("select[name=mode]").inputValue(), "rules");
  checks.push("Rule planning remains available without personal AI settings");
  await page.screenshot({
    path: path.join(dir, "personal-plan.png"),
    fullPage: true,
  });
  await visit("/help");
  await page.screenshot({
    path: path.join(dir, "quickstart.png"),
    fullPage: true,
  });
  assert.equal(errors.length, 0, errors.join("; "));
  completed = true;
} finally {
  const report = {
    origin,
    completed,
    verifiedAt: new Date().toISOString(),
    networkMode: process.env.QA_PROXY ? "configured-proxy" : "direct",
    checks,
    browserErrors: errors,
    realAiProviderTested: false,
  };
  fs.writeFileSync(
    path.join(dir, "quickstart-verification.json"),
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report));
  await browser.close();
}
