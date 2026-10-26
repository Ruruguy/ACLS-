const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '..', 'reports.js'), 'utf8');

// Delayed commits exercise the real module's journal/queue/recovery logic.
// The storage shim deliberately excludes DOM and browser-specific behavior.
function environment(shared = { records: new Map(), journal: new Map() }, unavailable = false) {
  const elements = new Map();
  function element(id) {
    if (!elements.has(id)) elements.set(id, {
      textContent: '', innerHTML: '', value: '', hidden: true,
      classList: { toggle() {}, add() {}, remove() {} },
      setAttribute() {}, focus() {}
    });
    return elements.get(id);
  }
  const db = {
    objectStoreNames: { contains: () => true },
    transaction() {
      const tx = { error: null };
      let changes = [];
      tx.objectStore = () => ({
        put(value) { changes.push(['put', structuredClone(value)]); },
        delete(id) { changes.push(['delete', id]); },
        getAll() {
          const request = {};
          setTimeout(() => {
            request.result = structuredClone([...shared.records.values()]);
            request.onsuccess();
          }, 1);
          return request;
        }
      });
      setTimeout(() => {
        for (const [action, value] of changes) {
          if (action === 'put') shared.records.set(value.id, value);
          else shared.records.delete(value);
        }
        tx.oncomplete?.();
      }, 3);
      return tx;
    }
  };
  const indexedDB = unavailable ? undefined : {
    open() {
      const request = {};
      setTimeout(() => { request.result = db; request.onsuccess(); }, 1);
      return request;
    }
  };
  const localStorage = {
    get length() { return shared.journal.size; },
    key(i) { return [...shared.journal.keys()][i]; },
    getItem(key) { return shared.journal.get(key) ?? null; },
    setItem(key, value) { shared.journal.set(key, value); },
    removeItem(key) { shared.journal.delete(key); }
  };
  const context = vm.createContext({
    indexedDB, localStorage, console: { error() {}, warn() {} },
    setTimeout, clearTimeout, Blob, URL, crypto: require('node:crypto').webcrypto,
    confirm: () => true,
    navigator: {},
    document: { getElementById: element, addEventListener() {}, body: { classList: { toggle() {} } } }
  });
  context.window = context;
  vm.runInContext(source, context);
  return { manager: context.ReportManager, context, element, shared };
}

function report(id, count = 1, status = 'in_progress') {
  return {
    id, status,
    startedAt: '2026-10-26T01:00:00.000Z',
    endedAt: '2026-10-26T01:00:05.000Z',
    updatedAt: '2026-10-26T01:00:05.000Z',
    timeline: Array.from({ length: count }, (_, index) => ({
      id: `event-${index}`, timestamp: '2026-10-26T01:00:05.000Z',
      text: 'AED 電擊', category: 'shock'
    }))
  };
}

test('event is journaled synchronously; rapid writes commit the newest snapshot', async () => {
  const e = environment();
  const writes = [];
  for (let i = 1; i <= 12; i++) writes.push(e.manager.saveSnapshot(report('case-rapid', i)));
  assert.equal(JSON.parse(e.shared.journal.get('acls-pending-case:case-rapid')).timeline.length, 12);
  await Promise.all(writes);
  assert.equal(e.shared.records.get('case-rapid').timeline.length, 12);
  assert.equal(e.shared.journal.size, 0);
  assert.equal(e.element('save-status').textContent, '已存於此裝置');
});

test('fresh session recovers an interrupted mission without marking it completed', async () => {
  const e = environment();
  e.shared.journal.set('acls-pending-case:case-recovered', JSON.stringify(report('case-recovered', 3)));
  await e.manager.initialize();
  assert.equal(e.shared.records.get('case-recovered').status, 'in_progress');
  assert.equal(e.shared.records.get('case-recovered').timeline.length, 3);
  assert.equal(e.element('recovery-notice').hidden, false);
  await e.manager.openHistory();
  assert.match(e.element('report-content').innerHTML, /未完成/);
  await e.manager.showTab('stats');
  assert.match(e.element('report-content').innerHTML, /尚無可統計資料/);
});

test('deletion removes database and journal, with no resurrection on reopening', async () => {
  const e = environment();
  await e.manager.saveSnapshot(report('case-delete'));
  await e.manager.openHistory();
  e.manager.openCase('case-delete');
  await e.manager.deleteCurrent();
  assert.equal(e.shared.records.size, 0);
  assert.equal(e.shared.journal.size, 0);
  const reopened = environment(e.shared);
  await reopened.manager.initialize();
  assert.equal(reopened.element('recovery-notice').hidden, true);
});

test('temporary database failure retains journal and recovered history', async () => {
  const e = environment(undefined, true);
  await e.manager.saveSnapshot(report('case-fallback', 2));
  assert.equal(e.shared.journal.size, 1);
  assert.equal(e.element('save-status').textContent, '已暫存，請備份');
  await e.manager.openHistory();
  assert.match(e.element('report-content').innerHTML, /未完成/);
  const reopened = environment(e.shared);
  await reopened.manager.initialize();
  assert.equal(e.shared.records.get('case-fallback').timeline.length, 2);
});

test('backup import restores once, validates records, and keeps newer local versions', async () => {
  const e = environment();
  const payload = { format: 'acls-local-backup', version: 1, cases: [report('case-import')] };
  const input = () => ({ value: 'file', files: [{ size: 200, text: async () => JSON.stringify(payload) }] });
  await e.manager.importBackup(input());
  assert.equal(e.shared.records.size, 1);
  await e.manager.importBackup(input());
  assert.equal(e.shared.records.size, 1);
  const newer = report('case-import', 5);
  newer.updatedAt = '2026-10-26T02:00:00.000Z';
  await e.manager.saveSnapshot(newer);
  await e.manager.importBackup(input());
  assert.equal(e.shared.records.get('case-import').timeline.length, 5);
  payload.cases = [{ id: 'invalid' }];
  await e.manager.importBackup(input());
  assert.equal(e.shared.records.size, 1);
  assert.match(e.element('app-toast').textContent, /匯入失敗/);
});

test('marking recovered report completed uses last event time, not current time', async () => {
  const e = environment();
  await e.manager.saveSnapshot(report('case-complete'));
  await e.manager.openHistory();
  e.manager.openCase('case-complete');
  await e.manager.completeCurrent();
  assert.equal(e.shared.records.get('case-complete').status, 'completed');
  assert.equal(e.shared.records.get('case-complete').endedAt, '2026-10-26T01:00:05.000Z');
  await e.manager.showTab('stats');
  assert.match(e.element('report-content').innerHTML, /總電擊次數/);
});

test('case-level shock and airway counts deduplicate events and exclude voice/incomplete records', async () => {
  const e = environment();
  const a = report('case-airway-a', 3, 'completed');
  const event = (category, text) => ({ timestamp: a.endedAt, category, text });
  a.timeline.push(event('lma', '建立進階呼吸道 (LMA)'), event('lma', '建立進階呼吸道 (LMA)'), event('endo', '建立確切呼吸道 (ENDO)'));
  a.timeline.push(event('voice', '語音指令: ENDO 確切呼吸道'), event('voice', '語音指令: AED 電擊'));
  const b = report('case-airway-b', 0, 'completed');
  b.timeline.push(event('endo', '建立確切呼吸道 (ENDO)'));
  const legacy = report('case-airway-legacy', 0, 'completed');
  legacy.timeline.push(event('dark-green', '建立進階呼吸道 (Endo/LMA)'));
  for (const item of [a, b, legacy, report('case-incomplete', 7)]) await e.manager.saveSnapshot(item);
  await e.manager.showTab('stats');
  const html = e.element('report-content').innerHTML;
  assert.match(html, /總電擊次數<\/span><strong>3<\/strong>/);
  assert.match(html, /有電擊的個案數<\/span><strong>1 件<\/strong>/);
  assert.match(html, /LMA 進階呼吸道個案數<\/span><strong>1 件<\/strong>/);
  assert.match(html, /ENDO 確切呼吸道個案數<\/span><strong>2 件<\/strong>/);
  assert.match(html, /舊版未區分的呼吸道個案 1 件/);
  assert.match(e.manager.reportToText(a), /LMA 進階呼吸道: 有紀錄\nENDO 確切呼吸道: 有紀錄/);
  await e.manager.openHistory();
  e.manager.openCase(legacy.id);
  const legacyEvent = e.shared.records.get(legacy.id).timeline[0];
  e.manager.updateEvent(legacyEvent.id, 'category', 'endo');
  await e.manager.saveCurrent();
  await e.manager.showTab('stats');
  assert.match(e.element('report-content').innerHTML, /ENDO 確切呼吸道個案數<\/span><strong>3 件<\/strong>/);
  assert.match(e.element('report-content').innerHTML, /舊版未區分的呼吸道個案 0 件/);
});
