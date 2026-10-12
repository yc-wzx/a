// Read existing owned QA projects; preferences written by these checks stay in the test browser.
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { config } from "dotenv";
import postgres from "postgres";
const { chromium } = createRequire(import.meta.url)("playwright");
const origin = process.env.VERIFY_ORIGIN;
if (!["http://localhost:3099", "https://weidu-agilecampus.pw"].includes(origin))
  throw Error("Unsupported origin");
const production = origin.startsWith("https:");
if (production && process.env.ALLOW_PRODUCTION_QA !== "true")
  throw Error("Enable production QA explicitly");
const dir = process.env.VERIFY_OUTPUT_DIR;
if (!dir || !path.isAbsolute(dir) || !process.env.PROJECT_QA_ACCOUNT_FILE)
  throw Error(
    "Specify a private output directory and an existing QA account file",
  );
fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
const input = JSON.parse(
  fs.readFileSync(process.env.PROJECT_QA_ACCOUNT_FILE, "utf8"),
);
const account = input.account ?? input;
if (!account.projectId || !/^(workspace-|deploy-check-)/.test(account.email))
  throw Error("Only owned example accounts are supported");
let sql, expected, otherProject;
if (!production) {
  config({ path: [".env.local", ".env"], quiet: true });
  if (
    !["localhost", "127.0.0.1"].includes(
      new URL(process.env.DATABASE_URL).hostname,
    )
  )
    throw Error("Local DB required");
  sql = postgres(process.env.DATABASE_URL);
  [expected] =
    await sql`select count(*)::int as total, count(*) filter (where status='done')::int as done from tasks where project_id=${account.projectId}`;
  const [project] =
    await sql`select id from projects where team_id=(select team_id from projects where id=${account.projectId}) and id<>${account.projectId} order by id limit 1`;
  otherProject = project?.id;
}
const checks = [],
  errors = [];
const check = (label) => {
  checks.push(label);
  console.log(label);
};
const browser = await chromium.launch({
  headless: true,
  channel: "msedge",
  ...(process.env.QA_PROXY
    ? { proxy: { server: process.env.QA_PROXY } }
    : { args: ["--no-proxy-server"] }),
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
});
const page = await context.newPage();
page.setDefaultTimeout(30000);
page.setDefaultNavigationTimeout(45000);
page.on("pageerror", (error) => errors.push(error.message));
const base = `/projects/${account.projectId}`;
async function login(user) {
  await page.goto(origin + "/login");
  await page.locator('input[name="email"]').fill(user.email);
  await page.locator('input[name="password"]').fill(user.password);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.waitForURL("**/dashboard");
}
async function openSaved() {
  const panel = page
    .locator("details")
    .filter({ has: page.locator("#saved-view-name") });
  if ((await panel.getAttribute("open")) === null)
    await panel.locator("summary").click();
  return panel;
}
try {
  await login(account);
  await page.goto(origin + base);
  const sidebar = page.getByRole("navigation", {
    name: "项目内部导航",
    exact: true,
  });
  assert.equal(await sidebar.locator('[aria-current="page"]').count(), 1);
  assert.equal(
    await sidebar.locator('[aria-current="page"]').innerText(),
    "任务",
  );
  await sidebar.getByText("协作", { exact: true }).click();
  await sidebar.getByRole("link", { name: "会议与资料", exact: true }).click();
  await page.waitForURL("**/references");
  await page
    .getByRole("navigation", { name: "项目内部导航" })
    .getByRole("link", { name: "会议与资料", exact: true })
    .waitFor();
  assert.equal(
    await page
      .locator('[data-project-sidebar] [aria-current="page"]')
      .innerText(),
    "会议与资料",
  );
  check(
    "Grouped sidebar highlights nested routes and keeps existing collaboration entries usable",
  );
  await page.goto(origin + base);
  await page.getByRole("button", { name: "列表", exact: true }).click();
  await page.getByRole("table").waitFor();
  if (expected)
    assert.equal(
      await page.getByRole("table").locator("tbody button").count(),
      expected.total,
    );
  await page.getByLabel("列表排序").selectOption("due");
  await page.waitForURL(/sort=due/);
  await openSaved();
  await page.getByLabel("筛选名称", { exact: true }).fill("验收：截止日期列表");
  await page.getByRole("button", { name: "保存当前筛选", exact: true }).click();
  await page
    .getByRole("status")
    .getByText("已保存当前筛选、分组、视图和排序。", { exact: true })
    .waitFor();
  await page.reload();
  await openSaved();
  assert.equal(
    await page
      .getByLabel("已保存的筛选", { exact: true })
      .locator("option")
      .count(),
    2,
  );
  await page
    .getByLabel("已保存的筛选", { exact: true })
    .selectOption({ label: "验收：截止日期列表" });
  await page.getByLabel("筛选名称", { exact: true }).fill("验收：我的列表");
  await page.getByRole("button", { name: "重命名", exact: true }).click();
  await page
    .getByRole("option", { name: "验收：我的列表", exact: true })
    .waitFor({ state: "attached" });
  check(
    "Named view saves list and sort settings, survives reload and supports renaming",
  );
  const first = page.getByRole("table").locator("tbody button").first();
  assert(
    await first.count(),
    "Existing QA project must contain at least one task",
  );
  const title = await first.innerText();
  await first.click();
  const dialog = page.getByRole("dialog", { name: "任务详情" });
  await dialog
    .getByRole("heading", { level: 3 })
    .filter({ hasText: title.replace(/^子任务/, "").trim() })
    .waitFor();
  const taskId = new URL(page.url()).searchParams.get("task");
  assert(taskId);
  await page.goto(origin + base + `?view=gantt&task=${taskId}&sort=due`);
  await page.getByRole("dialog", { name: "任务详情" }).waitFor();
  assert.equal(await page.getByRole("dialog").count(), 1);
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "关闭", exact: true })
    .last()
    .click();
  await page.waitForURL((url) => !url.searchParams.has("task"));
  assert.equal(new URL(page.url()).searchParams.get("view"), "gantt");
  await page.getByRole("button", { name: "仅看逾期", exact: true }).click();
  await page.waitForURL(/overdue=1/);
  assert.equal(new URL(page.url()).searchParams.get("view"), "gantt");
  await page.getByRole("button", { name: "清空筛选", exact: true }).click();
  await page.waitForURL((url) => !url.searchParams.has("overdue"));
  assert.equal(new URL(page.url()).searchParams.get("view"), "gantt");
  check(
    "List and Gantt share one task detail panel; filter changes and resets preserve the selected view",
  );
  await page.screenshot({
    path: path.join(dir, "project-gantt-1440.png"),
    fullPage: true,
  });
  await openSaved();
  await page
    .getByLabel("已保存的筛选", { exact: true })
    .selectOption({ label: "验收：我的列表" });
  await page.getByRole("button", { name: "应用筛选", exact: true }).click();
  await page.waitForURL((url) => url.searchParams.get("view") === "list");
  assert.equal(new URL(page.url()).searchParams.get("sort"), "due");
  await page.screenshot({
    path: path.join(dir, "project-list-1440.png"),
    fullPage: true,
  });
  if (otherProject) {
    await page.goto(origin + `/projects/${otherProject}`);
    await openSaved();
    assert.equal(
      await page.getByLabel("已保存的筛选").locator("option").count(),
      1,
    );
    await page.goto(origin + base);
    await openSaved();
    assert.equal(
      await page.getByLabel("已保存的筛选").locator("option").count(),
      2,
    );
    check("Saved views are isolated between projects in the same browser");
  }
  await page.goto(origin + base + "/timeline?priority=medium");
  await page.waitForURL(
    (url) => url.pathname === base && url.searchParams.get("view") === "gantt",
  );
  assert.equal(new URL(page.url()).searchParams.get("priority"), "medium");
  check("Existing timeline URL redirects to Gantt without dropping filters");
  await page.goto(origin + base + "/overview");
  const workload = page.getByRole("region", {
    name: "成员工作量",
    exact: true,
  });
  await workload.waitFor();
  if (expected)
    assert((await workload.innerText()).includes(`${expected.total} 个任务`));
  assert((await workload.innerText()).includes("主任务、子任务分别计为一条"));
  const memberRow = workload
    .locator("details")
    .filter({ hasText: account.name })
    .first();
  await memberRow.locator("summary").click();
  await memberRow
    .getByRole("link", { name: "查看此成员的全部任务", exact: true })
    .click();
  await page.getByRole("table").waitFor();
  assert(new URL(page.url()).searchParams.has("assignee"));
  check(
    "Workload shows actual task counts, explains counting and links to member-filtered tasks",
  );
  for (const width of [1440, 1366]) {
    await page.setViewportSize({ width, height: 1000 });
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth),
      width,
    );
  }
  await page.screenshot({
    path: path.join(dir, "project-list-1366.png"),
    fullPage: true,
  });
  await page.goto(origin + base + "/overview");
  await page.getByRole("region", { name: "成员工作量", exact: true }).waitFor();
  await page.screenshot({
    path: path.join(dir, "project-workload-1366.png"),
    fullPage: true,
  });
  check(
    "Project sidebar, list and workload fit 1440 and 1366 desktop viewports",
  );
  await page.goto(origin + base);
  await openSaved();
  await page
    .getByLabel("已保存的筛选")
    .selectOption({ label: "验收：我的列表" });
  await page.getByRole("button", { name: "删除筛选", exact: true }).click();
  assert.equal(
    await page.getByLabel("已保存的筛选").locator("option").count(),
    1,
  );
  check("Deleting a saved view removes preferences only");
  if (input.outsider) {
    await page.getByLabel("账户菜单").click();
    await page.getByRole("button", { name: "退出", exact: true }).click();
    await page.waitForURL("**/login*");
    await login(input.outsider);
    await page.goto(origin + base + "/overview");
    assert(!(await page.locator("body").innerText()).includes("成员工作量"));
    assert.equal(await page.locator("[data-project-sidebar]").count(), 0);
    check("Non-members cannot see project navigation or workload");
  }
  if (sql) {
    const [after] =
      await sql`select count(*)::int as total from tasks where project_id=${account.projectId}`;
    assert.equal(after.total, expected.total);
  }
  assert.deepEqual(errors, []);
  check("No browser runtime errors and no server task data changed");
  fs.writeFileSync(
    path.join(dir, "project-interaction-report.json"),
    JSON.stringify(
      {
        origin,
        production,
        accessedViaProxy: !!process.env.QA_PROXY,
        checkedAt: new Date().toISOString(),
        checks,
        runtimeErrors: errors,
        result: "passed",
      },
      null,
      2,
    ),
  );
} finally {
  await browser.close();
  if (sql) await sql.end();
}
