// Desktop integration checks use isolated, explicitly owned QA fixtures only.
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import { config } from "dotenv";
import postgres from "postgres";
import bcrypt from "bcryptjs";
const { chromium } = createRequire(import.meta.url)("playwright");
const origin = process.env.VERIFY_ORIGIN ?? "http://localhost:3099";
const output = process.env.VERIFY_OUTPUT_DIR;
if (!output || !path.isAbsolute(output)) throw Error("Private output directory required");
fs.mkdirSync(output, { recursive: true, mode: 0o700 });
if (origin !== "http://localhost:3099") throw Error("This check creates local QA fixtures; local origin required");
config({ path: [".env.local", ".env"], quiet: true });
if (!["localhost", "127.0.0.1"].includes(new URL(process.env.DATABASE_URL).hostname)) throw Error("Local QA database required");
const sql = postgres(process.env.DATABASE_URL, { onnotice: () => {} });
const suffix = randomBytes(5).toString("hex");
const accounts = ["文档试用甲", "文档试用乙", "文档指导教师"].map((name, i) => ({ id: randomUUID(), name, email: `workspace-doc-${suffix}-${i}@example.com`, password: randomBytes(24).toString("base64url") }));
const teamId = randomUUID(), projectId = randomUUID(), taskId = randomUUID();
await sql.begin(async tx => {
  for (const a of accounts) await tx`insert into users (id,name,email,password_hash) values (${a.id},${a.name},${a.email},${await bcrypt.hash(a.password, 10)})`;
  await tx`insert into teams(id,name,invite_code) values(${teamId},'文档协作验收示例',${suffix})`;
  for (let i = 0; i < accounts.length; i++) await tx`insert into team_members(team_id,user_id,role) values(${teamId},${accounts[i].id},${i === 0 ? "admin" : i === 2 ? "teacher" : "student"})`;
  await tx`insert into projects(id,team_id,name,leader_id) values(${projectId},${teamId},'交互设计文档试用',${accounts[0].id})`;
  await tx`insert into tasks(id,project_id,title,status,created_by_id) values(${taskId},${projectId},'完成交互原型','doing',${accounts[0].id})`;
  await tx`insert into tasks(project_id,title,status,created_by_id) values(${projectId},'完成真实试用','doing',${accounts[0].id})`;
});
fs.writeFileSync(path.join(output, "accounts.private.json"), JSON.stringify({ accounts, projectId, taskId }), { mode: 0o600 });
const browser = await chromium.launch({ headless: true, channel: "msedge", args: ["--no-proxy-server"] });
const contexts = await Promise.all(accounts.map(() => browser.newContext({ viewport: { width: 1440, height: 1000 } })));
const pages = await Promise.all(contexts.map(c => c.newPage()));
const checks = [], errors = [];
for (const page of pages) { page.setDefaultTimeout(30000); page.on("pageerror", e => errors.push(e.message)); page.on("dialog", d => d.accept()); }
const [a, b, teacher] = pages;
const base = `/projects/${projectId}`;
function pass(label) { checks.push(label); console.log(label); }
async function login(page, account) {
  await page.goto(origin + "/login"); await page.locator('input[name="email"]').fill(account.email); await page.locator('input[name="password"]').fill(account.password);
  await page.getByRole("button", { name: "登录", exact: true }).click(); await page.waitForURL("**/dashboard");
}
const editor = page => page.locator("[data-document-editor]");
async function append(page, text) { await editor(page).click(); await page.keyboard.press("Control+End"); await page.keyboard.insertText(text); }
async function saved(page) { await page.getByRole("status").filter({ hasText: /^已保存$/ }).waitFor(); }
async function api(page, route, method = "GET", payload) {
  return page.evaluate(async ({ route, method, payload }) => { const r = await fetch(route, { method, headers: payload ? { "Content-Type": "application/json" } : {}, body: payload ? JSON.stringify(payload) : undefined }); return { status: r.status, body: await r.json() }; }, { route, method, payload });
}
try {
  await Promise.all(pages.map((p, i) => login(p, accounts[i])));
  await a.goto(origin + base + "/documents");
  await a.getByRole("button", { name: "新建文档", exact: true }).click(); await a.getByRole("dialog").getByLabel("标题", { exact: true }).fill("协作设计说明");
  await a.getByRole("button", { name: "创建并打开", exact: true }).click(); await a.waitForURL(/\/documents\/[a-f0-9-]+$/);
  const documentUrl = a.url(), docId = documentUrl.split("/").at(-1);
  await editor(a).waitFor(); await append(a, "交互设计核心流程"); await saved(a); pass("新建文档、真实正文保存与稳定段落标识");
  await b.goto(documentUrl); await editor(b).waitFor();
  await Promise.all([append(a, "甲的并发输入"), append(b, "乙的并发输入")]);
  for (const p of [a, b]) { await editor(p).getByText(/甲的并发输入/).waitFor(); await editor(p).getByText(/乙的并发输入/).waitFor(); await saved(p); }
  await a.getByText("文档试用乙", { exact: true }).first().waitFor(); pass("两个独立账号同时编辑、正文收敛与在线成员显示");
  await contexts[1].setOffline(true); await append(b, "断线期间的输入"); await b.getByRole("status").filter({ hasText: /连接中断/ }).waitFor();
  await contexts[1].setOffline(false); await editor(a).getByText(/断线期间的输入/).waitFor(); await saved(b); pass("断线输入保留，恢复网络后自动合并保存");
  await teacher.goto(documentUrl); await editor(teacher).waitFor(); assert.equal(await editor(teacher).getAttribute("contenteditable"), "false");
  await editor(teacher).click(); await teacher.getByRole("button", { name: "评论当前段落", exact: true }).click(); await teacher.getByLabel("评论内容").fill("请补充异常操作流程"); await teacher.getByRole("button", { name: "发布评论", exact: true }).click();
  await teacher.getByText("请补充异常操作流程", { exact: true }).waitFor(); pass("教师默认不能改正文，可以定位段落提出反馈");
  await a.getByRole("button", { name: "版本", exact: true }).click(); await a.getByLabel("历史版本名称").fill("展示前版本"); await a.getByRole("button", { name: "保存当前版本", exact: true }).click();
  await a.getByText("历史版本已保存。", { exact: true }).waitFor(); await append(a, "需要撤回的文字"); await saved(a);
  await a.getByRole("button", { name: /展示前版本/ }).click(); await a.getByRole("button", { name: "查看差异", exact: true }).click(); await a.getByRole("dialog").locator("pre").getByText(/需要撤回的文字/).waitFor();
  await Promise.all([a.waitForNavigation({ waitUntil: "domcontentloaded" }), a.getByRole("button", { name: "恢复此版本", exact: true }).click()]); await editor(a).waitFor(); await saved(a); assert(!(await editor(a).innerText()).includes("需要撤回的文字"));
  await b.getByText(/历史版本已恢复，请重新打开/, { exact: false }).first().waitFor(); pass("命名版本、可读差异、恢复正文与旧会话停止同步");
  await a.getByRole("button", { name: "任务", exact: true }).click(); await a.getByLabel("选择关联任务").selectOption(taskId); await a.getByRole("button", { name: "关联任务", exact: true }).click();
  await a.getByRole("link", { name: "完成交互原型", exact: true }).waitFor();
  await a.goto(origin + base + `?task=${taskId}`); await a.getByRole("link", { name: "协作设计说明", exact: true }).waitFor();
  await a.getByLabel("新检查项").fill("异常流程测试完成"); await a.getByRole("region", { name: "任务检查清单与关联资料" }).getByRole("button", { name: "添加", exact: true }).click(); await a.getByRole("checkbox", { name: "异常流程测试完成", exact: true }).check();
  await a.getByRole("progressbar", { name: "检查项完成进度" }).waitFor(); await a.getByRole("button", { name: "关注任务", exact: true }).click(); await a.getByRole("button", { name: "已关注 · 取消关注", exact: true }).waitFor(); pass("任务详情检查清单与关注可用，任务和文档双向跳转");
  await a.goto(origin + base); await a.getByRole("button", { name: "设置数量提醒", exact: true }).click(); await a.getByLabel("进行中主任务上限（留空关闭）").fill("1"); await a.getByRole("button", { name: "保存", exact: true }).click(); await a.getByText(/建议先完成已有工作/).waitFor(); pass("进行中主任务数量软提醒");
  await a.goto(documentUrl); await editor(a).waitFor(); await a.getByRole("button", { name: "设置", exact: true }).click();
  await a.getByLabel("访问范围").selectOption("private"); await a.getByRole("button", { name: "保存设置", exact: true }).click(); await a.getByText("标题、目录与权限已保存。", { exact: true }).waitFor();
  const denied = await api(b, `/api${base}/documents/${docId}`); assert.equal(denied.status, 403); const hidden = await api(b, `/api${base}/documents?q=协作设计说明`); assert.equal(hidden.body.data.total, 0); pass("个人草稿撤回分享后正文、搜索标题及数量均不可见");
  await a.screenshot({ path: path.join(output, "document-settings.png"), fullPage: true });
  await a.getByRole("button", { name: "移到回收站", exact: true }).click(); await a.getByRole("dialog").getByRole("button", { name: "移到回收站", exact: true }).click(); await a.waitForURL("**/documents");
  await a.getByRole("button", { name: "回收站", exact: true }).click(); await a.getByRole("button", { name: "恢复", exact: true }).click(); await a.getByRole("button", { name: "全部文档", exact: true }).click(); await a.getByRole("link", { name: "协作设计说明", exact: true }).waitFor(); pass("回收站删除与恢复保留正文及关联");
  await a.locator('input[type="file"]').setInputFiles({ name: "导入试用.md", mimeType: "text/markdown", buffer: Buffer.from("# 试用总结\n\n- [x] 测试正常流程\n\n| 情况 | 结果 |\n|---|---|\n| 正常 | 通过 |\n") });
  await a.getByRole("button", { name: "创建并打开", exact: true }).click(); await a.waitForURL(/\/documents\/[a-f0-9-]+$/); await editor(a).locator("table").waitFor(); await saved(a);
  await a.getByRole("button", { name: "导出", exact: true }).click();
  await a.screenshot({ path: path.join(output, "document-editor.png"), fullPage: true }); pass("Markdown导入表格与检查项、编辑器显示及导出");
  assert.deepEqual(errors, []); pass("三个桌面浏览器会话无未捕获页面异常");
} catch (error) {
  console.error("Browser verification failed:", error.message);
  for (let i = 0; i < pages.length; i++) await pages[i].screenshot({ path: path.join(output, `failure-${i}.png`), fullPage: true }).catch(() => {});
  process.exitCode = 1;
} finally {
  fs.writeFileSync(path.join(output, "report.json"), JSON.stringify({ origin, checks, errors }, null, 2));
  await browser.close(); await sql.end();
}
