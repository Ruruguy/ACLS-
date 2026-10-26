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
