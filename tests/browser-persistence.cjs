// Run with Playwright installed: node tests/browser-persistence.cjs
const { chromium } = require('playwright');
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');

(async () => {
  const server = http.createServer(async (request, response) => {
    const filename = new URL(request.url, 'http://localhost').pathname;
    const target = path.resolve(root, '.' + (filename === '/' ? '/index.html' : filename));
    if (!target.startsWith(root + path.sep)) { response.writeHead(403).end(); return; }
    try {
      const body = await fs.readFile(target);
      const type = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' }[path.extname(target)];
      response.writeHead(200, { 'Content-Type': type || 'application/octet-stream', 'Cache-Control': 'no-store' });
      response.end(body);
    } catch (_) { response.writeHead(404).end(); }
  });
  let browser;
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    browser = await chromium.launch({ channel: 'chrome', headless: true });
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    let page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(base);
    await page.getByRole('button', { name: '語音指令說明', exact: true }).click();
    await page.getByRole('heading', { name: '語音操作指令', exact: true }).waitFor();
    assert.equal(await page.locator('.voice-command-table tbody tr').count(), await page.evaluate(() => VOICE_COMMANDS.length));
    assert.match(await page.locator('#voice-guide-commands').innerText(), /確切呼吸道完成/);
    assert.match(await page.locator('#voice-guide-commands').innerText(), /LMA完成/);
    await page.screenshot({ path: '/tmp/acls-voice-guide-mobile.png' });
    await page.getByRole('button', { name: '關閉語音指令', exact: true }).click();
    await page.getByRole('button', { name: '啟動急救流程', exact: true }).click();
    await page.getByRole('button', { name: '語音指令', exact: true }).click();
    assert.equal(await page.evaluate(() => missionActive), true);
    await page.getByRole('button', { name: '關閉語音指令', exact: true }).click();
    await page.getByRole('button', { name: 'OHCA', exact: true }).click();
    await page.getByRole('button', { name: 'LMA 進階呼吸道', exact: true }).click();
    await page.getByRole('button', { name: 'ENDO 確切呼吸道', exact: true }).click();
    // Exercise command dispatch separately from the browser's speech service.
    await page.evaluate(() => {
      processSpeechTranscript('LMA 進階呼吸道完成');
      processSpeechTranscript('ENDO 確切呼吸道完成');
      processSpeechTranscript('amiodarone 完成');
    });
    await page.getByRole('button', { name: 'AED 電擊', exact: true }).click();
    await page.getByRole('button', { name: 'AED 電擊', exact: true }).click();
    // Deliberately close without pressing End or waiting for a save notification.
    await page.close();
    page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(base);
    await page.locator('#recovery-notice').waitFor({ state: 'visible' });
    await page.locator('#recovery-notice').click();
    await page.locator('.history-card').waitFor();
    assert.equal(await page.locator('.history-card').count(), 1);
    await page.locator('.history-card').click();
    await page.getByRole('heading', { name: '結束前，請確認紀錄存放位置' }).waitFor();
    assert.equal(await page.getByRole('textbox', { name: '處置項目', exact: true }).filter({ visible: true }).count(), 14);
    const values = await page.locator('.timeline-text').evaluateAll(elements => elements.map(el => el.value));
    assert.ok(values.includes('患者類別: OHCA'));
    assert.equal(values.filter(text => text === 'Amiodarone（劑量未註明）').length, 1);
    assert.ok(!values.includes('Amio 300mg') && !values.includes('Amio 150mg'));
    assert.equal(values.filter(text => text === '建立進階呼吸道 (LMA)').length, 2);
    assert.equal(values.filter(text => text === '建立確切呼吸道 (ENDO)').length, 2);
    assert.ok(await page.getByRole('button', { name: '標記為已完成' }).isEnabled());
    const dialogHandler = dialog => dialog.accept();
    page.on('dialog', dialogHandler);
    await page.getByRole('button', { name: '標記為已完成' }).click();
    await page.getByRole('button', { name: '標記為已完成' }).waitFor({ state: 'detached' });
    await page.getByRole('button', { name: '資訊統計', exact: true }).click();
    await page.locator('.stat-card').filter({ hasText: '有電擊的個案數' }).waitFor();
    assert.match(await page.locator('.stat-card').filter({ hasText: '有電擊的個案數' }).innerText(), /1 件/);
    assert.match(await page.locator('.stat-card').filter({ hasText: '總電擊次數' }).innerText(), /2/);
    assert.match(await page.locator('.stat-card').filter({ hasText: 'LMA 進階呼吸道個案數' }).innerText(), /1 件/);
    assert.match(await page.locator('.stat-card').filter({ hasText: 'ENDO 確切呼吸道個案數' }).innerText(), /1 件/);
    await page.getByRole('button', { name: '歷史個案', exact: true }).click();
    const downloadEvent = page.waitForEvent('download');
    await page.getByRole('button', { name: '下載全部備份' }).click();
    const download = await downloadEvent;
    await page.getByRole('heading', { name: '請確認檔案儲存位置' }).waitFor();
    assert.equal(await page.locator('#download-filename').innerText(), download.suggestedFilename());
    await page.getByRole('button', { name: '我知道了' }).click();
    const backup = await fs.readFile(await download.path());
    assert.equal(JSON.parse(backup).cases.length, 1);
    await page.locator('.history-card').click();
    await page.getByRole('button', { name: '刪除此個案' }).click();
    await page.getByRole('heading', { name: '沒有符合的紀錄' }).waitFor();
    await page.reload();
    await page.getByRole('button', { name: '歷史個案與統計', exact: true }).click();
    await page.getByRole('heading', { name: '沒有符合的紀錄' }).waitFor();
    // Restore the backup without touching any user browser profile or records.
    await page.getByLabel('匯入備份檔案').setInputFiles({ name: 'backup.json', mimeType: 'application/json', buffer: backup });
    await page.locator('.history-card').waitFor();
    assert.equal(await page.locator('.history-card').count(), 1);
    await page.screenshot({ path: '/tmp/acls-history-mobile.png' });
    const isolated = await browser.newContext();
    const visitor = await isolated.newPage();
    await visitor.goto(base);
    await visitor.getByRole('button', { name: '歷史個案與統計', exact: true }).click();
    await visitor.getByRole('heading', { name: '沒有符合的紀錄' }).waitFor();
    assert.equal(await visitor.locator('.history-card').count(), 0);
    assert.deepEqual(errors, []);
    console.log('PASS: close/reopen, unfinished recovery, completion, deletion, backup/restore, visitor isolation, mobile UI, no page errors');
    await isolated.close();
    await context.close();
  } finally {
    if (browser) await browser.close();
    server.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
