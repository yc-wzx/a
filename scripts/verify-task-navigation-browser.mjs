import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";

const config = JSON.parse(fs.readFileSync(process.env.TASK_QA_CONFIG));
const demo = JSON.parse(fs.readFileSync(process.env.TASK_QA_MANIFEST));
const origin = config.origin.replace(/\/$/, "");
const local = /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin);
if (!local && (origin !== "https://weidu-agilecampus.pw" || process.env.ALLOW_PRODUCTION_QA !== "true"))
  throw Error("Only the owned demo site or a local fixture may be verified");
assert(config.accounts.every(a => a.email === `${a.role}.demo@weidu-agilecampus.pw`));
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const browser = await chromium.launch({ channel: "msedge", headless: true, args: ["--no-proxy-server"] });
const output = path.resolve(process.env.TASK_QA_OUTPUT || ".next/task-navigation-verification");
fs.mkdirSync(output, { recursive: true });
const checks = [], errors = [], contexts = [];
const clean = value => config.accounts.reduce((s, a) => s.replaceAll(a.password, "[hidden]"), String(value));
const project = `/projects/${demo.project.id}`;
const studentId = demo.accounts.find(a => a.role === "student").id;
function pass(check) { checks.push(check); console.log(check); }
async function visit(page, route) {
  const response = await page.goto(origin + route);
  assert(response && response.status() < 400, route);
  await page.locator("main").first().waitFor();
}
async function preview(page, link, name) {
  await link.waitFor({ state: "visible" });
  await link.scrollIntoViewIfNeeded();
  const before = new URL(page.url());
  const href = await link.getAttribute("href");
  const expected = new URL(href, origin).searchParams.get("task");
  assert(expected);
  const scroll = await page.evaluate(() => window.scrollY);
  await link.click();
  const dialog = page.getByRole("dialog", { name: "任务详情", exact: true });
  await dialog.waitFor();
  await page.waitForFunction(() => !document.querySelector('[role="dialog"]')?.textContent?.includes("载入任务详情…"));
  const opened = new URL(page.url());
  assert.equal(opened.pathname, before.pathname, name + " leaves the original page");
  assert.equal(opened.searchParams.get("task"), expected);
  assert.equal(await dialog.count(), 1, name + " must have exactly one drawer");
  for (const [key, value] of before.searchParams) assert.equal(opened.searchParams.get(key), value);
  await dialog.locator("aside > header").getByRole("button", { name: "关闭", exact: true }).click();
  await dialog.waitFor({ state: "detached" });
  assert.equal(page.url(), before.href, name + " restores filters and URL");
  assert(Math.abs(await page.evaluate(() => window.scrollY) - scroll) <= 5, name + " preserves scroll");
  pass(name + "：留在原页面、仅一个侧栏、关闭后保留筛选与位置");
}
try {
  const pages = {};
  for (const account of config.accounts) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    contexts.push(context);
    const page = await context.newPage(); pages[account.role] = page;
    page.setDefaultTimeout(60000); page.on("pageerror", e => errors.push(clean(e.message)));
    await page.goto(origin + "/login");
    await page.locator('input[name="email"]').fill(account.email);
    await page.locator('input[name="password"]').fill(account.password);
    await page.getByRole("button", { name: "登录", exact: true }).click();
    await page.waitForURL("**/dashboard");
  }
  pass("三个演示角色正常登录");
  const page = pages.student;
  await preview(page, page.locator("a.workspace-task").first(), "工作台本人任务");
  if ((await page.locator('a.workspace-focus-action[href*="task="]').count()) > 0)
    await preview(page, page.locator('a.workspace-focus-action[href*="task="]').first(), "工作台优先操作");

  await page.getByRole("button", { name: "快速查找任务或项目", exact: true }).click();
  await page.getByLabel("快速查找关键词", { exact: true }).fill("检查课表与个人规划交互");
  await page.getByRole("option").filter({ hasText: "检查课表与个人规划交互" }).first().click();
  await page.getByRole("dialog", { name: "任务详情", exact: true }).waitFor();
  assert.equal(new URL(page.url()).pathname, "/dashboard");
  assert.equal(await page.getByRole("dialog", { name: "任务详情", exact: true }).count(), 1);
  await page.keyboard.press("Escape");
  await page.getByRole("dialog", { name: "任务详情", exact: true }).waitFor({ state: "detached" });
  pass("快速查找选择任务只在工作台打开一个侧栏");

  const entries = [
    ["项目概览待办", project + "/overview", 'a[href*="?task="]'],
    ["成员主页任务", `/people/${studentId}?team=${demo.team.id}&tab=tasks&filter=overdue`, 'a[href*="?task="]'],
    ["迭代列表任务", project + "/iterations", 'a[href*="?task="]'],
    ["迭代详情任务", project + "/iterations/" + demo.iterations.active, 'a[href*="?task="]'],
    ["个人计划任务", project + "/personal-plan", 'a[href*="?task="]'],
    ["成果反馈修改任务", project + "/deliverables/" + demo.deliverables.history, 'a[href*="?task="]'],
    ["通知任务来源", "/notifications", 'a[href*="?task="]'],
    ["过程证据任务来源", project + "/evidence/process", 'a[href*="?task="]'],
  ];
  for (const [name, route, selector] of entries) {
    await visit(page, route);
    await preview(page, page.locator(selector).first(), name);
  }

  await visit(page, project + "/overview");
  const workload = page.locator('a[href*="&task="]').first();
  const parent = workload.locator("xpath=ancestor::details");
  if ((await parent.getAttribute("open")) === null) await parent.locator("summary").click();
  await preview(page, workload, "成员工作量任务");

  const document = project + "/documents/" + demo.documents.collaboration;
  await visit(page, document);
  await page.getByRole("navigation", { name: "文档协作面板" }).getByRole("button", { name: "任务", exact: true }).click();
  await preview(page, page.locator('aside a[href*="?task="]').first(), "文档关联任务");

  for (const view of ["board", "list", "gantt"]) {
    await visit(page, project + (view === "board" ? "?group=assignee" : `?view=${view}&sort=due`));
    const before = page.url();
    const title = await page.getByRole("button", { name: "完善交互原型与异常路径（演示）", exact: true }).first();
    await title.click();
    const dialog = page.getByRole("dialog", { name: "任务详情", exact: true });
    await dialog.waitFor(); assert.equal(await dialog.count(), 1);
    assert.equal(new URL(page.url()).pathname, project);
    assert.equal(new URL(page.url()).searchParams.get("task"), demo.tasks.prototype);
    await page.keyboard.press("Escape"); await dialog.waitFor({ state: "detached" });
    assert.equal(page.url(), before);
    pass(`${view} 视图：点击只开一次侧栏，Escape 后保留分组与排序`);
  }

  await visit(page, "/dashboard");
  const taskLink = page.locator("a.workspace-task").first(), before = page.url();
  await taskLink.click(); await page.getByRole("dialog", { name: "任务详情", exact: true }).waitFor();
  await page.goBack(); await page.getByRole("dialog", { name: "任务详情", exact: true }).waitFor({ state: "detached" });
  assert.equal(page.url(), before);
  await page.goForward(); await page.getByRole("dialog", { name: "任务详情", exact: true }).waitFor();
  await page.keyboard.press("Escape"); await page.getByRole("dialog", { name: "任务详情", exact: true }).waitFor({ state: "detached" });
  pass("浏览器后退关闭、前进恢复侧栏，Escape 返回原入口");

  const popupPromise = page.context().waitForEvent("page");
  await page.locator("a.workspace-task").first().click({ modifiers: ["Control"] });
  const popup = await popupPromise; popup.setDefaultTimeout(60000);
  await popup.getByRole("dialog", { name: "任务详情", exact: true }).waitFor();
  assert.equal(new URL(popup.url()).pathname, project);
  assert.equal(await page.getByRole("dialog", { name: "任务详情", exact: true }).count(), 0);
  await popup.close();
  pass("Ctrl 点击在新标签打开原项目深链，原页面不弹出侧栏");

  await visit(page, project + `?view=list&sort=due&task=${demo.tasks.prototype}`);
  await page.getByRole("dialog", { name: "任务详情", exact: true }).waitFor();
  assert.equal(await page.getByRole("dialog", { name: "任务详情", exact: true }).count(), 1);
  await page.reload(); await page.getByRole("dialog", { name: "任务详情", exact: true }).waitFor();
  await page.getByRole("dialog", { name: "任务详情", exact: true }).locator("aside > header").getByRole("button", { name: "关闭", exact: true }).click();
  await page.getByRole("dialog", { name: "任务详情", exact: true }).waitFor({ state: "detached" });
  assert.equal(new URL(page.url()).searchParams.get("view"), "list");
  assert.equal(new URL(page.url()).searchParams.get("sort"), "due");
  pass("原项目任务深链可直接访问和刷新，关闭后保留列表排序");

  for (const role of ["admin", "student", "teacher"]) {
    const actor = pages[role];
    await visit(actor, `/people/${studentId}?tab=tasks`);
    await actor.locator('a[href*="?task="]').first().click();
    const dialog = actor.getByRole("dialog", { name: "任务详情", exact: true });
    await dialog.waitFor();
    if (role === "teacher") {
      await dialog.getByText("你的角色只能查看任务。", { exact: true }).waitFor();
      assert.equal(await dialog.getByRole("button", { name: "删除任务", exact: true }).count(), 0);
    }
    await actor.keyboard.press("Escape");
    await dialog.waitFor({ state: "detached" });
    pass(role + " 查看任务权限保留，老师仍为只读");
  }

  await visit(page, "/dashboard");
  await page.locator('a[href="' + project + '"]').first().click();
  await page.waitForURL(origin + project);
  assert.equal(await page.getByRole("dialog", { name: "任务详情", exact: true }).count(), 0);
  pass("普通项目入口正常进入项目页，不弹出任务侧栏");
  assert.deepEqual(errors, []);
  await page.screenshot({ path: path.join(output, "project-page.png"), fullPage: false });
  const report = { origin, checkedAt: new Date().toISOString(), checks, pageErrors: errors, mutatesBusinessData: false };
  fs.writeFileSync(path.join(output, "verification.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ checks: checks.length, pageErrors: errors.length, report: path.join(output, "verification.json") }));
} catch (error) {
  fs.writeFileSync(path.join(output, "failure.json"), JSON.stringify({ checks, pageErrors: errors, error: clean(error.stack) }, null, 2));
  throw Error(clean(error.stack));
} finally { await browser.close(); }
