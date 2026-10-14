// Mutating checks run only on a local server with separately prepared owned fixtures.
// Production mode reads existing demonstration documents without editing them.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
const { chromium } = await import(process.env.VERIFY_PLAYWRIGHT_MODULE ?? 'playwright');
const origin = process.env.VERIFY_ORIGIN ?? 'http://localhost:3008';
const readOnly = process.env.VERIFY_DOCUMENT_READ_ONLY === 'true';
if (readOnly ? origin !== 'https://weidu-agilecampus.pw' : origin !== 'http://localhost:3008') throw Error('Origin and check mode do not match.');
const output = process.env.VERIFY_OUTPUT_DIR;
if (!output || !path.isAbsolute(output)) throw Error('Private absolute output directory required.');
fs.mkdirSync(output, { recursive: true });
const credentials = JSON.parse(fs.readFileSync(process.env.VERIFY_CREDENTIALS_FILE, 'utf8'));
const manifest = JSON.parse(fs.readFileSync(process.env.VERIFY_MANIFEST_FILE, 'utf8'));
const projectId = manifest.project.id;
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: readOnly ? [] : ['--no-proxy-server'], ...(process.env.VERIFY_BROWSER_PROXY ? { proxy: { server: process.env.VERIFY_BROWSER_PROXY } } : {}) });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, permissions: ['clipboard-read', 'clipboard-write'] });
const page = await context.newPage(); page.setDefaultTimeout(30000);
const errors = [], checks = [], createdIds = [];
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error' && !/Failed to load resource/.test(message.text())) errors.push(message.text().slice(0, 1500)); });
const editor = () => page.locator('[data-document-editor]');
const apiBase = `/api/projects/${projectId}/documents`;
async function api(route, method = 'GET', data) {
  return page.evaluate(async ({ route, method, data }) => {
    const r = await fetch(route, { method, ...(data ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) } : {}) });
    return { status: r.status, value: await r.json() };
  }, { route, method, data });
}
function pass(label) { checks.push(label); console.log(label); }
async function login(role, target = page) {
  const account = credentials.accounts.find(item => item.role === role);
  await target.goto(origin + '/login'); await target.locator('[name=email]').fill(account.email); await target.locator('[name=password]').fill(account.password);
  await target.getByRole('button', { name: '登录', exact: true }).click(); await target.waitForURL('**/dashboard');
}
async function create(title, template = '') {
  await page.goto(`${origin}/projects/${projectId}/documents`);
  await page.getByRole('button', { name: '新建文档', exact: true }).click();
  await page.getByLabel('文档模板').selectOption(template); await page.getByRole('dialog').getByLabel('标题', { exact: true }).fill(title);
  await page.getByRole('button', { name: '创建并打开', exact: true }).click(); await page.waitForURL(/\/documents\/[a-f\d-]+$/); await editor().waitFor();
  const id = page.url().split('/').at(-1); createdIds.push(id); return id;
}
async function saved(id, text) {
  await page.waitForFunction(async ({ route, text }) => {
    const r = await fetch(route); if (!r.ok) return false;
    const v = await r.json(); return JSON.stringify(v.data.content).includes(text);
  }, { route: `${apiBase}/${id}`, text });
  await page.getByRole('status').filter({ hasText: /^已保存$/ }).waitFor();
}
try {
  await login('student');
  if (!readOnly) {
    for (const [template, expected] of [['requirements', '用户与使用场景'], ['design', '异常与空状态'], ['trial', '修复与复测'], ['retrospective', '下一轮行动']]) {
      const id = await create('文档交互验收-' + template, template); await saved(id, expected);
      assert((await page.getByRole('navigation', { name: '正文目录', exact: true }).innerText()).includes(expected));
    }
    pass('四种课程模板生成真实可编辑正文，标题自动进入目录');
    const id = await create('文档交互验收-编辑操作'); const url = page.url();
    await editor().click(); await page.keyboard.insertText('已有说明 /h2');
    await page.getByRole('listbox', { name: '快捷插入' }).getByRole('option', { name: '二级标题', exact: true }).waitFor(); await page.keyboard.press('Enter');
    await editor().locator('h2').getByText('已有说明', { exact: true }).waitFor(); assert(!(await editor().innerText()).includes('/h2'));
    pass('搜索快捷词并按 Enter 插入，仅删除命令本身，保留原有正文');
    await page.keyboard.press('End'); await page.keyboard.press('Enter'); await page.keyboard.press('Enter'); await page.keyboard.insertText('/');
    await page.getByRole('listbox', { name: '快捷插入' }).waitFor(); await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter');
    await page.keyboard.insertText('键盘三级标题'); await saved(id, '键盘三级标题'); await editor().locator('h3').getByText('键盘三级标题', { exact: true }).waitFor();
    pass('方向键选择插入项，创建正确的三级标题并保存');
    await page.keyboard.press('End'); await page.keyboard.press('Enter'); await page.keyboard.press('Enter'); await page.keyboard.insertText('/没有这个功能');
    await page.getByText('未找到匹配项，按 Esc 继续输入正文。', { exact: true }).waitFor(); await page.keyboard.press('Escape');
    assert.equal(await page.getByRole('listbox', { name: '快捷插入' }).count(), 0); assert((await editor().innerText()).includes('/没有这个功能'));
    pass('无匹配项与 Escape 关闭不会吞掉用户输入');
    await editor().click(); await page.keyboard.press('Control+Home'); await page.keyboard.press('Shift+End');
    await page.getByRole('toolbar', { name: '选中文字操作' }).waitFor(); await page.getByRole('button', { name: '选区加粗', exact: true }).click();
    await editor().locator('h2 strong').getByText('已有说明', { exact: true }).waitFor();
    await page.getByRole('button', { name: '评论选区', exact: true }).click(); await page.getByLabel('评论内容').fill('请完善此段说明');
    await page.getByRole('button', { name: '发布评论', exact: true }).click(); await page.getByText('请完善此段说明', { exact: true }).waitFor();
    pass('选区浮动格式生效，评论保留所选文字与段落位置');
    await page.getByRole('button', { name: '复制文档链接', exact: true }).click();
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), url);
    await editor().click(); await page.keyboard.press('Control+Home'); await page.getByRole('button', { name: '复制当前段落链接', exact: true }).click();
    await page.getByText(/段落链接已复制/).waitFor(); const blockLink = await page.evaluate(() => navigator.clipboard.readText()); assert(blockLink.includes('#block='));
    await page.goto(blockLink); await page.reload(); await editor().waitFor(); await page.locator('.document-highlight').filter({ hasText: '已有说明' }).waitFor();
    await page.getByRole('navigation', { name: '正文目录', exact: true }).getByRole('button', { name: '键盘三级标题', exact: true }).click();
    assert(page.url().includes('#block=')); await page.locator('.document-highlight').filter({ hasText: '键盘三级标题' }).waitFor();
    pass('文档链接不改变权限，段落直达与重复层级标题目录跳转可用');
    await context.setOffline(true); await editor().click(); await page.keyboard.press('Control+End'); await page.keyboard.insertText('断线保留测试');
    await page.getByRole('status').filter({ hasText: /连接中断/ }).waitFor();
    let confirmations = 0;
    const dismiss = async dialog => { confirmations++; await dialog.dismiss(); };
    page.on('dialog', dismiss);
    await page.getByRole('link', { name: '工作台', exact: true }).click();
    assert(page.url().includes(`/documents/${id}`)); assert.equal(confirmations, 1); assert((await editor().innerText()).includes('断线保留测试'));
    page.off('dialog', dismiss); await context.setOffline(false); await saved(id, '断线保留测试');
    pass('断网后取消全局导航保留未保存稿，恢复网络后真实保存');
    const peerContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    try {
      const peer = await peerContext.newPage(); peer.on('pageerror', error => errors.push(error.message)); await login('admin', peer); await peer.goto(url);
      const peerEditor = peer.locator('[data-document-editor]'); await peerEditor.waitFor(); await peerEditor.click();
      await peer.keyboard.press('Control+End'); await peer.keyboard.press('Enter'); await peer.keyboard.insertText('/h2');
      await peer.getByRole('listbox', { name: '快捷插入' }).waitFor(); await peer.keyboard.press('Enter'); await peer.keyboard.insertText('同伴协作章节');
      await page.getByRole('navigation', { name: '正文目录', exact: true }).getByRole('button', { name: '同伴协作章节', exact: true }).waitFor();
      await page.locator('.document-highlight').filter({ hasText: '键盘三级标题' }).waitFor(); await saved(id, '同伴协作章节');
      pass('同伴协作新增标题后目录自动更新，原段落定位仍然稳定');
    } finally { await peerContext.close(); }
    await page.screenshot({ path: path.join(output, 'document-desktop.png'), fullPage: true });
    await context.clearCookies(); await login('teacher'); await page.goto(url); await editor().waitFor();
    assert.equal(await editor().getAttribute('contenteditable'), 'false');
    await editor().locator('h2 strong').first().dblclick();
    await page.getByRole('toolbar', { name: '选中文字操作' }).waitFor();
    assert.equal(await page.getByRole('button', { name: '选区加粗', exact: true }).count(), 0); await page.getByRole('button', { name: '评论选区', exact: true }).waitFor();
    pass('教师评论权限只显示反馈操作，不能从浮动栏修改正文');
    await context.clearCookies(); await login('student');
    const readUrl = `${origin}/projects/${projectId}/documents/${manifest.documents.readOnly}`;
    await page.goto(readUrl); await editor().waitFor(); assert.equal(await editor().getAttribute('contenteditable'), 'false');
    await page.getByRole('navigation', { name: '正文目录', exact: true }).waitFor();
    pass('只读文档仍可使用目录与链接，保持服务端权限');
  } else {
    for (const role of ['student', 'teacher', 'admin']) {
      if (role !== 'student') { await context.clearCookies(); await login(role); }
      await page.goto(`${origin}/projects/${projectId}/documents/${manifest.documents.collaboration}`); await editor().waitFor();
      await page.getByRole('navigation', { name: '正文目录', exact: true }).waitFor();
      await page.getByRole('button', { name: '复制文档链接', exact: true }).waitFor();
      assert((await page.getByRole('navigation', { name: '正文目录', exact: true }).getByRole('button').count()) > 0);
      const first = page.getByRole('navigation', { name: '正文目录', exact: true }).getByRole('button').first(); await first.click(); await page.locator('.document-highlight').waitFor();
      if (role === 'teacher') assert.equal(await editor().getAttribute('contenteditable'), 'false');
      pass(`线上${role}文档目录、段落直达和链接入口可用`);
    }
    await page.screenshot({ path: path.join(output, 'document-desktop.png'), fullPage: true });
  }
  assert.deepEqual(errors, []); pass('桌面浏览器无未捕获页面异常');
} catch (error) {
  console.error('Document browser verification failed:', error.message); process.exitCode = 1;
  fs.writeFileSync(path.join(output, 'failure-state.json'), JSON.stringify(await page.evaluate(() => ({
    menus: [...document.querySelectorAll('.document-selection-menu')].map(element => ({html:element.outerHTML,rect:{width:element.getBoundingClientRect().width,height:element.getBoundingClientRect().height}})),
    selection: window.getSelection()?.toString(), focused: document.activeElement?.getAttribute('data-document-editor'),
  })), null, 2));
  await page.screenshot({ path: path.join(output, 'failure.png'), fullPage: true }).catch(() => {});
} finally {
  if (!readOnly) {
    await context.setOffline(false); await context.clearCookies(); await login('student').catch(() => {});
    for (const id of createdIds) {
      try { const current = await api(`${apiBase}/${id}`); if (current.status === 200) await api(`${apiBase}/${id}`, 'DELETE', { requestId: crypto.randomUUID(), expectedRevision: current.value.data.revision }); } catch {}
    }
  }
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify({ origin, mode: readOnly ? 'read-only' : 'local-owned-fixtures', checks, errors }, null, 2));
  await browser.close();
}
