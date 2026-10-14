import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
const config = JSON.parse(fs.readFileSync(process.env.TASK_QA_CONFIG));
const demo = JSON.parse(fs.readFileSync(process.env.TASK_QA_MANIFEST));
const origin = config.origin.replace(/\/$/, "");
const local = /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin);
if (!local && (origin !== "https://weidu-agilecampus.pw" || process.env.ALLOW_PRODUCTION_QA !== "true")) throw Error("Owned demo verification only");
assert(config.accounts.every(a => a.email === `${a.role}.demo@weidu-agilecampus.pw`));
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const browser = await chromium.launch({ channel: "msedge", headless: true, args: ["--no-proxy-server"] });
const output = path.resolve(process.env.TASK_QA_OUTPUT || ".next/functional-bug-audit");
fs.mkdirSync(output, { recursive: true });
const checks = [], errors = [], pages = {};
const clean = value => config.accounts.reduce((s, a) => s.replaceAll(a.password, "[hidden]"), String(value));
const base = `/projects/${demo.project.id}`, team = `/teams/${demo.team.id}`;
const studentId = demo.accounts.find(a => a.role === "student").id;
function pass(message) { checks.push(message); console.log(message); }
async function visit(page, route) {
  const response = await page.goto(origin + route);
  assert(response && response.status() < 400, route);
  await page.locator("main").first().waitFor();
}
const getDrawer = page => page.getByRole("dialog", { name: "任务详情", exact: true });
async function closeDrawer(page) {
  await getDrawer(page).locator("aside > header").getByRole("button", { name: "关闭", exact: true }).click();
  await getDrawer(page).waitFor({ state: "detached" });
}
const failedRequest = route => route.request().method() === "POST" && route.request().headers()["next-action"] ? route.abort("failed") : route.continue();
try {
  for (const account of config.accounts) {
    const context = await browser.newContext({ viewport: { width: 1366, height: 900 }, timezoneId: "UTC" });
    const page = await context.newPage(); pages[account.role] = page;
    page.setDefaultTimeout(45000); page.on("pageerror", error => errors.push(clean(error.message)));
    page.on("console", message => {
      if (/Encountered two children with the same key|Hydration failed|Minified React error/.test(message.text())) errors.push(clean(message.text()));
    });
    await page.goto(origin + "/login");
    await page.locator('[name="email"]').fill(account.email);
    await page.locator('[name="password"]').fill(account.password);
    await page.getByRole("button", { name: "登录", exact: true }).click();
    await page.waitForURL("**/dashboard");
    const routes = ["/dashboard", "/projects", "/teams", "/notifications", "/settings", "/settings/profile", "/help", "/schedule",
      base, base+"/overview", base+"/iterations", base+"/iterations/"+demo.iterations.active,
      base+"/iterations/"+demo.iterations.completed, base+"/documents", base+"/documents/"+demo.documents.collaboration,
      base+"/deliverables", base+"/deliverables/"+demo.deliverables.history, base+"/announcements", base+"/references",
      base+"/personal-plan", base+"/reports", base+"/evidence", base+"/evidence/process", base+"/timeline",
      team+"/members", team+"/projects", team+"/labels", team+"/availability", team+"/resources", `/people/${studentId}`];
    for (const route of routes) await visit(page, route);
    pass(`${account.role}：30 个主要页面正常打开，没有页面异常`);
    await visit(page, "/dashboard");
    const entry = page.locator("a.workspace-task").first();
    if (await entry.count()) await entry.click();
    else await visit(page, base+`?task=${demo.tasks.prototype}`);
    await getDrawer(page).waitFor();
    await getDrawer(page).getByRole("heading", { level: 3 }).waitFor();
    await page.waitForFunction(() => !!document.activeElement?.closest('[role="dialog"]'));
    for (let i = 0; i < 65; i++) {
      await page.keyboard.press(i % 3 === 0 ? "Shift+Tab" : "Tab");
      assert(await page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]')));
    }
    assert.equal(await page.evaluate(() => document.body.style.overflow), "hidden");
    if (account.role === "teacher") {
      await getDrawer(page).getByText("你的角色只能查看任务。", { exact: true }).waitFor();
      assert.equal(await getDrawer(page).getByRole("button", { name: "保存标签与依赖", exact: true }).count(), 0);
    }
    await closeDrawer(page);
    assert.notEqual(await page.evaluate(() => document.body.style.overflow), "hidden");
    pass(`${account.role}：侧栏限制键盘焦点、恢复滚动，原权限保持`);
  }
  const page = pages.student;
  await visit(page, "/notifications");
  const mention = page.locator('a[href*="comment="]').first();
  assert(await mention.count(), "The fixture must include a comment notification");
  const commentId = new URL(await mention.getAttribute("href"), origin).searchParams.get("comment");
  await mention.click();
  assert.equal(new URL(page.url()).pathname, "/notifications");
  assert.equal(new URL(page.url()).searchParams.get("comment"), commentId);
  await getDrawer(page).locator(`#comment-${commentId}`).waitFor();
  await closeDrawer(page); assert.equal(new URL(page.url()).searchParams.get("comment"), null);
  pass("评论通知定位到指定评论，关闭后返回通知列表");

  // Mutating and fault-injection scenarios are confined to the isolated local database.
  if (local) {
    await visit(page, "/dashboard");
    await page.route("**/*", failedRequest);
    await page.locator("a.workspace-task").first().click();
    await getDrawer(page).getByRole("alert").getByText("任务详情加载失败，请重试", { exact: true }).waitFor();
    await page.unroute("**/*", failedRequest);
    await getDrawer(page).getByRole("button", { name: "重试", exact: true }).click();
    await getDrawer(page).getByRole("textbox", { name: "标题", exact: true }).waitFor();
    await closeDrawer(page);
    pass("详情断网显示失败提示，恢复网络后可重试");

    await visit(page, base);
    const title = "本地回归任务 " + Date.now();
    const create = page.locator("form").filter({ has: page.getByRole("button", { name: "创建任务", exact: true }) });
    await create.locator('[name="title"]').fill(title);
    await create.locator('[name="description"]').fill("保存标签时应保留此描述");
    await create.locator('[name="assigneeId"]').selectOption(studentId);
    await create.locator('[name="priority"]').selectOption("high");
    await create.locator('[name="startDate"]').fill("2026-10-14");
    await create.locator('[name="dueDate"]').fill("2026-10-20");
    await create.getByRole("button", { name: "创建任务", exact: true }).click();
    await page.getByRole("button", { name: title, exact: true }).first().click();
    const dialog = getDrawer(page);
    async function saveAssociations(labels, successors) {
      const form = dialog.locator("form").filter({ has: page.getByRole("button", { name: "保存标签与依赖", exact: true }) });
      const previous = await form.elementHandle();
      await form.locator('[name="labelIds"]').selectOption(labels);
      await form.locator('[name="successorIds"]').selectOption(successors);
      await form.getByRole("button", { name: "保存标签与依赖", exact: true }).click();
      await page.waitForFunction(el => !el.isConnected, previous);
    }
    const label = await dialog.locator('[name="labelIds"] option').first().getAttribute("value");
    await saveAssociations([label], [demo.tasks.prototype]);
    assert.equal(await dialog.getByRole("textbox", { name: "描述", exact: true }).inputValue(), "保存标签时应保留此描述");
    assert.equal(await dialog.locator('[name="assigneeId"]').inputValue(), studentId);
    assert.equal(await dialog.locator('[name="priority"]').inputValue(), "high");
    assert.equal(await dialog.locator('[name="dueDate"]').inputValue(), "2026-10-20");
    await saveAssociations([], []);
    pass("创建任务、连续保存和清空标签与依赖正常，普通字段保留");

    await page.route("**/*", failedRequest);
    const titleInput = dialog.getByRole("textbox", { name: "标题", exact: true });
    await titleInput.fill(title + " 输入保留");
    await dialog.getByRole("button", { name: "保存", exact: true }).click();
    await dialog.getByRole("alert").filter({ hasText: "输入已保留" }).waitFor();
    assert.equal(await titleInput.inputValue(), title + " 输入保留");
    assert(await dialog.getByRole("button", { name: "保存", exact: true }).isEnabled());
    await dialog.getByRole("textbox", { name: "标记阻塞", exact: true }).fill("本地断网检查");
    await dialog.getByRole("button", { name: "标记为阻塞", exact: true }).click();
    await dialog.getByRole("alert").filter({ hasText: "阻塞状态保存未确认" }).waitFor();
    assert(await dialog.getByRole("button", { name: "标记为阻塞", exact: true }).isEnabled());
    page.once("dialog", d => d.accept());
    await dialog.getByRole("button", { name: "删除任务", exact: true }).click();
    await dialog.getByRole("alert").filter({ hasText: "删除结果暂时无法确认" }).waitFor();
    assert(await dialog.getByRole("button", { name: "删除任务", exact: true }).isEnabled());
    await page.unroute("**/*", failedRequest);
    pass("保存、阻塞和删除断网时不再卡住，输入保留且按钮恢复");
    await titleInput.fill(title);
    const previousInput = await titleInput.elementHandle();
    await dialog.getByRole("button", { name: "保存", exact: true }).click();
    await page.waitForFunction(el => !el.isConnected, previousInput);
    await closeDrawer(page);
    await page.getByRole("button", { name: title, exact: true }).first().click();
    await dialog.getByRole("textbox", { name: "标题", exact: true }).waitFor();
    page.once("dialog", d => d.accept());
    await dialog.getByRole("button", { name: "删除任务", exact: true }).click();
    await dialog.waitFor({ state: "detached" });
    await page.getByRole("button", { name: title, exact: true }).first().waitFor({ state: "detached" });
    pass("网络恢复后可以保存并删除本次创建的测试任务");

    const admin = pages.admin;
    await visit(admin, base);
    const milestones = admin.locator('[data-tour="milestones"]');
    const stage = "本地回归里程碑 " + Date.now();
    await milestones.locator('[name="title"]').fill(stage);
    await milestones.getByRole("button", { name: "添加", exact: true }).click();
    const remove = milestones.getByRole("button", { name: "删除里程碑 " + stage, exact: true });
    await remove.waitFor(); admin.once("dialog", d => d.accept()); await remove.click();
    await remove.waitFor({ state: "detached" });
    pass("管理员可创建和删除本次测试里程碑");
    await visit(page, team+"/resources");
    await page.getByRole("button", { name: "此刻", exact: true }).first().click();
    const entered = await page.locator('[name="startTime"]').inputValue();
    assert(Math.abs(Date.parse(entered+":00+08:00")-Date.now()) < 61000);
    pass("资源登记的此刻在 UTC 浏览器中仍填写北京时间");
  }
  assert.deepEqual(errors, []);
  fs.writeFileSync(path.join(output, "verification.json"), JSON.stringify({ origin, checkedAt: new Date().toISOString(), checks, pageErrors: errors, mutatesBusinessData: local, isolatedFixture: local }, null, 2));
  console.log(JSON.stringify({ checks: checks.length, pageErrors: errors.length }));
} catch (error) {
  fs.writeFileSync(path.join(output, "failure.json"), JSON.stringify({ checks, errors, error: clean(error.stack) }, null, 2));
  throw Error(clean(error.stack));
} finally { await browser.close(); }
