/* Local end-of-mission reports and longitudinal statistics. */
const ReportManager = (() => {
  const DB_NAME = 'acls-resuscitation-assistant';
  const DB_VERSION = 1;
  const STORE_NAME = 'cases';
  const JOURNAL_PREFIX = 'acls-pending-case:';
  const CATEGORY_LABELS = {
    '': '一般', type: '處置', drug: '給藥', shock: '電擊', ecg: '心律',
    rosc: 'ROSC', voice: '語音', end: '系統', 'dark-green': '管路／呼吸道'
  };

  let dbPromise = null;
  let currentReport = null;
  let casesCache = [];
  let activeTab = 'case';
  let writeQueue = Promise.resolve();
  let saveSequence = 0;

  // Serialize all writes; an older in-flight snapshot must never replace a newer one.
  function queueWrite(task) {
    const result = writeQueue.then(task);
    writeQueue = result.catch(() => {});
    return result;
  }

  function setSaveStatus(message, failed = false) {
    const element = document.getElementById('save-status');
    if (element) {
      element.textContent = message;
      element.classList.toggle('save-failed', failed);
    }
  }

  function readPending() {
    const pending = [];
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (!key || !key.startsWith(JOURNAL_PREFIX)) continue;
        try {
          const report = JSON.parse(localStorage.getItem(key));
          if (validReport(report) && key === JOURNAL_PREFIX + report.id) pending.push(report);
        } catch (error) { console.warn('略過無法讀取的暫存紀錄', error); }
      }
    } catch (error) { console.warn('無法讀取暫存紀錄', error); }
    return pending;
  }

  // Synchronous journal protects the latest event even if the page closes
  // before IndexedDB's asynchronous transaction completes.
  function saveSnapshot(report) {
    const snapshot = normalizeReport(report);
    const serialized = JSON.stringify(snapshot);
    const key = JOURNAL_PREFIX + snapshot.id;
    const sequence = ++saveSequence;
    let journalSaved = false;
    try { localStorage.setItem(key, serialized); journalSaved = true; }
    catch (error) { console.warn('暫存寫入失敗，改由資料庫保存', error); }
    setSaveStatus('正在儲存…');
    return queueWrite(async () => {
      try {
        await putCase(snapshot);
        try {
          if (localStorage.getItem(key) === serialized) localStorage.removeItem(key);
        } catch (_) { /* IndexedDB already contains the committed snapshot. */ }
        if (sequence === saveSequence) setSaveStatus('已存於此裝置');
        return snapshot;
      } catch (error) {
        if (sequence === saveSequence) {
          setSaveStatus(journalSaved ? '已暫存，請備份' : '儲存失敗，請匯出', true);
          toast(journalSaved ? '資料庫暫時無法寫入，紀錄已暫存於此裝置' : '無法自動儲存，請立即匯出紀錄', true);
        }
        if (!journalSaved) throw error;
        return snapshot;
      }
    });
  }

  async function loadCases() {
    await writeQueue;
    let stored = [];
    let databaseError;
    try { stored = await getAllCases(); } catch (error) { databaseError = error; }
    const merged = new Map(stored.map(report => [report.id, report]));
    const pending = readPending();
    for (const report of pending) {
      const previous = merged.get(report.id);
      if (!previous || new Date(report.updatedAt) >= new Date(previous.updatedAt)) merged.set(report.id, report);
    }
    if (databaseError && !pending.length) throw databaseError;
    return Array.from(merged.values()).map(normalizeReport);
  }

  function validReport(report) {
    return report && typeof report.id === 'string' && /^[A-Za-z0-9_-]{1,150}$/.test(report.id)
      && Number.isFinite(Date.parse(report.startedAt)) && Number.isFinite(Date.parse(report.updatedAt))
      && Array.isArray(report.timeline) && report.timeline.every(item => item
        && typeof item.text === 'string' && Number.isFinite(Date.parse(item.timestamp)));
  }

  function makeId(prefix = 'item') {
    if (window.crypto && crypto.randomUUID) return `${prefix}-${crypto.randomUUID()}`;
    return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function openDatabase() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      if (!window.indexedDB) {
        reject(new Error('此瀏覽器不支援 IndexedDB'));
        return;
      }
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
          store.createIndex('startedAt', 'startedAt', { unique: false });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => {
        dbPromise = null;
        reject(request.error || new Error('無法開啟個案資料庫'));
      };
    });
    return dbPromise;
  }

  async function putCase(report) {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      transaction.objectStore(STORE_NAME).put(report);
      transaction.oncomplete = () => resolve(report);
      transaction.onerror = () => reject(transaction.error || new Error('個案儲存失敗'));
      transaction.onabort = () => reject(transaction.error || new Error('個案儲存中止'));
    });
  }

  async function getAllCases() {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const request = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error || new Error('無法讀取歷史個案'));
    });
  }

  function normalizeReport(report) {
    const startedAt = report.startedAt || new Date().toISOString();
    return {
      id: report.id || makeId('case'),
      startedAt,
      endedAt: report.endedAt || startedAt,
      status: report.status === 'in_progress' ? 'in_progress' : 'completed',
      updatedAt: report.updatedAt || new Date().toISOString(),
      note: report.note || '',
      timeline: (report.timeline || []).map(item => ({
        id: typeof item.id === 'string' && /^[A-Za-z0-9_-]+$/.test(item.id) ? item.id : makeId('event'),
        timestamp: item.timestamp || startedAt,
        text: item.text || '',
        category: item.category || ''
      })).sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp))
    };
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
  }

  function formatDateTime(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '--';
    return date.toLocaleString('zh-TW', {
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
    });
  }

  function toLocalInputValue(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    const offset = date.getTimezoneOffset() * 60000;
    return new Date(date.getTime() - offset).toISOString().slice(0, 19);
  }

  function formatDuration(seconds) {
    const safe = Math.max(0, Math.round(Number(seconds) || 0));
    const h = Math.floor(safe / 3600);
    const m = Math.floor((safe % 3600) / 60);
    const s = safe % 60;
    return h ? `${h} 小時 ${m} 分` : `${m} 分 ${s} 秒`;
  }

  function summarize(report) {
    const clinical = report.timeline.filter(item => item.category !== 'voice');
    const latestType = [...clinical].reverse().find(item => /患者類別:\s*(OHCA|IHCA)/i.test(item.text));
    const typeMatch = latestType && latestType.text.match(/(OHCA|IHCA)/i);
    return {
      patientType: typeMatch ? typeMatch[1].toUpperCase() : '未記錄',
      rosc: clinical.some(item => item.category === 'rosc' && /恢復自發循環|ROSC/i.test(item.text)),
      shocks: clinical.filter(item => item.category === 'shock' && /電擊/.test(item.text)).length,
      epinephrine: clinical.filter(item => item.category === 'drug' && /給予 Epinephrine 1mg/i.test(item.text)).length,
      durationSeconds: Math.max(0, (new Date(report.endedAt) - new Date(report.startedAt)) / 1000),
      events: clinical.length
    };
  }

  function setModalOpen(isOpen) {
    const modal = document.getElementById('report-modal');
    if (!modal) return;
    modal.hidden = !isOpen;
    modal.setAttribute('aria-hidden', String(!isOpen));
    document.body.classList.toggle('report-open', isOpen);
  }

  function setActiveTab(tab) {
    activeTab = tab;
    ['case', 'history', 'stats'].forEach(name => {
      const button = document.getElementById(`report-tab-${name}`);
      if (button) button.classList.toggle('active', name === tab);
    });
  }

  function toast(message, isError = false) {
    const element = document.getElementById('app-toast');
    if (!element) return;
    element.textContent = message;
    element.classList.toggle('error', isError);
    element.classList.add('show');
    window.clearTimeout(toast.timer);
    toast.timer = window.setTimeout(() => element.classList.remove('show'), 2600);
  }

  function emptyState(title, body) {
    return `<div class="report-empty"><h3>${escapeHtml(title)}</h3><p>${escapeHtml(body)}</p></div>`;
  }

  function categoryOptions(selected) {
    return Object.entries(CATEGORY_LABELS).map(([value, label]) =>
      `<option value="${escapeHtml(value)}" ${value === selected ? 'selected' : ''}>${escapeHtml(label)}</option>`
    ).join('');
  }

  function renderCase() {
    const content = document.getElementById('report-content');
    const title = document.getElementById('report-modal-title');
    if (title) title.textContent = '個案結束報告';
    if (!currentReport) {
      content.innerHTML = emptyState('尚未選擇個案', '請先從「歷史個案」開啟一筆紀錄。');
      return;
    }

    currentReport.timeline.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    const isLive = typeof window.isCurrentMissionActive === 'function' && window.isCurrentMissionActive(currentReport.id);
    const summary = summarize(currentReport);
    const timelineHtml = currentReport.timeline.length ? currentReport.timeline.map(item => `
      <div class="timeline-edit-row" data-event-id="${escapeHtml(item.id)}">
        <input class="report-input timeline-time" type="datetime-local" step="1"
          value="${toLocalInputValue(item.timestamp)}"
          onchange="ReportManager.updateEvent('${escapeHtml(item.id)}', 'timestamp', this.value)">
        <select class="report-input timeline-category"
          onchange="ReportManager.updateEvent('${escapeHtml(item.id)}', 'category', this.value)">
          ${categoryOptions(item.category)}
        </select>
        <input class="report-input timeline-text" type="text" maxlength="120"
          value="${escapeHtml(item.text)}" aria-label="處置項目"
          onchange="ReportManager.updateEvent('${escapeHtml(item.id)}', 'text', this.value)">
        <button class="timeline-delete" onclick="ReportManager.removeEvent('${escapeHtml(item.id)}')" aria-label="移除項目">移除</button>
      </div>`).join('') : emptyState('時間軸目前沒有項目', '可在下方自訂新增處置。');

    content.innerHTML = `
      <p class="storage-note">${currentReport.status === 'in_progress' ? '未完成紀錄：已保留到最後一次處置，未將關閉網站後的時間算入任務。' : '已完成紀錄'}${isLive ? '　此個案正在記錄中，請結束任務後再編輯。' : ''}</p>
      <fieldset class="report-edit-fields" ${isLive ? 'disabled' : ''}>
      <section class="report-summary-grid">
        <div class="summary-card"><span>個案日期</span><strong>${escapeHtml(formatDateTime(currentReport.startedAt))}</strong></div>
        <div class="summary-card"><span>任務時間</span><strong>${escapeHtml(formatDuration(summary.durationSeconds))}</strong></div>
        <div class="summary-card"><span>患者類別</span><strong>${summary.patientType}</strong></div>
        <div class="summary-card"><span>結果</span><strong class="${summary.rosc ? 'text-green' : ''}">${summary.rosc ? 'ROSC' : '未記錄 ROSC'}</strong></div>
        <div class="summary-card"><span>電擊次數</span><strong>${summary.shocks}</strong></div>
        <div class="summary-card"><span>Epinephrine</span><strong>${summary.epinephrine} 劑</strong></div>
      </section>

      <section class="report-section">
        <div class="report-section-title"><h3>時間軸處置項目</h3><span>可修改時間、分類與內容</span></div>
        <div class="timeline-editor">${timelineHtml}</div>
      </section>

      <section class="report-section add-event-panel">
        <div class="report-section-title"><h3>插入自訂項目</h3><span>儲存後會依時間自動排序</span></div>
        <div class="add-event-grid">
          <input id="new-event-time" class="report-input" type="datetime-local" step="1" value="${toLocalInputValue(currentReport.endedAt)}">
          <select id="new-event-category" class="report-input">${categoryOptions('type')}</select>
          <input id="new-event-text" class="report-input" type="text" maxlength="120" placeholder="輸入處置或事件內容">
          <button class="report-btn secondary" onclick="ReportManager.addEvent()">新增至時間軸</button>
        </div>
      </section>

      <section class="report-section">
        <label class="report-label" for="case-note">個案備註</label>
        <textarea id="case-note" class="report-input report-note" maxlength="1000" placeholder="可補充交班、品質檢討或其他資訊">${escapeHtml(currentReport.note)}</textarea>
      </section>

      <section class="report-section save-location-guide" aria-labelledby="save-location-title">
        <h3 id="save-location-title">結束前，請確認紀錄存放位置</h3>
        <p>自動保存的紀錄位於<strong>這台裝置、目前瀏覽器的網站資料</strong>，不會自動產生手機檔案。下次請用相同網址與瀏覽器，進入「歷史個案與統計」查看。</p>
        <p>需要另外保留檔案時，可匯出 TXT，或在「歷史個案」下載全部備份。下載位置依每個人的手機設定而不同；請在下載或儲存畫面確認所選位置。</p>
      </section>

      <div class="report-actions">
        <button class="report-btn danger" onclick="ReportManager.deleteCurrent()">刪除此個案</button>
        ${currentReport.status === 'in_progress' ? '<button class="report-btn secondary" onclick="ReportManager.completeCurrent()">標記為已完成</button>' : ''}
        <button class="report-btn secondary" onclick="ReportManager.downloadCurrent()">匯出 TXT</button>
        <button class="report-btn primary" onclick="ReportManager.saveCurrent()">儲存報告</button>
      </div></fieldset>`;
  }

  async function renderHistory() {
    const content = document.getElementById('report-content');
    const title = document.getElementById('report-modal-title');
    if (title) title.textContent = '歷史個案';
    casesCache = (await loadCases())
      .sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt));
    if (!casesCache.length) {
      content.innerHTML = '';
    }
    content.innerHTML = `
      <div class="history-toolbar">
        <label>依日期篩選 <input id="history-date-filter" class="report-input" type="date" onchange="ReportManager.filterHistory(this.value)"></label>
        <span>共 ${casesCache.length} 筆個案</span>
      </div>
      <div class="backup-actions">
        <button class="report-btn secondary" onclick="ReportManager.exportBackup()">下載全部備份</button>
        <label class="report-btn secondary">匯入備份<input type="file" accept=".json,application/json" onchange="ReportManager.importBackup(this)" aria-label="匯入備份檔案"></label>
      </div>
      <div id="history-list" class="history-list">${historyCards(casesCache)}</div>
      <p class="storage-note">紀錄只保存在此裝置的此瀏覽器，不會上傳，也不會自動到期刪除。請使用相同網址及瀏覽器查閱。清除網站資料、無痕模式或裝置故障仍可能使資料遺失，請定期下載全部備份。</p>`;
  }

  function historyCards(reports) {
    if (!reports.length) return emptyState('沒有符合的紀錄', '每次處置會自動保存，也可匯入先前下載的備份。');
    return reports.map(report => {
      const summary = summarize(report);
      return `<button class="history-card" onclick="ReportManager.openCase('${escapeHtml(report.id)}')">
        <span class="history-date">${escapeHtml(formatDateTime(report.startedAt))}</span>
        <strong>${report.status === 'in_progress' ? '未完成 · ' : ''}${summary.patientType} · ${summary.rosc ? 'ROSC' : '未記錄 ROSC'}</strong>
        <span>${escapeHtml(formatDuration(summary.durationSeconds))}　電擊 ${summary.shocks} 次　Epinephrine ${summary.epinephrine} 劑</span>
      </button>`;
    }).join('');
  }

  async function renderStats() {
    const content = document.getElementById('report-content');
    const title = document.getElementById('report-modal-title');
    if (title) title.textContent = '資訊統計';
    casesCache = await loadCases();
    const completed = casesCache.filter(report => report.status !== 'in_progress');
    if (!completed.length) {
      content.innerHTML = emptyState('尚無可統計資料', '完成並儲存個案後，這裡會自動產生統計。');
      return;
    }
    const summaries = completed.map(summarize);
    const total = summaries.length;
    const roscCount = summaries.filter(item => item.rosc).length;
    const ohca = summaries.filter(item => item.patientType === 'OHCA').length;
    const ihca = summaries.filter(item => item.patientType === 'IHCA').length;
    const unknown = total - ohca - ihca;
    const shocks = summaries.reduce((sum, item) => sum + item.shocks, 0);
    const epi = summaries.reduce((sum, item) => sum + item.epinephrine, 0);
    const avgDuration = summaries.reduce((sum, item) => sum + item.durationSeconds, 0) / total;
    const percentage = total ? Math.round((roscCount / total) * 100) : 0;
    content.innerHTML = `
      <p class="stats-scope">統計範圍：此瀏覽器已完成的個案（${formatDateTime(Math.min(...completed.map(item => new Date(item.startedAt).getTime())))} 起）；未完成 ${casesCache.length - completed.length} 筆暫不計入。</p>
      <section class="stats-grid">
        <div class="stat-card hero"><span>總個案數</span><strong>${total}</strong></div>
        <div class="stat-card hero"><span>ROSC</span><strong class="text-green">${roscCount} <small>(${percentage}%)</small></strong></div>
        <div class="stat-card"><span>OHCA</span><strong>${ohca}</strong></div>
        <div class="stat-card"><span>IHCA</span><strong>${ihca}</strong></div>
        <div class="stat-card"><span>類別未記錄</span><strong>${unknown}</strong></div>
        <div class="stat-card"><span>總電擊次數</span><strong>${shocks}</strong></div>
        <div class="stat-card"><span>Epinephrine 總劑數</span><strong>${epi}</strong></div>
        <div class="stat-card"><span>平均任務時間</span><strong>${escapeHtml(formatDuration(avgDuration))}</strong></div>
      </section>
      <p class="storage-note">統計會依編輯後的最新時間軸重新計算；語音指令確認紀錄不會重複計入臨床事件。</p>`;
  }

  async function saveAndOpen(report) {
    try {
      currentReport = normalizeReport(report);
      await saveSnapshot(currentReport);
      setModalOpen(true);
      setActiveTab('case');
      renderCase();
    } catch (error) {
      console.error(error);
      toast('無法儲存結束報告，請先匯出 TXT', true);
    }
  }

  async function openHistory() {
    try {
      setModalOpen(true);
      setActiveTab('history');
      await renderHistory();
    } catch (error) {
      console.error(error);
      document.getElementById('report-content').innerHTML = emptyState('資料庫無法開啟', error.message);
    }
  }

  async function showTab(tab) {
    setActiveTab(tab);
    if (tab === 'case') renderCase();
    if (tab === 'history') await renderHistory();
    if (tab === 'stats') await renderStats();
  }

  function close() {
    setModalOpen(false);
  }

  function updateEvent(id, field, value) {
    if (!currentReport) return;
    const item = currentReport.timeline.find(event => event.id === id);
    if (!item) return;
    if (field === 'timestamp') {
      const parsed = new Date(value);
      if (!Number.isNaN(parsed.getTime())) item.timestamp = parsed.toISOString();
    } else if (field === 'category') {
      item.category = value;
    } else if (field === 'text') {
      item.text = value.trim();
    }
  }

  function addEvent() {
    if (!currentReport) return;
    const timeInput = document.getElementById('new-event-time');
    const categoryInput = document.getElementById('new-event-category');
    const textInput = document.getElementById('new-event-text');
    const text = textInput.value.trim();
    const parsed = new Date(timeInput.value);
    if (!text) {
      toast('請輸入處置或事件內容', true);
      textInput.focus();
      return;
    }
    if (Number.isNaN(parsed.getTime())) {
      toast('請選擇有效時間', true);
      return;
    }
    captureNote();
    currentReport.timeline.push({
      id: makeId('event'), timestamp: parsed.toISOString(),
      category: categoryInput.value, text
    });
    renderCase();
    toast('已加入時間軸，請按「儲存報告」');
  }

  function removeEvent(id) {
    if (!currentReport) return;
    const item = currentReport.timeline.find(event => event.id === id);
    if (!item || !window.confirm(`確定從報告移除「${item.text}」？`)) return;
    captureNote();
    currentReport.timeline = currentReport.timeline.filter(event => event.id !== id);
    renderCase();
    toast('已從時間軸移除，請按「儲存報告」');
  }

  async function saveCurrent() {
    if (!currentReport) return;
    const note = document.getElementById('case-note');
    if (note) currentReport.note = note.value.trim();
    currentReport.timeline = currentReport.timeline.filter(item => item.text.trim())
      .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    currentReport.updatedAt = new Date().toISOString();
    try {
      await saveSnapshot(currentReport);
      if (typeof window.applySavedReportToCurrentMission === 'function') {
        window.applySavedReportToCurrentMission(currentReport);
      }
      renderCase();
      toast('報告已儲存，統計已更新');
    } catch (error) {
      console.error(error);
      toast('報告儲存失敗', true);
    }
  }

  function filterHistory(dateValue) {
    const list = document.getElementById('history-list');
    if (!list) return;
    const filtered = dateValue ? casesCache.filter(report => toLocalInputValue(report.startedAt).slice(0, 10) === dateValue) : casesCache;
    list.innerHTML = historyCards(filtered);
  }

  function openCase(id) {
    const report = casesCache.find(item => item.id === id);
    if (!report) return;
    currentReport = normalizeReport(report);
    setActiveTab('case');
    renderCase();
  }

  function reportToText(report) {
    const summary = summarize(report);
    let text = `救護助手個案報告\n個案日期: ${formatDateTime(report.startedAt)}\n`;
    text += `狀態: ${report.status === 'in_progress' ? '未完成（時間截至最後保存）' : '已完成'}\n`;
    text += `任務結束: ${formatDateTime(report.endedAt)}\n任務時間: ${formatDuration(summary.durationSeconds)}\n`;
    text += `患者類別: ${summary.patientType}\n結果: ${summary.rosc ? 'ROSC' : '未記錄 ROSC'}\n`;
    text += `電擊次數: ${summary.shocks}\nEpinephrine: ${summary.epinephrine} 劑\n`;
    text += '===================================\n\n';
    report.timeline.slice().sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp)).forEach(item => {
      text += `[${new Date(item.timestamp).toLocaleTimeString('zh-TW', { hour12: false })}] ${item.text}\n`;
    });
    if (report.note) text += `\n===================================\n備註:\n${report.note}\n`;
    return text;
  }

  function downloadCurrent() {
    if (!currentReport) return;
    const note = document.getElementById('case-note');
    if (note) currentReport.note = note.value.trim();
    const blob = new Blob([reportToText(currentReport)], { type: 'text/plain;charset=utf-8' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `救護助手個案報告_${toLocalInputValue(currentReport.startedAt).replace(/[-:T]/g, '').slice(0, 14)}.txt`;
    link.click();
    showFileLocation(link.download);
    setTimeout(() => URL.revokeObjectURL(link.href), 0);
  }

  function captureNote() {
    const note = document.getElementById('case-note');
    if (currentReport && note) currentReport.note = note.value.trim();
  }

  async function completeCurrent() {
    if (!currentReport || (window.isCurrentMissionActive && window.isCurrentMissionActive(currentReport.id))) return;
    if (!confirm('將此紀錄標記為已完成？結束時間使用最後保存時間，不會計入關閉網站後的時間。')) return;
    currentReport.status = 'completed';
    await saveCurrent();
  }

  async function deleteCurrent() {
    if (!currentReport || (window.isCurrentMissionActive && window.isCurrentMissionActive(currentReport.id))) return;
    const id = currentReport.id;
    if (!confirm(`確定刪除 ${formatDateTime(currentReport.startedAt)} 的整份個案？\n刪除後無法復原，除非你有下載備份。`)) return;
    try {
      await queueWrite(async () => {
        const db = await openDatabase();
        await new Promise((resolve, reject) => {
          const tx = db.transaction(STORE_NAME, 'readwrite');
          tx.objectStore(STORE_NAME).delete(id);
          tx.oncomplete = resolve;
          tx.onerror = () => reject(tx.error);
          tx.onabort = () => reject(tx.error || new Error('刪除中止'));
        });
        localStorage.removeItem(JOURNAL_PREFIX + id);
      });
      currentReport = null;
      casesCache = casesCache.filter(item => item.id !== id);
      setActiveTab('history');
      await renderHistory();
      await refreshRecoveryNotice();
      toast('個案已刪除');
    } catch (error) { console.error(error); toast('刪除失敗，請重試', true); }
  }

  function downloadJson(data) {
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `救護助手備份_${toLocalInputValue(new Date()).replace(/[-:T]/g, '')}.json`;
    link.click();
    showFileLocation(link.download);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function exportBackup() {
    try {
      downloadJson({ format: 'acls-local-backup', version: 1, exportedAt: new Date().toISOString(), cases: await loadCases() });
      toast('已發起備份下載，請確認儲存位置');
    } catch (error) { console.error(error); toast('無法讀取備份資料', true); }
  }

  async function importBackup(input) {
    const file = input.files && input.files[0];
    if (!file) return;
    try {
      if (file.size > 20 * 1024 * 1024) throw new Error('備份檔超過 20 MB');
      const data = JSON.parse(await file.text());
      if (data.format !== 'acls-local-backup' || data.version !== 1 || !Array.isArray(data.cases)
        || !data.cases.every(validReport)) throw new Error('不是有效的救護助手備份檔');
      const existing = new Map((await loadCases()).map(item => [item.id, item]));
      let imported = 0;
      for (const raw of data.cases) {
        // Duplicate ids keep the newer local version; never overwrite a live mission.
        if (window.isCurrentMissionActive && window.isCurrentMissionActive(raw.id)) continue;
        const previous = existing.get(raw.id);
        if (previous && new Date(previous.updatedAt) >= new Date(raw.updatedAt)) continue;
        const report = await saveSnapshot(raw);
        existing.set(report.id, report);
        imported++;
      }
      await renderHistory();
      await refreshRecoveryNotice();
      toast(`已還原 ${imported} 筆紀錄；相同或較舊版本已略過`);
    } catch (error) { console.error(error); toast(`匯入失敗：${error.message}`, true); }
    input.value = '';
  }

  async function refreshRecoveryNotice() {
    const notice = document.getElementById('recovery-notice');
    if (!notice) return;
    const reports = await loadCases();
    const unfinished = reports.filter(report => report.status === 'in_progress');
    notice.hidden = !unfinished.length;
    notice.textContent = unfinished.length ? `找到 ${unfinished.length} 筆未完成紀錄，點此查看` : '';
  }

  async function initialize() {
    try {
      // Replay snapshots interrupted between the journal and database commit.
      for (const report of await loadCases()) {
        if (readPending().some(item => item.id === report.id)) await saveSnapshot(report);
      }
      await refreshRecoveryNotice();
    } catch (error) {
      console.error(error);
      setSaveStatus('本機儲存不可用', true);
    }
  }

  async function requestPersistentStorage() {
    try {
      if (navigator.storage && navigator.storage.persist) await navigator.storage.persist();
    } catch (error) { console.warn('瀏覽器未允許持續儲存', error); }
  }

  function showFileLocation(filename) {
    const dialog = document.getElementById('file-location-dialog');
    const name = document.getElementById('download-filename');
    if (!dialog || !name) return;
    name.textContent = filename;
    if (!dialog.open) dialog.showModal();
  }

  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !document.getElementById('report-modal')?.hidden) close();
  });

  return {
    makeId, saveAndOpen, openHistory, showTab, close, updateEvent, addEvent,
    removeEvent, saveCurrent, filterHistory, openCase, downloadCurrent, reportToText,
    saveSnapshot, initialize, requestPersistentStorage, deleteCurrent, completeCurrent,
    exportBackup, importBackup, showFileLocation
  };
})();

window.ReportManager = ReportManager;
