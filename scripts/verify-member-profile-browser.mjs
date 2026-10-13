import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
const config = JSON.parse(fs.readFileSync(process.env.PROFILE_ACCOUNTS_FILE));
const demo = JSON.parse(fs.readFileSync(process.env.PROFILE_MANIFEST_FILE));
const origin = config.origin, local = ["localhost", "127.0.0.1"].includes(new URL(origin).hostname);
if (!local && (origin !== "https://weidu-agilecampus.pw" || process.env.ALLOW_PRODUCTION_QA !== "true")) throw Error("Explicit owned production demo verification required");
assert.equal(config.accounts.length, 3);
assert(config.accounts.every(a => a.email === `${a.role}.demo@weidu-agilecampus.pw`));
assert.equal(demo.team.name, "唯笃队·课堂演示（模拟数据）");
const output = path.resolve(process.env.PROFILE_OUTPUT || ".next/member-profile-verification");
fs.mkdirSync(output, { recursive: true });
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const browser = await chromium.launch({ channel: "msedge", headless: true, args: ["--no-proxy-server"] });
const errors = [], checks = [], contexts = [], pages = {};
const clean = value => config.accounts.reduce((s, a) => s.replaceAll(a.password, "[hidden]"), String(value));
const tid = demo.team.id, studentId = demo.accounts.find(a => a.role === "student").id;
const route = `/people/${studentId}?team=${tid}`;
function pass(check) { checks.push(check); console.log(check); }
async function visit(page, url, title) { const response = await page.goto(origin + url); assert(response.status() < 400); if (title) await page.getByRole("heading", { name: title, exact: true }).first().waitFor(); }
async function save(page) {
  const previous = Number(await page.locator('input[name="expectedRevision"]').inputValue());
  await page.getByRole("button", { name: "保存个人资料", exact: true }).click();
  await page.waitForFunction(revision => Number(document.querySelector('input[name="expectedRevision"]')?.value) === revision + 1, previous);
}
let original;
async function restoreStudent() {
  if (!original) return;
  const page = pages.student;
  await visit(page, "/settings/profile", "编辑个人资料");
  for (const [name, value] of Object.entries(original)) {
    if (name === "avatarColor") await page.locator(`input[name="avatarColor"][value="${value}"]`).check();
    else await page.locator(`[name="${name}"]`).fill(value);
  }
  await save(page); original = undefined;
}
try {
  for (const account of config.accounts) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } }); contexts.push(context);
    const page = await context.newPage(); pages[account.role] = page; page.setDefaultTimeout(45000);
    page.on("pageerror", e => errors.push(clean(e.message)));
    await page.goto(origin + "/login"); await page.locator('input[name="email"]').fill(account.email); await page.locator('input[name="password"]').fill(account.password);
    await page.getByRole("button", { name: "登录", exact: true }).click(); await page.waitForURL("**/dashboard");
    await page.getByLabel("账户菜单", { exact: true }).click(); await page.getByRole("link", { name: "我的主页", exact: true }).click();
    await page.getByRole("heading", { name: account.name, exact: true }).waitFor();
  }
  pass("三个真实账号通过账户菜单进入自己的个人主页");
  const { admin, student, teacher } = pages;
  for (const role of ["admin", "student", "teacher"]) {
    await visit(pages[role], `/teams/${tid}/members`, "团队成员");
    assert.equal(await pages[role].locator("[data-member-card]").count(), 3);
    assert.equal(await pages[role].getByRole("button", { name: "保存角色", exact: true }).count(), role === "admin" ? 2 : 0);
  }
  pass("成员卡片向全组开放，管理员独有的角色操作保留");
  await teacher.getByLabel("搜索成员或技能", { exact: true }).fill("交互设计");
  await teacher.getByRole("button", { name: "筛选成员", exact: true }).click();
  await teacher.waitForURL(url => url.searchParams.get("q") === "交互设计");
  assert.equal(await teacher.locator("[data-member-card]").count(), 1);
  await teacher.getByRole("link", { name: "查看个人主页", exact: true }).click();
  await teacher.getByRole("heading", { name: "演示学生", exact: true }).waitFor();
  assert.equal(await teacher.getByRole("link", { name: "编辑个人资料", exact: true }).count(), 0);
  await teacher.getByRole("heading", { name: "近期协作记录", exact: true }).waitFor();
  pass("技能检索可定位成员，访问他人主页可看介绍和真实记录，不能编辑");
  await teacher.getByRole("navigation", { name: "个人主页分区" }).getByRole("link", { name: "任务", exact: true }).click();
  await teacher.getByRole("navigation", { name: "任务状态筛选" }).getByRole("link", { name: /^逾期/ }).click();
  await teacher.waitForFunction(() => document.querySelector('nav[aria-label="任务状态筛选"] a[aria-current="page"]')?.textContent?.startsWith("逾期"));
  await teacher.getByText("补齐键盘操作检查（逾期演示）", { exact: true }).waitFor();
  assert.equal(await teacher.getByText("归档成果整理（演示）", { exact: true }).count(), 0);
  pass("个人任务按实际负责人汇总，逾期筛选排除已完成任务");
  await teacher.getByRole("navigation", { name: "个人主页分区" }).getByRole("link", { name: "成果", exact: true }).click();
  await teacher.getByText("需求分析报告（版本与重交演示）", { exact: true }).waitFor();
  assert.equal(await teacher.getByText("展示 PPT 草稿（演示）", { exact: true }).count(), 0);
  assert.equal(await teacher.getByText("学生个人草稿（权限演示）", { exact: true }).count(), 0);
  await teacher.getByRole("link").filter({ hasText: "需求分析报告（版本与重交演示）" }).click();
  await teacher.waitForURL(`**/deliverables/${demo.deliverables.history}`);
  pass("个人成果页可进入正式成果，未提交草稿与私有文档不显示");
  assert.equal((await teacher.request.get(origin + `/people/${studentId}?team=${randomUUID()}`)).status(), 404);
  assert.equal((await teacher.request.get(origin + `/people/${randomUUID()}`)).status(), 404);
  const anonymous = await browser.newContext();
  const response = await anonymous.request.get(origin + route, { maxRedirects: 0 });
  assert([302, 303, 307, 308].includes(response.status())); await anonymous.close();
  pass("无效团队或未知用户返回 404，未登录访问跳转登录");
  await visit(student, "/settings/profile", "编辑个人资料");
  original = {};
  for (const name of ["name", "bio", "skills", "avatarLabel"]) original[name] = await student.locator(`[name="${name}"]`).inputValue();
  original.avatarColor = await student.locator('input[name="avatarColor"]:checked').inputValue();
  await student.locator('[name="name"]').fill("演示学生（资料预演）");
  await student.locator('[name="bio"]').fill(original.bio + "\n已通过网页验证资料编辑。");
  await student.locator('[name="skills"]').fill(original.skills + "，页面设计");
  await student.locator('input[name="avatarColor"][value="rose"]').check();
  await save(student);
  await visit(teacher, route, "演示学生（资料预演）");
  await teacher.getByText("页面设计", { exact: true }).waitFor();
  await visit(student, "/dashboard");
  await student.getByRole("heading", { name: /你好，演示学生（资料预演）/ }).waitFor();
  pass("本人可编辑资料，同组访问者和工作台显示更新后的姓名与技能");
  await visit(student, "/settings/profile", "编辑个人资料");
  const revision = await student.locator('input[name="expectedRevision"]').inputValue();
  await student.locator('[name="skills"]').fill(Array.from({ length: 13 }, (_, i) => `技能${i}`).join("，"));
  await student.getByRole("button", { name: "保存个人资料", exact: true }).click();
  await student.getByRole("alert").getByText("最多填写 12 个技能", { exact: true }).waitFor();
  assert.equal(await student.locator('input[name="expectedRevision"]').inputValue(), revision);
  assert((await student.locator('[name="skills"]').inputValue()).includes("技能12"));
  await restoreStudent();
  pass("校验失败保留输入，预演后恢复原演示资料");
  for (const width of [1366, 1440]) {
    await student.setViewportSize({ width, height: 1000 });
    for (const url of [`/teams/${tid}/members`, route, "/settings/profile"]) {
      await visit(student, url);
      assert.equal(await student.evaluate(() => document.documentElement.scrollWidth), width, "Desktop horizontal overflow");
    }
  }
  await visit(student, route, "演示学生"); await student.screenshot({ path: path.join(output, "student-profile.png"), fullPage: true });
  await visit(admin, `/teams/${tid}/members`, "团队成员"); await admin.screenshot({ path: path.join(output, "member-directory.png"), fullPage: true });
  assert.deepEqual(errors, []); pass("1366 与 1440 桌面版面无横向溢出，浏览器没有未捕获异常");
} catch (error) {
  console.error(clean(error.message)); process.exitCode = 1;
  for (const [role, page] of Object.entries(pages)) await page.screenshot({ path: path.join(output, `${role}-failure.png`), fullPage: true }).catch(() => {});
} finally {
  await restoreStudent().catch(error => { console.error("Demo restoration: " + clean(error.message)); process.exitCode = 1; });
  fs.writeFileSync(path.join(output, "verification.json"), JSON.stringify({ checks, errors }, null, 2));
  await browser.close();
}
