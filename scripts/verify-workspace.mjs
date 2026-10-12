// Desktop checks against owned example accounts. Local seeding never touches a remote DB.
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { config } from "dotenv";
import postgres from "postgres";
import { hash } from "bcryptjs";
const { chromium } = createRequire(import.meta.url)("playwright");
const origin = process.env.VERIFY_ORIGIN;
if (!["http://localhost:3099", "https://weidu-agilecampus.pw"].includes(origin))
  throw Error("Unsupported origin");
const production = origin.startsWith("https:");
if (production && process.env.ALLOW_PRODUCTION_QA !== "true")
  throw Error("Enable production verification explicitly");
const dir = process.env.VERIFY_OUTPUT_DIR;
if (!dir || !path.isAbsolute(dir))
  throw Error("An absolute private output directory is required");
fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
let account, outsider, sql, expected;
const checks = [],
  errors = [];
function check(label) {
  checks.push(label);
  console.log(label);
}
if (production) {
  if (!process.env.WORKSPACE_QA_ACCOUNT_FILE)
    throw Error("Specify a previously created private QA account");
  account = JSON.parse(
    fs.readFileSync(process.env.WORKSPACE_QA_ACCOUNT_FILE, "utf8"),
  );
  if (!account.email?.startsWith("deploy-check-") || !account.projectId)
    throw Error("Only an existing deployment example account is supported");
} else {
  config({ path: [".env.local", ".env"], quiet: true });
  if (
    !["localhost", "127.0.0.1"].includes(
      new URL(process.env.DATABASE_URL).hostname,
    )
  )
    throw Error("Local database required");
  sql = postgres(process.env.DATABASE_URL);
  const suffix = randomUUID().slice(0, 8),
    password = randomUUID(),
    passwordHash = await hash(password, 10);
  const owner = randomUUID(),
    student = randomUUID(),
    other = randomUUID(),
    team = randomUUID(),
    project = randomUUID(),
    second = randomUUID(),
    archived = randomUUID(),
    iteration = randomUUID();
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const day = (n) => {
    const date = new Date(today + "T00:00:00Z");
    date.setUTCDate(date.getUTCDate() + n);
    return date.toISOString().slice(0, 10);
  };
  account = {
    email: `workspace-${suffix}@example.test`,
    password,
    name: "工作台验收（示例）",
    projectId: project,
  };
  outsider = { email: `workspace-outsider-${suffix}@example.test`, password };
  fs.writeFileSync(
    path.join(dir, "workspace-accounts.private.json"),
    JSON.stringify({ account, outsider }),
    { mode: 0o600 },
  );
  const records = [
    ["补充用户访谈问题", -1, "todo", project],
    ["整理原型交互说明", 0, "doing", project],
    ["完成任务详情可用性测试", 2, "todo", project],
    ["修订项目展示材料", 3, "todo", project],
    ["补充日程隐私说明", 4, "todo", project],
    ["核对接口契约", 5, "doing", second],
    ["完善空状态提示", 6, "todo", project],
    ["补充键盘操作反馈", 7, "todo", project],
    ["对比两版导航方案", 8, "todo", project],
    ["整理阶段复盘", null, "todo", second],
  ];
  const revision = randomUUID(),
    version = randomUUID(),
    feedback = randomUUID();
  await sql.begin(async (tx) => {
    for (const [id, name, email] of [
      [owner, "验收负责人（示例）", `workspace-owner-${suffix}@example.test`],
      [student, account.name, account.email],
      [other, "隔离验收（示例）", outsider.email],
    ])
      await tx`insert into users (id,name,email,password_hash) values (${id},${name},${email},${passwordHash})`;
    await tx`insert into teams (id,name,invite_code) values (${team},'交互设计验收示例团队',${randomUUID()})`;
    for (const [id, role] of [
      [owner, "admin"],
      [student, "student"],
    ])
      await tx`insert into team_members (team_id,user_id,role) values (${team},${id},${role})`;
    for (const [id, name, status] of [
      [project, "校园协作平台 · 交互设计", "active"],
      [second, "敏捷开发 · 阶段展示", "active"],
      [archived, "已归档验收项目", "archived"],
    ])
      await tx`insert into projects (id,team_id,name,status) values (${id},${team},${name},${status})`;
    await tx`insert into iterations (id,project_id,name,goal,start_date,end_date,status,started_at) values (${iteration},${project},'第 2 轮 · 原型与试用','让同学能够独立找到任务并提交成果',${day(-2)},${day(5)},'active',now())`;
    for (const [title, n, status, id] of records)
      await tx`insert into tasks (project_id,title,due_date,assignee_id,status,priority,created_by_id,sprint_id) values (${id},${title},${n === null ? null : day(n)},${student},${status},${n === -1 ? "high" : "medium"},${owner},${id === project ? iteration : null})`;
    for (const title of ["完成页面结构", "完成第一轮调研"])
      await tx`insert into tasks (project_id,title,assignee_id,status,created_by_id,sprint_id) values (${project},${title},${student},'done',${owner},${iteration})`;
    await tx`insert into tasks (project_id,title,assignee_id,created_by_id) values (${archived},'归档任务不应出现',${student},${owner})`;
    await tx`insert into tasks (project_id,title,assignee_id,created_by_id) values (${project},'其他成员任务不应出现',${owner},${owner})`;
    for (const [title, start, end] of [
      ["交互设计 · 原型实验", "09:00", "10:30"],
      ["软件工程 · 课堂讨论", "14:00", "16:00"],
      ["小组阶段演示排练", "19:00", "20:00"],
    ])
      await tx`insert into personal_schedule_events (user_id,title,start_at,end_at,fingerprint,source) values (${student},${title},${today + "T" + start + ":00+08:00"},${today + "T" + end + ":00+08:00"},${randomUUID()},'manual')`;
    await tx`insert into personal_schedule_events (user_id,title,start_at,end_at,fingerprint,source) values (${other},'他人私人日程不应出现',${today + "T09:00:00+08:00"},${today + "T10:00:00+08:00"},${randomUUID()},'manual')`;
    await tx`insert into deliverables (id,project_id,author_id,title,type,status,creation_key,creation_hash,submitted_at) values (${revision},${project},${student},'交互原型与试用记录','prototype','changes_requested',${randomUUID()},'verification-example',now())`;
    await tx`insert into deliverable_versions (id,deliverable_id,version_number,draft_revision,submission_key,author_id,submitted_by_id,title,type,url,description) values (${version},${revision},1,1,${randomUUID()},${student},${student},'交互原型与试用记录','prototype','https://example.com/prototype','明确标注的自动化验收示例')`;
    await tx`insert into deliverable_feedback (id,project_id,deliverable_id,version_id,reviewer_id,decision,comment,request_id,request_hash) values (${feedback},${project},${revision},${version},${owner},'changes_requested','补充两位同学的试用反馈，并解释修改理由。',${randomUUID()},'verification-example')`;
  });
  expected = { project, second, revision, version, feedback };
}
const browser = await chromium.launch({
  headless: true,
  channel: "msedge",
  ...(process.env.QA_PROXY
    ? { proxy: { server: process.env.QA_PROXY } }
    : { args: ["--no-proxy-server"] }),
});
const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  }),
  page = await context.newPage();
page.setDefaultTimeout(30000);
page.setDefaultNavigationTimeout(45000);
page.on("pageerror", (e) => errors.push(e.message));
async function login(target, user) {
  await target.goto(origin + "/login");
  await target.locator('input[name="email"]').fill(user.email);
  await target.locator('input[name="password"]').fill(user.password);
  await target.getByRole("button", { name: "登录", exact: true }).click();
  await target.waitForURL("**/dashboard");
  await target.locator("#tasks").waitFor();
}
try {
  await login(page, account);
  const hint = page.getByRole("button", { name: "关闭新手提示" });
  if (await hint.count()) await hint.click();
  await page.getByRole("heading", { name: "今日日程", exact: true }).waitFor();
  assert.equal(await page.locator(".workspace-stat").count(), 4);
  assert.equal(
    await page
      .locator(".workspace-columns")
      .evaluate(
        (el) => getComputedStyle(el).gridTemplateColumns.split(" ").length,
      ),
    2,
  );
  check("Desktop workspace renders four real summary cards and two columns");
  const box = await page.locator(".workspace").boundingBox();
  assert(box.width >= 1080);
  await page.screenshot({
    path: path.join(dir, "workspace-desktop.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 1366, height: 900 });
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth),
    1366,
  );
  await page.screenshot({
    path: path.join(dir, "workspace-1366.png"),
    fullPage: true,
  });
  check("1440 and 1366 desktop layouts fit without horizontal scrolling");
  await page.getByLabel("搜索我的任务").fill("不存在的验收关键词");
  await page.getByText("没有符合筛选的任务", { exact: true }).waitFor();
  await page.getByRole("button", { name: "查看全部任务", exact: true }).click();
  assert.equal(await page.getByLabel("搜索我的任务").inputValue(), "");
  check("Task search has an explanatory empty state and reversible reset");
  if (!production) {
    const list = page.locator("#tasks");
    assert.equal(await list.locator("li").count(), 8);
    await list.getByRole("button", { name: /再显示 8 项/ }).click();
    assert.equal(await list.locator("li").count(), 10);
    check("Task list expands beyond the first eight without losing rows");
    await list.getByRole("button", { name: /^今天截止/ }).click();
    assert.equal(await list.locator("li").count(), 1);
    assert.equal(
      await list.getByRole("link", { name: /整理原型交互说明/ }).count(),
      1,
    );
    await list.getByRole("button", { name: /^全部/ }).click();
    await page.getByLabel("按项目筛选任务").selectOption(expected.second);
    assert.equal(await list.locator("li").count(), 2);
    check(
      "Deadline and project filters show only matching personal assignments",
    );
    await list.getByRole("button", { name: "清除筛选", exact: true }).click();
    await page.getByLabel("搜索我的任务").fill("访谈");
    assert.equal(await list.locator("li").count(), 1);
    await list.getByRole("button", { name: "清除筛选", exact: true }).click();
    assert.equal(
      await page.getByText("他人私人日程不应出现", { exact: true }).count(),
      0,
    );
    assert.equal(
      await page.getByText("归档任务不应出现", { exact: true }).count(),
      0,
    );
    assert.equal(
      await page.getByText("其他成员任务不应出现", { exact: true }).count(),
      0,
    );
    await page.getByText("09:00 — 10:30", { exact: true }).waitFor();
    await page
      .getByText("补充两位同学的试用反馈，并解释修改理由。", { exact: false })
      .waitFor();
    assert.equal(
      await page.locator("#revisions a").first().getAttribute("href"),
      `/projects/${expected.project}/deliverables/${expected.revision}?versionId=${expected.version}&feedbackId=${expected.feedback}`,
    );
    check(
      "Personal schedule privacy, archived task exclusion and exact feedback links",
    );
  }
  await page.keyboard.press("Control+k");
  await page.getByRole("dialog", { name: "快速查找", exact: true }).waitFor();
  assert.equal(
    await page
      .getByLabel("快速查找关键词")
      .evaluate((el) => document.activeElement === el),
    true,
  );
  await page.getByLabel("快速查找关键词").fill("不匹配的快速搜索");
  await page
    .getByText("没有找到匹配内容。可在项目页查找其他任务。", { exact: true })
    .waitFor();
  await page.getByLabel("快速查找关键词").fill("我的课表");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await page.waitForURL("**/schedule");
  check(
    "Open-source command menu supports Ctrl K, Chinese search and keyboard navigation",
  );
  await page.goto(origin + "/dashboard");
  await page.getByRole("button", { name: "快速查找任务或项目" }).click();
  await page.keyboard.press("Escape");
  await page
    .getByRole("dialog", { name: "快速查找" })
    .waitFor({ state: "hidden" });
  assert.equal(
    await page
      .getByRole("button", { name: "快速查找任务或项目" })
      .evaluate((el) => document.activeElement === el),
    true,
  );
  check("Escape closes command menu and restores trigger focus");
  await page.getByRole("button", { name: "刷新工作台" }).click();
  await page.getByText("已更新", { exact: true }).waitFor();
  check("Refresh exposes completion feedback");
  if (!production) {
    await page.locator(".workspace-focus-action").click();
    await page.waitForURL("**?task=*");
    await page.getByRole("dialog", { name: "任务详情", exact: true }).waitFor();
    check("Focus action opens the existing real task detail workflow");
    const otherContext = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
    });
    const otherPage = await otherContext.newPage();
    await login(otherPage, outsider);
    await otherPage.getByText("暂无待处理任务", { exact: true }).waitFor();
    assert.equal(
      await otherPage
        .getByText("校园协作平台 · 交互设计", { exact: true })
        .count(),
      0,
    );
    await otherPage
      .getByText("他人私人日程不应出现", { exact: true })
      .waitFor();
    await otherPage.screenshot({
      path: path.join(dir, "workspace-empty.png"),
      fullPage: true,
    });
    await otherContext.close();
    check(
      "Second account receives its own schedule and accessible empty project state",
    );
  }
  assert.deepEqual(errors, []);
  check("No uncaught browser errors");
  fs.writeFileSync(
    path.join(dir, "workspace-report.json"),
    JSON.stringify(
      { origin, desktopOnly: true, exampleData: true, checks, errors },
      null,
      2,
    ),
  );
} finally {
  await browser.close();
  if (sql) await sql.end();
}
