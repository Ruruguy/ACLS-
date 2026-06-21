// app.js – 12導程心電圖教學平台核心邏輯
// 全部使用安全 DOM 操作，不使用 innerHTML 插入外部資料

// ═══════════════════════════════════════════════
// 1. ECG 背景動態波形動畫
// ═══════════════════════════════════════════════
function initECGBackground() {
  const canvas = document.getElementById('ecg-bg-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  function resize() {
    canvas.width  = window.innerWidth;
    canvas.height = window.innerHeight;
  }
  resize();
  window.addEventListener('resize', resize);

  // P-QRS-T 波形定義（歸一化 0→1 時間軸，-1→1 振幅軸）
  const ecgWaveform = [
    [0.00, 0.00], [0.04, 0.00],
    [0.06, 0.15], [0.09, 0.00],  // P 波
    [0.12, 0.00], [0.14,-0.05],  // PR 段
    [0.15,-0.20],                 // Q 波
    [0.17, 1.00],                 // R 波（峰值）
    [0.19,-0.30],                 // S 波
    [0.20, 0.00], [0.28, 0.00],  // ST 段
    [0.30, 0.20], [0.40, 0.25], [0.50, 0.00], // T 波
    [0.60, 0.00], [1.00, 0.00],  // TP 段
  ];

  let offset = 0;
  const SPEED  = 0.4;  // px/frame
  const ROWS   = 3;    // 幾行重複
  const CYCLE  = 480;  // 像素/週期

  function drawWave(yBase, amplitude) {
    ctx.beginPath();
    ctx.strokeStyle = '#00FF88';
    ctx.lineWidth   = 1.5;

    for (let px = 0; px < canvas.width + CYCLE; px += 1) {
      const t    = ((px + offset) % CYCLE) / CYCLE;
      let amp    = 0;

      // 找對應波形插值
      for (let i = 0; i < ecgWaveform.length - 1; i++) {
        const [t0, a0] = ecgWaveform[i];
        const [t1, a1] = ecgWaveform[i + 1];
        if (t >= t0 && t <= t1) {
          const ratio = (t - t0) / (t1 - t0);
          amp = a0 + (a1 - a0) * ratio;
          break;
        }
      }

      const y = yBase - amp * amplitude;
      if (px === 0) ctx.moveTo(px, y);
      else          ctx.lineTo(px, y);
    }
    ctx.stroke();
  }

  function animate() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (let r = 0; r < ROWS; r++) {
      const yBase = (canvas.height / (ROWS + 1)) * (r + 1);
      drawWave(yBase, 60 - r * 10);
    }
    offset = (offset + SPEED) % CYCLE;
    requestAnimationFrame(animate);
  }
  animate();
}

// ═══════════════════════════════════════════════
// 2. Tab 導覽切換
// ═══════════════════════════════════════════════
function initTabs() {
  const tabBtns   = document.querySelectorAll('.tab-btn');
  const tabPanels = document.querySelectorAll('.tab-panel');

  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const target = btn.dataset.tab;

      tabBtns.forEach(b => {
        b.classList.remove('active');
        b.setAttribute('aria-selected', 'false');
      });
      tabPanels.forEach(p => p.classList.remove('active'));

      btn.classList.add('active');
      btn.setAttribute('aria-selected', 'true');
      document.getElementById(`panel-${target}`).classList.add('active');
    });
  });
}

// ═══════════════════════════════════════════════
// 3. 基礎課程子 Tab
// ═══════════════════════════════════════════════
function initBasicsTabs() {
  const btns   = document.querySelectorAll('.basics-tab-btn');
  const panels = document.querySelectorAll('.basics-panel');

  btns.forEach(btn => {
    btn.addEventListener('click', () => {
      btns.forEach(b => b.classList.remove('active'));
      panels.forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(`basics-${btn.dataset.basics}`).classList.add('active');
    });
  });
}

// ═══════════════════════════════════════════════
// 4. 12導程黏貼練習
// ═══════════════════════════════════════════════
// 正確電極位置（以圖片寬/高百分比表示，以 CPR 安妮正面圖為基準）
const CORRECT_POSITIONS = {
  RA: { x: 0.74, y: 0.23 },  // 右鎖骨下方
  LA: { x: 0.26, y: 0.23 },  // 左鎖骨下方
  RL: { x: 0.68, y: 0.70 },  // 右下腹
  LL: { x: 0.32, y: 0.70 },  // 左下腹
  V1: { x: 0.55, y: 0.38 },  // 胸骨右緣第4肋
  V2: { x: 0.46, y: 0.38 },  // 胸骨左緣第4肋
  V3: { x: 0.40, y: 0.43 },  // V2–V4 中點
  V4: { x: 0.35, y: 0.48 },  // 左鎖骨中線第5肋
  V5: { x: 0.28, y: 0.48 },  // 前腋線
  V6: { x: 0.21, y: 0.48 },  // 腋中線
};

// 初始散佈位置（練習起始，讓學員拖曳）
const INIT_POSITIONS = {
  RA: { x: 0.85, y: 0.10 }, LA: { x: 0.15, y: 0.10 },
  RL: { x: 0.85, y: 0.85 }, LL: { x: 0.15, y: 0.85 },
  V1: { x: 0.80, y: 0.30 }, V2: { x: 0.80, y: 0.40 },
  V3: { x: 0.80, y: 0.50 }, V4: { x: 0.80, y: 0.60 },
  V5: { x: 0.20, y: 0.75 }, V6: { x: 0.10, y: 0.75 },
};

const LIMB_LEADS  = ['RA','LA','RL','LL'];
const CHEST_LEADS = ['V1','V2','V3','V4','V5','V6'];
let showingAnswer = false;

function initLeadPractice() {
  const zone      = document.getElementById('lead-drop-zone');
  const torsoImg  = document.getElementById('torso-img');
  const checkBtn  = document.getElementById('check-lead-btn');
  const resetBtn  = document.getElementById('reset-lead-btn');
  const feedback  = document.getElementById('lead-feedback');

  if (!zone) return;

  // 建立拖曳電極標籤
  function createDots() {
    zone.replaceChildren();
    showingAnswer = false;
    checkBtn.textContent = '✅ 顯示正確位置';

    const allLeads = [...LIMB_LEADS, ...CHEST_LEADS];
    allLeads.forEach(lead => {
      const dot = document.createElement('div');
      dot.className = `lead-dot ${LIMB_LEADS.includes(lead) ? 'limb' : 'chest'}`;
      dot.textContent = lead;
      dot.dataset.lead = lead;
      dot.draggable = true;
      dot.style.left = `${INIT_POSITIONS[lead].x * 100}%`;
      dot.style.top  = `${INIT_POSITIONS[lead].y * 100}%`;
      dot.setAttribute('aria-label', `${lead} 電極，可拖曳`);
      zone.appendChild(dot);
    });
  }
  createDots();

  // Drag & Drop
  let dragged = null;
  zone.addEventListener('dragstart', e => {
    if (e.target.classList.contains('lead-dot')) dragged = e.target;
  });
  zone.addEventListener('dragover', e => e.preventDefault());
  zone.addEventListener('drop', e => {
    if (!dragged || showingAnswer) return;
    e.preventDefault();
    const rect = zone.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top)  / rect.height;
    dragged.style.left = `${Math.min(Math.max(x, 0.02), 0.98) * 100}%`;
    dragged.style.top  = `${Math.min(Math.max(y, 0.02), 0.98) * 100}%`;
    dragged = null;
  });

  // Touch drag support
  zone.addEventListener('touchstart', e => {
    const t = e.target;
    if (t.classList.contains('lead-dot')) { dragged = t; e.preventDefault(); }
  }, { passive: false });
  zone.addEventListener('touchmove', e => {
    if (!dragged || showingAnswer) return;
    e.preventDefault();
    const touch = e.touches[0];
    const rect  = zone.getBoundingClientRect();
    const x = (touch.clientX - rect.left) / rect.width;
    const y = (touch.clientY - rect.top)  / rect.height;
    dragged.style.left = `${Math.min(Math.max(x, 0.02), 0.98) * 100}%`;
    dragged.style.top  = `${Math.min(Math.max(y, 0.02), 0.98) * 100}%`;
  }, { passive: false });
  zone.addEventListener('touchend', () => { dragged = null; });

  // 顯示/隱藏正確位置
  checkBtn.addEventListener('click', () => {
    showingAnswer = !showingAnswer;
    const dots = zone.querySelectorAll('.lead-dot');

    if (showingAnswer) {
      dots.forEach(dot => {
        const lead = dot.dataset.lead;
        const pos  = CORRECT_POSITIONS[lead];
        dot.style.left = `${pos.x * 100}%`;
        dot.style.top  = `${pos.y * 100}%`;
        dot.classList.add('correct-pos');
      });
      checkBtn.textContent = '🙈 隱藏答案';
      feedback.textContent = '✅ 這是各電極的正確位置，請仔細觀察與記憶。';
      feedback.style.display = 'block';
    } else {
      dots.forEach(dot => dot.classList.remove('correct-pos'));
      createDots();
      feedback.style.display = 'none';
    }
  });

  resetBtn.addEventListener('click', () => {
    createDots();
    feedback.style.display = 'none';
  });
}

// ═══════════════════════════════════════════════
// 5. 教學實拍照片畫廊
// ═══════════════════════════════════════════════
function initPhotoGallery() {
  const gallery  = document.getElementById('photo-gallery');
  const lightbox = document.getElementById('lightbox');
  const lbImg    = document.getElementById('lightbox-img');
  const lbClose  = document.getElementById('lightbox-close');

  if (!gallery) return;

  // 選取有代表性的圖片（使用較大尺寸者）
  const photoNums = [7, 8, 9, 10, 11, 12, 13, 14, 15, 17, 18, 19];
  photoNums.forEach(n => {
    const num  = String(n).padStart(2, '0');
    const src  = `12導程貼圖照片/LINE_ALBUM_救護平板EKG傳輸照片_260612_${n}.jpg`;
    const img  = document.createElement('img');
    img.className   = 'gallery-photo';
    img.src         = src;
    img.alt         = `12導程教學示範圖 ${num}`;
    img.loading     = 'lazy';
    img.addEventListener('click', () => {
      lbImg.src = src;
      lbImg.alt = `12導程教學示範圖 ${num}（放大）`;
      lightbox.classList.add('open');
    });
    gallery.appendChild(img);
  });

  // 關閉燈箱
  function closeLightbox() {
    lightbox.classList.remove('open');
    lbImg.src = '';
  }
  lbClose.addEventListener('click', closeLightbox);
  lightbox.addEventListener('click', e => { if (e.target === lightbox) closeLightbox(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeLightbox(); });
}

// ═══════════════════════════════════════════════
// 6. 判讀測驗（10 題）
// ═══════════════════════════════════════════════
const QUIZ_DATA = [
  {
    q: '下列哪一項最能代表「STEMI」的典型心電圖表現？',
    choices: ['ST 段抬高 ≥ 2mm 出現在 V2–V4', 'T 波倒置出現在 aVR', 'PR 段延長 > 0.20 秒', 'QRS 波寬度 > 0.12 秒'],
    a: 0,
    expl: '前壁 STEMI 的典型表現是 V2–V4 導程出現 ST 段顯著抬高（男性 ≥ 2mm，女性 ≥ 1.5mm），代表 LAD 動脈阻塞。',
  },
  {
    q: '心室頻脈（VT）在心電圖上最常見的特徵是？',
    choices: ['QRS 寬 ≥ 0.12 秒、心率 > 100 bpm', '窄 QRS、規則節律、心率 150 bpm', 'PR 間期 > 0.20 秒', '多形性 P 波'],
    a: 0,
    expl: 'VT 源自心室，電氣傳導走旁路，因此 QRS 寬而怪異（≥ 0.12 秒），心率通常超過 100 bpm（多為 150–200 bpm）。',
  },
  {
    q: '正常竇性心律（Normal Sinus Rhythm）的 PR 間期範圍為？',
    choices: ['0.12–0.20 秒', '0.06–0.10 秒', '0.20–0.28 秒', '< 0.10 秒'],
    a: 0,
    expl: 'PR 間期代表電氣從竇房結傳至心室的時間。正常範圍為 0.12–0.20 秒（心電圖紙上為 3–5 小格）。',
  },
  {
    q: '心電圖顯示 II、III、aVF 導程 ST 段抬高，最可能為哪個部位的心肌梗塞？',
    choices: ['下壁心肌梗塞（右冠狀動脈供應區）', '前壁心肌梗塞（LAD 供應區）', '側壁心肌梗塞（LCx 供應區）', '後壁心肌梗塞'],
    a: 0,
    expl: 'II、III、aVF 是觀察心臟下壁的導程，ST 抬高代表下壁 STEMI，通常由右冠狀動脈（RCA）阻塞引起。',
  },
  {
    q: '心室顫動（VF）在心電圖上的外觀最像什麼？',
    choices: ['完全不規則的混亂波形，無法辨識 QRS', '規則且迅速的寬 QRS 波', '細小且規律的鋸齒波', 'P 波消失但 QRS 規則'],
    a: 0,
    expl: 'VF 是最致命的心律不整，心電圖表現為雜亂無章的高低頻波形，完全無法辨識 P 波、QRS 或 T 波，需立即去顫。',
  },
  {
    q: '心房顫動（Atrial Fibrillation, AF）的典型特徵為？',
    choices: ['R-R 間距不規則，P 波消失，代之以細小顫動波', '規則心率、P 波清晰、QRS 寬', 'ST 段抬高、Q 波加深', 'PR 間期逐漸延長直到 QRS 脫落'],
    a: 0,
    expl: 'AF 最重要的診斷依據是 R-R 絕對不規則 + P 波消失（代之以 f 波，約 350–600 次/分），QRS 通常正常寬度。',
  },
  {
    q: '一度房室傳導阻滯（1st degree AV block）定義為？',
    choices: ['PR 間期固定延長 > 0.20 秒', 'PR 間期逐漸延長直到 QRS 脫落', '部分 P 波後沒有 QRS', 'P 波與 QRS 完全無關'],
    a: 0,
    expl: '一度 AV block 的 PR 間期固定（每次都一樣），但延長超過 0.20 秒（5 小格），代表房室結傳導速度減慢。通常屬良性，本身不需特殊處置。',
  },
  {
    q: '胸前電極 V1 的正確黏貼位置是？',
    choices: ['胸骨右緣第 4 肋間', '胸骨左緣第 4 肋間', '左鎖骨中線第 5 肋間', '左前腋線，與 V4 同水平'],
    a: 0,
    expl: 'V1 位於胸骨右緣第 4 肋間，V2 在胸骨左緣第 4 肋間。V1 和 V2 對稱排列，是胸前導程的定位錨點，位置錯誤會嚴重影響判讀品質。',
  },
  {
    q: '有脈搏的心室頻脈（Stable VT）院前首選處置為？',
    choices: ['評估血流動力學穩定性；若不穩定，施予同步整流', '立即 200J 非同步去顫', '給予 Atropine 0.5mg 靜脈注射', '立即進行胸外按壓'],
    a: 0,
    expl: '有脈 VT 需先評估是否血流動力學穩定。若不穩定（低血壓、意識改變），優先同步整流（synchronized cardioversion）100–200J；穩定者可考慮 Amiodarone 藥物治療。',
  },
  {
    q: '下列哪一個「不是」正常竇性心律的診斷標準？',
    choices: ['QRS 寬度 > 0.12 秒', '心率 60–100 次/分', '每個 QRS 前均有 P 波', 'PR 間期 0.12–0.20 秒'],
    a: 0,
    expl: 'QRS 寬度正常應 ≤ 0.12 秒（3 小格）。若 QRS > 0.12 秒，可能代表束支傳導阻滯（BBB）或心室傳導異常，不符合正常竇性心律。',
  },
];

let currentQ     = 0;
let score        = 0;
let answered     = new Array(QUIZ_DATA.length).fill(null); // null=未答, true/false=結果
let quizFinished = false;

function initQuiz() {
  renderQuestion(0);
  document.getElementById('quiz-prev-btn').addEventListener('click', () => {
    if (currentQ > 0) { currentQ--; renderQuestion(currentQ); }
  });
  document.getElementById('quiz-next-btn').addEventListener('click', () => {
    if (currentQ < QUIZ_DATA.length - 1) { currentQ++; renderQuestion(currentQ); }
    else showScoreBoard();
  });
  document.getElementById('quiz-restart-btn').addEventListener('click', restartQuiz);
  document.getElementById('quiz-review-btn').addEventListener('click', showReview);
}

function renderQuestion(idx) {
  const item  = QUIZ_DATA[idx];
  const area  = document.getElementById('quiz-question-area');
  area.replaceChildren();

  // 卡片
  const card = document.createElement('div');
  card.className = 'quiz-card';

  const numDiv = document.createElement('div');
  numDiv.className = 'quiz-number';
  numDiv.textContent = `題目 ${idx + 1} / ${QUIZ_DATA.length}`;
  card.appendChild(numDiv);

  const qDiv = document.createElement('div');
  qDiv.className = 'quiz-question';
  qDiv.textContent = item.q;
  card.appendChild(qDiv);

  const choicesDiv = document.createElement('div');
  choicesDiv.className = 'quiz-choices';

  const LABELS = ['A', 'B', 'C', 'D'];
  item.choices.forEach((choice, ci) => {
    const btn = document.createElement('button');
    btn.className = 'choice-btn';
    btn.id = `choice-${idx}-${ci}`;

    const label = document.createElement('span');
    label.className = 'choice-label';
    label.textContent = LABELS[ci];
    btn.appendChild(label);

    const text = document.createElement('span');
    text.textContent = choice;
    btn.appendChild(text);

    // 如果已答過，恢復狀態
    if (answered[idx] !== null) {
      btn.disabled = true;
      if (ci === item.a)         btn.classList.add('correct');
      else if (ci === answered[idx] && answered[idx] !== item.a) btn.classList.add('wrong');
    }

    btn.addEventListener('click', () => handleAnswer(idx, ci, card));
    choicesDiv.appendChild(btn);
  });
  card.appendChild(choicesDiv);

  // 解析區
  const expl = document.createElement('div');
  expl.className = 'quiz-explanation';
  expl.id = `expl-${idx}`;
  expl.textContent = `📖 解析：${item.expl}`;
  if (answered[idx] !== null) expl.classList.add('show');
  card.appendChild(expl);

  area.appendChild(card);

  // 更新進度條
  updateProgress(idx);
}

function handleAnswer(qIdx, choiceIdx, card) {
  if (answered[qIdx] !== null) return;
  answered[qIdx] = choiceIdx;
  const item   = QUIZ_DATA[qIdx];
  const isCorr = choiceIdx === item.a;
  if (isCorr) score++;

  // 更新按鈕外觀
  const buttons = card.querySelectorAll('.choice-btn');
  buttons.forEach((btn, ci) => {
    btn.disabled = true;
    if (ci === item.a)  btn.classList.add('correct');
    if (ci === choiceIdx && !isCorr) btn.classList.add('wrong');
  });

  // 顯示解析
  document.getElementById(`expl-${qIdx}`).classList.add('show');

  // 啟用下一題按鈕
  const nextBtn = document.getElementById('quiz-next-btn');
  nextBtn.disabled = false;
  if (qIdx === QUIZ_DATA.length - 1) {
    nextBtn.textContent = '查看成績 →';
  }

  updateProgress(qIdx);
  document.getElementById('quiz-score-text').textContent = `得分：${score}`;
}

function updateProgress(idx) {
  const fill    = document.getElementById('quiz-progress-fill');
  const text    = document.getElementById('quiz-progress-text');
  const prevBtn = document.getElementById('quiz-prev-btn');
  const nextBtn = document.getElementById('quiz-next-btn');

  const pct = ((idx + 1) / QUIZ_DATA.length) * 100;
  fill.style.width = `${pct}%`;
  text.textContent = `第 ${idx + 1} 題 / 共 ${QUIZ_DATA.length} 題`;

  prevBtn.disabled = idx === 0;
  if (!quizFinished) {
    nextBtn.disabled = answered[idx] === null;
    nextBtn.textContent = idx === QUIZ_DATA.length - 1 ? '查看成績 →' : '下一題 →';
  }
}

function showScoreBoard() {
  quizFinished = true;
  document.getElementById('quiz-question-area').style.display = 'none';
  document.getElementById('quiz-nav').style.display = 'none';
  document.getElementById('quiz-progress-wrap').style.display = 'none';

  const board = document.getElementById('quiz-score-board');
  board.style.display = 'block';
  document.getElementById('score-num').textContent = score;

  const pct = score / QUIZ_DATA.length;
  let msg, detail;
  if (pct >= 0.9) {
    msg = '🏆 優秀！心電圖判讀達人！';
    detail = '你對心電圖的理解非常深入，繼續保持！';
    document.getElementById('score-circle').style.borderColor = 'var(--ecg-green)';
  } else if (pct >= 0.7) {
    msg = '👍 不錯！再複習幾個重點';
    detail = '大部分題目都掌握了，可回顧答錯的題目加強。';
    document.getElementById('score-circle').style.borderColor = 'var(--ecg-blue)';
  } else if (pct >= 0.5) {
    msg = '📚 繼續加油！';
    detail = '建議回到「基礎課程」模組複習，再來挑戰一次。';
    document.getElementById('score-circle').style.borderColor = 'var(--ecg-yellow)';
  } else {
    msg = '💪 加油！別灰心，多練習就好';
    detail = '心電圖判讀需要反覆練習，從基礎課程開始吧！';
    document.getElementById('score-circle').style.borderColor = 'var(--ecg-red)';
  }
  document.getElementById('score-msg').textContent    = msg;
  document.getElementById('score-detail').textContent = detail;
}

function restartQuiz() {
  score        = 0;
  currentQ     = 0;
  answered     = new Array(QUIZ_DATA.length).fill(null);
  quizFinished = false;

  document.getElementById('quiz-score-board').style.display  = 'none';
  document.getElementById('quiz-review-area').style.display  = 'none';
  document.getElementById('quiz-question-area').style.display = '';
  document.getElementById('quiz-nav').style.display          = '';
  document.getElementById('quiz-progress-wrap').style.display = '';
  document.getElementById('quiz-score-text').textContent     = '得分：0';

  renderQuestion(0);
}

function showReview() {
  const reviewArea = document.getElementById('quiz-review-area');
  reviewArea.style.display = 'block';
  reviewArea.replaceChildren();

  const title = document.createElement('h3');
  title.textContent = '📋 全部題目解析';
  title.style.cssText = 'color:var(--text-primary);font-size:1rem;margin-bottom:1rem;';
  reviewArea.appendChild(title);

  QUIZ_DATA.forEach((item, idx) => {
    const card = document.createElement('div');
    card.className = 'quiz-card';
    card.style.marginBottom = '1rem';

    const isCorr = answered[idx] === item.a;
    const tag = document.createElement('div');
    tag.style.cssText = `font-size:0.72rem;font-weight:700;margin-bottom:0.3rem;color:${isCorr ? 'var(--ecg-green)' : 'var(--ecg-red)'};`;
    tag.textContent = `題目 ${idx + 1} — ${isCorr ? '✅ 正確' : '✖ 答錯'}`;
    card.appendChild(tag);

    const q = document.createElement('div');
    q.style.cssText = 'font-size:0.88rem;font-weight:600;color:var(--text-primary);margin-bottom:0.5rem;';
    q.textContent = item.q;
    card.appendChild(q);

    const ansDiv = document.createElement('div');
    ansDiv.style.cssText = 'font-size:0.82rem;color:var(--ecg-green);margin-bottom:0.4rem;';
    ansDiv.textContent = `✔ 正確答案：${item.choices[item.a]}`;
    card.appendChild(ansDiv);

    const expl = document.createElement('div');
    expl.style.cssText = 'font-size:0.8rem;color:var(--text-secondary);';
    expl.textContent = `📖 ${item.expl}`;
    card.appendChild(expl);

    reviewArea.appendChild(card);
  });

  reviewArea.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ═══════════════════════════════════════════════
// 7. 上傳分析
// ═══════════════════════════════════════════════
function initUploadAnalysis() {
  const zone      = document.getElementById('upload-zone');
  const input     = document.getElementById('ecg-file-input');
  const canvas    = document.getElementById('ecg-canvas-preview');
  const analyzeBtn = document.getElementById('analyze-btn');
  const result    = document.getElementById('analysis-result');
  const resultTitle = document.getElementById('result-title');
  const resultBody  = document.getElementById('result-body');
  const resultImg   = document.getElementById('result-ref-img');

  if (!zone) return;
  let uploadedFile = null;

  // 拖曳高亮
  zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('drag-over'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
  zone.addEventListener('drop', e => {
    e.preventDefault();
    zone.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith('image/')) loadFile(file);
  });

  input.addEventListener('change', e => {
    const file = e.target.files[0];
    if (file) loadFile(file);
  });

  function loadFile(file) {
    uploadedFile = file;
    const img = new Image();
    img.onload = () => {
      canvas.width  = img.naturalWidth;
      canvas.height = img.naturalHeight;
      canvas.style.display = 'block';
      canvas.getContext('2d').drawImage(img, 0, 0);
      URL.revokeObjectURL(img.src);
    };
    img.src = URL.createObjectURL(file);
    result.style.display = 'none';
  }

  analyzeBtn.addEventListener('click', () => {
    if (!uploadedFile) {
      alert('請先上傳心電圖圖檔！');
      return;
    }
    const fn = uploadedFile.name.toLowerCase();

    result.style.display = 'block';
    // 清除舊 class
    result.classList.remove('stemi', 'vt', 'normal');
    resultImg.style.display = 'none';

    if (fn.includes('stemi')) {
      result.classList.add('stemi');
      resultTitle.className = 'result-title stemi';
      resultTitle.textContent = '🔴 判讀結果：疑似 STEMI（ST 段抬高型心肌梗塞）';
      resultBody.textContent = '偵測到 STEMI 典型特徵：建議立即確認 II、III、aVF 或 V2–V4 導程，測量 ST 段抬高幅度，啟動急性冠狀動脈症候群（ACS）院前流程，提前通報醫院。';
      resultImg.src  = 'Stemi.png';
      resultImg.alt  = 'STEMI 心電圖參考圖';
      resultImg.style.display = 'block';
    } else if (fn.includes('vt')) {
      result.classList.add('vt');
      resultTitle.className = 'result-title vt';
      resultTitle.textContent = '🟡 判讀結果：疑似 VT（心室頻脈）';
      resultBody.textContent = '偵測到 VT 典型特徵：QRS 寬（≥0.12s）、心率快。請評估患者是否有脈搏及血流動力學穩定性，視情況施予同步整流或藥物治療。';
      resultImg.src  = 'VT.png';
      resultImg.alt  = 'VT 心電圖參考圖';
      resultImg.style.display = 'block';
    } else if (fn.includes('無明顯') || fn.includes('normal')) {
      result.classList.add('normal');
      resultTitle.className = 'result-title normal';
      resultTitle.textContent = '🟢 判讀結果：無明顯危急心律特徵';
      resultBody.textContent = '未偵測到 STEMI 或 VT 典型特徵。仍建議結合臨床症狀（胸痛、意識改變、血壓數值）進行全面評估，切勿單獨依賴心電圖。';
      resultImg.src  = '無明顯.png';
      resultImg.alt  = '正常心電圖參考圖';
      resultImg.style.display = 'block';
    } else {
      result.classList.add('normal');
      resultTitle.className = 'result-title';
      resultTitle.style.color = 'var(--text-secondary)';
      resultTitle.textContent = '⚙️ 判讀提示：請由教學者說明';
      resultBody.textContent = `已載入檔案「${uploadedFile.name}」。建議教學者現場引導學員進行系統化判讀：① 心率 → ② 節律 → ③ P波 → ④ PR間期 → ⑤ QRS寬度 → ⑥ ST段 → ⑦ T波。`;
    }
  });
}

// ═══════════════════════════════════════════════
// 8. 心律判讀練習模組
// ═══════════════════════════════════════════════

// 八種心律的醫學波形定義（歸一化 0→1 時間，-1→1 振幅）
const RHYTHM_DEFS = {
  nsr: {
    name: '正常竇性心律（Normal Sinus Rhythm）',
    rate: 75,
    color: '#00FF88',
    // P-Q-R-S-T 標準波形
    segments: [
      [0.00,0],[0.05,0],[0.07,0.15],[0.09,0.10],[0.11,0],  // P 波
      [0.13,0],[0.15,-0.08],                                 // PR 段
      [0.16,-0.25],[0.18,1.0],[0.20,-0.35],[0.22,0],        // QRS
      [0.27,0],[0.30,0.18],[0.38,0.22],[0.46,0],            // ST + T
      [0.55,0],[1.00,0]
    ],
    info: {
      title: '🟢 正常竇性心律',
      criteria: ['心率 60–100 次/分，節律規則','每個 QRS 前有 P 波，形態一致','PR 間期 0.12–0.20 秒（3–5 小格）','QRS 寬度 ≤ 0.12 秒（3 小格以內）','ST 段貼近基線，T 波直立（aVR 除外）'],
      action: '✅ 正常心律不代表無危急病況，仍須結合臨床症狀（胸痛、意識改變、血壓異常）整體評估。'
    }
  },
  svt: {
    name: '上心室頻脈（SVT）',
    rate: 170,
    color: '#FFD166',
    // P 波可能埋入 T 波，QRS 窄，節律極規則
    segments: [
      [0.00,0],[0.03,0.08],[0.05,0],      // 小 P 波（可能不清晰）
      [0.06,-0.10],[0.07,0.85],[0.09,-0.22],[0.11,0], // QRS
      [0.14,0],[0.18,0.12],[0.24,0],      // T 波
      [0.30,0],[1.00,0]
    ],
    info: {
      title: '🟡 上心室頻脈（SVT）',
      criteria: ['心率 150–250 次/分，節律極規則','P 波常埋入 T 波或不可見','QRS 窄（≤ 0.12 秒）','突發突止為典型特徵','最常見：AVNRT（房室結折返性頻脈）'],
      action: '⚠️ 院前處置：嘗試迷走神經刺激（Valsalva）；若血流動力學不穩定，立即同步整流 50–100J。'
    }
  },
  af: {
    name: '心房顫動（Atrial Fibrillation）',
    rate: 90,
    color: '#06B6D4',
    // 無 P 波，R-R 絕對不規則，有 f 波基線
    segments: null, // 特殊：由 drawAF 函式生成
    info: {
      title: '🔵 心房顫動（AF）',
      criteria: ['P 波消失，代之以不規則細小 f 波（350–600 次/分）','R-R 間距完全不規則（絕對不整脈）','QRS 通常正常寬度（≤ 0.12 秒）','心室率視房室結傳導而異（通常 60–150 次/分）','慢性 AF 可能合併心衰竭、腦梗塞風險'],
      action: '⚠️ 院前評估：心率控制 vs. 節律控制。若合併急性血流動力學不穩定，考慮同步整流；長期 AF 需評估抗凝治療風險。'
    }
  },
  vt: {
    name: '心室頻脈（Ventricular Tachycardia）',
    rate: 160,
    color: '#FF4E6A',
    // 寬 QRS，異常形態，無正常 P 波
    segments: [
      [0.00,0],[0.02,-0.12],[0.06,0.90],[0.10,-0.45],[0.16,-0.20],[0.22,0], // 寬怪 QRS
      [0.27,0.10],[0.38,-0.12],[0.45,0], // 異常 ST-T
      [0.55,0],[1.00,0]
    ],
    info: {
      title: '🔴 心室頻脈（VT）',
      criteria: ['心率 100–250 次/分（多為 150–200 bpm）','QRS 寬且怪異（≥ 0.12 秒），形態異常','通常無正常 P 波，或 P 波與 QRS 無關（房室分離）','節律多半規則','可能伴隨或退化為心室顫動（VF）'],
      action: '🚨 院前處置：有脈→評估穩定性→若不穩定立即同步整流 100–200J；無脈 VT＝VF 處置→立即非同步去顫 200J（雙相）。'
    }
  },
  vf: {
    name: '心室顫動（Ventricular Fibrillation）',
    rate: 0,
    color: '#FF4E6A',
    segments: null, // 特殊：由 drawVF 函式生成
    info: {
      title: '⚫ 心室顫動（VF）',
      criteria: ['完全混亂、不規則、無法辨識的波形','無 P 波、無 QRS、無 T 波','振幅高低不一（粗 VF vs. 細 VF）','心臟無有效排血 → 無脈搏 → 心跳停止'],
      action: '🚨 立即處置：CPR + 最短時間非同步去顫 200J（雙相）。每 2 分鐘換人 CPR，盡量縮短按壓中斷。這是最緊急的心律。'
    }
  },
  sb: {
    name: '竇性心搏過緩（Sinus Bradycardia）',
    rate: 40,
    color: '#7CD4FD',
    // 標準 PQRST 但心率慢
    segments: [
      [0.00,0],[0.04,0],[0.06,0.15],[0.08,0.10],[0.10,0],
      [0.12,0],[0.14,-0.08],
      [0.15,-0.25],[0.17,1.0],[0.19,-0.35],[0.21,0],
      [0.26,0],[0.30,0.18],[0.38,0.22],[0.46,0],
      [0.55,0],[1.00,0]
    ],
    info: {
      title: '🩵 竇性心搏過緩（Sinus Bradycardia）',
      criteria: ['心率 < 60 次/分','P 波正常，每個 QRS 前均有 P 波','PR 間期、QRS 寬度均正常','TP 段延長（兩次心跳間距變長）'],
      action: '⚠️ 症狀性緩脈（低血壓、意識改變）處置：Atropine 0.5mg 靜脈注射（可重複至 3mg）；無效考慮體外節律器（Transcutaneous Pacing）。'
    }
  },
  avb3: {
    name: '三度房室傳導阻滯（Complete AV Block）',
    rate: 35,
    color: '#FB923C',
    // P 波與 QRS 完全無關（房室分離），心室自搏
    segments: null, // 特殊：由 drawAVB3 函式生成
    info: {
      title: '🟠 三度房室傳導阻滯（Complete AV Block）',
      criteria: ['P 波規則出現（心房率 60–100 次/分）','QRS 完全與 P 波無關（房室分離）','心室靠逸搏節律維持（30–45 bpm），QRS 可能寬','P 波可能落在 QRS 前、中、後，PR 間期不固定','為最嚴重的房室傳導阻滯'],
      action: '🚨 緊急處置：Atropine 通常無效；立即準備體外節律器（TCP），考慮 Dopamine/Epinephrine 維持血壓，準備永久心律器植入。'
    }
  },
  pea: {
    name: '無脈性電氣活動（PEA）',
    rate: 60,
    color: '#A78BFA',
    // 有 QRS 波形但患者無脈搏 — 外觀可能類似正常
    segments: [
      [0.00,0],[0.05,0],[0.07,0.12],[0.09,0],
      [0.11,0],[0.13,-0.05],
      [0.14,-0.20],[0.16,0.75],[0.18,-0.25],[0.20,0],
      [0.25,0],[0.28,0.15],[0.36,0.18],[0.44,0],
      [0.55,0],[1.00,0]
    ],
    info: {
      title: '🔵 無脈性電氣活動（PEA）',
      criteria: ['心電圖可見任何有組織的心律（常見竇性或寬QRS）','但臨床上：觸摸不到脈搏','屬心跳停止的一型，需立即 CPR','常見可逆原因（4H4T）：低血容、低血氧、張力性氣胸、心包填塞…'],
      action: '🚨 立即 CPR！尋找並處置可逆原因（4H4T）：Hypovolemia, Hypoxia, Hypothermia, H⁺（酸中毒）, Tension pneumothorax, Tamponade, Toxins, Thrombosis。'
    }
  }
};

// 挑戰模式題庫
const CHALLENGE_POOL = [
  { rhythm: 'nsr', distractors: ['svt','af','sb'] },
  { rhythm: 'svt', distractors: ['nsr','vt','af'] },
  { rhythm: 'af',  distractors: ['nsr','svt','avb3'] },
  { rhythm: 'vt',  distractors: ['vf','svt','nsr'] },
  { rhythm: 'vf',  distractors: ['vt','af','pea'] },
  { rhythm: 'sb',  distractors: ['avb3','nsr','pea'] },
  { rhythm: 'avb3',distractors: ['sb','af','pea'] },
  { rhythm: 'pea', distractors: ['nsr','sb','vt'] },
];

function initPractice() {
  const canvas       = document.getElementById('practice-ecg-canvas');
  if (!canvas) return;
  const ctx          = canvas.getContext('2d');

  // UI 元素
  const rateDisplay      = document.getElementById('practice-rate-display');
  const rhythmDisplay    = document.getElementById('practice-rhythm-display');
  const rhythmSelector   = document.getElementById('practice-rhythm-selector');
  const infoCard         = document.getElementById('practice-info-card');
  const infoTitle        = document.getElementById('practice-info-title');
  const infoList         = document.getElementById('practice-info-list');
  const infoAction       = document.getElementById('practice-info-action');
  const challengeArea    = document.getElementById('practice-challenge-area');
  const challengeChoices = document.getElementById('practice-challenge-choices');
  const challengeResult  = document.getElementById('practice-challenge-result');
  const challengeNext    = document.getElementById('practice-challenge-next');
  const scoreDisplay     = document.getElementById('practice-score-display');
  const learnBtn         = document.getElementById('practice-mode-learn');
  const challengeBtn     = document.getElementById('practice-mode-challenge');

  // 狀態
  let currentRhythm = 'nsr';
  let practiceMode  = 'learn';  // 'learn' | 'challenge'
  let animId        = null;
  let offset        = 0;
  let challengeScore = 0;
  let challengeTotal = 0;
  let challengeQueue = [];
  let challengeCurrent = null;
  let challengeAnswered = false;

  // 畫布尺寸
  function resizeCanvas() {
    const wrap = canvas.parentElement;
    canvas.width  = wrap.clientWidth || 700;
    canvas.height = Math.min(220, window.innerHeight * 0.25);
  }
  resizeCanvas();
  window.addEventListener('resize', () => { resizeCanvas(); });

  // ─── 波形繪製工具 ───────────────────────────────
  function interpolateWaveform(segs, t) {
    for (let i = 0; i < segs.length - 1; i++) {
      const [t0, a0] = segs[i];
      const [t1, a1] = segs[i + 1];
      if (t >= t0 && t <= t1) {
        const r = (t - t0) / (t1 - t0 || 1);
        return a0 + (a1 - a0) * r;
      }
    }
    return 0;
  }

  function drawStandardWave(def) {
    const W = canvas.width, H = canvas.height;
    const amp = H * 0.35;
    const yBase = H * 0.55;
    const bpm = def.rate;
    const cyclePx = bpm > 0 ? Math.round(W * 60 / bpm / 2.5) : W; // ~2.5s 可視區

    ctx.clearRect(0, 0, W, H);
    drawGrid(W, H);

    ctx.beginPath();
    ctx.strokeStyle = def.color;
    ctx.lineWidth   = 2;
    ctx.shadowColor = def.color;
    ctx.shadowBlur  = 6;

    for (let px = 0; px < W; px++) {
      const t = ((px + offset) % cyclePx) / cyclePx;
      const a = interpolateWaveform(def.segments, t);
      const y = yBase - a * amp;
      if (px === 0) ctx.moveTo(px, y); else ctx.lineTo(px, y);
    }
    ctx.stroke();
    ctx.shadowBlur = 0;
  }

  function drawAF() {
    const W = canvas.width, H = canvas.height;
    const amp = H * 0.32;
    const yBase = H * 0.55;
    const cyclePx = Math.round(W * 0.28);

    ctx.clearRect(0, 0, W, H);
    drawGrid(W, H);

    // f 波基線（雜亂細小波）
    ctx.beginPath();
    ctx.strokeStyle = 'rgba(6,182,212,0.4)';
    ctx.lineWidth = 1;
    for (let px = 0; px < W; px++) {
      const noise = Math.sin((px + offset) * 0.28) * 0.06
                  + Math.sin((px + offset) * 0.53) * 0.04
                  + Math.sin((px + offset) * 0.71) * 0.03;
      const y = yBase + noise * amp;
      if (px === 0) ctx.moveTo(px, y); else ctx.lineTo(px, y);
    }
    ctx.stroke();

    // 不規則 QRS（用種子決定間距）
    ctx.beginPath();
    ctx.strokeStyle = '#06B6D4';
    ctx.lineWidth = 2;
    ctx.shadowColor = '#06B6D4';
    ctx.shadowBlur  = 6;

    // 生成偽隨機 R-R 間距序列（固定種子，每次相同）
    const rr = [0.28, 0.22, 0.31, 0.19, 0.26, 0.34, 0.20, 0.29, 0.23, 0.33, 0.18];
    let pos = 0, drawn = false;
    while (pos < 1.5) {
      const rrIdx = Math.floor(pos * 10) % rr.length;
      const rrLen = rr[rrIdx];
      const startPx = ((pos * W * 1.5 - offset * 0.8) % (W * 1.5));
      // QRS 繪製
      const qrs = [[0,0],[-0.02,-0.18],[0,0.85],[0.04,-0.32],[0.07,0]];
      qrs.forEach(([dt, da], i) => {
        const x = startPx + dt * W * 0.15;
        const y = yBase - da * amp;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      });
      pos += rrLen;
      drawn = true;
    }
    if (drawn) ctx.stroke();
    ctx.shadowBlur = 0;
  }

  function drawVF() {
    const W = canvas.width, H = canvas.height;
    const yBase = H * 0.5;

    ctx.clearRect(0, 0, W, H);
    drawGrid(W, H);

    ctx.beginPath();
    ctx.strokeStyle = '#FF4E6A';
    ctx.lineWidth   = 2;
    ctx.shadowColor = '#FF4E6A';
    ctx.shadowBlur  = 8;

    for (let px = 0; px < W; px++) {
      const t = (px + offset) * 0.04;
      const amp = H * (0.20 + 0.15 * Math.abs(Math.sin(t * 0.31)));
      const y = yBase
        + amp * (Math.sin(t) * 0.7
        + Math.sin(t * 1.73) * 0.5
        + Math.sin(t * 2.41) * 0.3
        + Math.sin(t * 3.14) * 0.2);
      if (px === 0) ctx.moveTo(px, y); else ctx.lineTo(px, y);
    }
    ctx.stroke();
    ctx.shadowBlur = 0;
  }

  function drawAVB3() {
    // 心房：規則 P 波（80bpm），心室：慢逸搏（35bpm），兩者完全無關
    const W = canvas.width, H = canvas.height;
    const amp    = H * 0.35;
    const yBase  = H * 0.55;
    const pCycle = Math.round(W * 60 / 80 / 2.5);   // P 波週期像素
    const qCycle = Math.round(W * 60 / 35 / 2.5);   // QRS 週期像素
    const qrsSegs = [[0,0],[0.03,-0.22],[0.07,0.85],[0.13,-0.38],[0.18,0],[0.30,0.10],[0.45,0],[1.0,0]];
    const pSegs   = [[0,0],[0.15,0.15],[0.30,0.10],[0.45,0],[1.0,0]];

    ctx.clearRect(0, 0, W, H);
    drawGrid(W, H);

    // P 波（較小振幅）
    ctx.beginPath();
    ctx.strokeStyle = 'rgba(251,146,60,0.6)';
    ctx.lineWidth   = 1.5;
    for (let px = 0; px < W; px++) {
      const t = ((px + offset * 0.44) % pCycle) / pCycle;
      const a = interpolateWaveform(pSegs, t) * 0.4;
      const y = yBase - a * amp;
      if (px === 0) ctx.moveTo(px, y); else ctx.lineTo(px, y);
    }
    ctx.stroke();

    // 心室逸搏 QRS（寬）
    ctx.beginPath();
    ctx.strokeStyle = '#FB923C';
    ctx.lineWidth   = 2.5;
    ctx.shadowColor = '#FB923C';
    ctx.shadowBlur  = 7;
    for (let px = 0; px < W; px++) {
      const t = ((px + offset) % qCycle) / qCycle;
      const a = interpolateWaveform(qrsSegs, t);
      const y = yBase - a * amp;
      if (px === 0) ctx.moveTo(px, y); else ctx.lineTo(px, y);
    }
    ctx.stroke();
    ctx.shadowBlur = 0;
  }

  // 心電圖方格紙背景
  function drawGrid(W, H) {
    ctx.strokeStyle = 'rgba(255,255,255,0.04)';
    ctx.lineWidth   = 0.5;
    const smallCell = 10;
    for (let x = 0; x < W; x += smallCell) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
    }
    for (let y = 0; y < H; y += smallCell) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
    }
    // 粗格
    ctx.strokeStyle = 'rgba(255,255,255,0.09)';
    ctx.lineWidth   = 1;
    for (let x = 0; x < W; x += smallCell * 5) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
    }
    for (let y = 0; y < H; y += smallCell * 5) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
    }
  }

  // ─── 主動畫迴圈 ─────────────────────────────────
  function animate() {
    const def = RHYTHM_DEFS[currentRhythm];
    if (currentRhythm === 'af')   drawAF();
    else if (currentRhythm === 'vf') drawVF();
    else if (currentRhythm === 'avb3') drawAVB3();
    else drawStandardWave(def);

    offset = (offset + 1.6) % 10000;
    animId = requestAnimationFrame(animate);
  }

  function startAnimation() {
    if (animId) cancelAnimationFrame(animId);
    animate();
  }

  // ─── 學習模式：更新說明卡 ────────────────────────
  function updateInfoCard(rhythmKey) {
    const def  = RHYTHM_DEFS[rhythmKey];
    const info = def.info;

    infoTitle.textContent = info.title;
    infoList.replaceChildren();
    info.criteria.forEach(c => {
      const li = document.createElement('li');
      const ci = document.createElement('span');
      ci.className   = 'ci';
      ci.textContent = '▶';
      li.appendChild(ci);
      li.append(' ' + c);
      infoList.appendChild(li);
    });
    infoAction.textContent = info.action;

    // 更新 HUD
    rateDisplay.textContent    = def.rate > 0 ? `❤️ ${def.rate} bpm` : '❤️ 無有效脈搏';
    rhythmDisplay.textContent  = practiceMode === 'learn' ? def.name : '';
    rateDisplay.style.color    = def.color;
  }

  // ─── 切換心律（學習模式）────────────────────────
  function switchRhythm(rhythmKey) {
    currentRhythm = rhythmKey;
    document.querySelectorAll('.rhythm-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.rhythm === rhythmKey);
    });
    if (practiceMode === 'learn') updateInfoCard(rhythmKey);
  }

  // ─── 挑戰模式 ────────────────────────────────────
  function buildChallengeQueue() {
    challengeQueue = [...CHALLENGE_POOL].sort(() => Math.random() - 0.5);
  }

  function nextChallengeQuestion() {
    if (challengeQueue.length === 0) {
      // 全部完成，顯示成績
      challengeResult.innerHTML =
        `<strong style="color:var(--ecg-green);font-size:1rem;">🏆 挑戰完成！得分：${challengeScore} / ${challengeTotal}</strong>` +
        `<br><span style="color:var(--text-secondary);font-size:0.85rem;">點擊「下一題」重新開始</span>`;
      challengeResult.style.display = 'block';
      challengeNext.style.display   = 'block';
      challengeNext.textContent      = '🔄 重新挑戰';
      scoreDisplay.textContent       = `得分 ${challengeScore}/${challengeTotal}`;
      challengeAnswered = true;
      return;
    }

    challengeAnswered   = false;
    challengeCurrent    = challengeQueue.pop();
    currentRhythm       = challengeCurrent.rhythm;
    challengeResult.style.display = 'none';
    challengeNext.style.display   = 'none';

    // 更新 HUD（隱藏名稱）
    const def = RHYTHM_DEFS[currentRhythm];
    rateDisplay.textContent   = def.rate > 0 ? `❤️ ${def.rate} bpm` : '❤️ 無有效脈搏';
    rhythmDisplay.textContent = '？ 你能辨識這個心律嗎？';
    rateDisplay.style.color   = '#fff';

    // 建立選項（正確 + 3 個干擾）
    const choices = [currentRhythm, ...challengeCurrent.distractors]
      .sort(() => Math.random() - 0.5);

    challengeChoices.replaceChildren();
    const LABELS = ['A', 'B', 'C', 'D'];
    choices.forEach((rKey, i) => {
      const btn = document.createElement('button');
      btn.className = 'choice-btn';
      const lbl = document.createElement('span');
      lbl.className   = 'choice-label';
      lbl.textContent = LABELS[i];
      btn.appendChild(lbl);
      const txt = document.createElement('span');
      txt.textContent = RHYTHM_DEFS[rKey].name;
      btn.appendChild(txt);
      btn.addEventListener('click', () => handleChallengeAnswer(rKey, btn, choices));
      challengeChoices.appendChild(btn);
    });
  }

  function handleChallengeAnswer(selectedKey, btn, choices) {
    if (challengeAnswered) return;
    challengeAnswered = true;
    challengeTotal++;

    const correct = selectedKey === challengeCurrent.rhythm;
    if (correct) challengeScore++;

    // 標色
    challengeChoices.querySelectorAll('.choice-btn').forEach((b, i) => {
      b.disabled = true;
      if (choices[i] === challengeCurrent.rhythm) b.classList.add('correct');
      else if (b === btn && !correct)              b.classList.add('wrong');
    });

    // 顯示解析
    const def = RHYTHM_DEFS[challengeCurrent.rhythm];
    challengeResult.innerHTML =
      `<div style="color:${correct ? 'var(--ecg-green)' : 'var(--ecg-red)'};font-weight:700;margin-bottom:0.4rem;">
        ${correct ? '✅ 答對了！' : '✖ 答錯，正確答案是：' + def.name}
      </div>
      <ul class="criteria-list" style="font-size:0.82rem;">
        ${def.info.criteria.map(c => `<li><span class="ci">▶</span> ${c}</li>`).join('')}
      </ul>
      <div class="alert-box" style="margin-top:0.5rem;font-size:0.8rem;">${def.info.action}</div>`;
    challengeResult.style.display = 'block';
    challengeNext.style.display   = 'block';
    challengeNext.textContent      = challengeQueue.length > 0 ? '下一題 →' : '查看成績 →';
    scoreDisplay.textContent       = `得分 ${challengeScore}/${challengeTotal}`;

    // 顯示波形名稱
    rhythmDisplay.textContent = def.name;
    rhythmDisplay.style.color = def.color;
  }

  // ─── 模式切換 ────────────────────────────────────
  function setMode(mode) {
    practiceMode = mode;
    if (mode === 'learn') {
      learnBtn.classList.add('active-mode');
      challengeBtn.classList.remove('active-mode');
      rhythmSelector.style.display = 'flex';
      infoCard.style.display       = 'block';
      challengeArea.style.display  = 'none';
      updateInfoCard(currentRhythm);
    } else {
      challengeBtn.classList.add('active-mode');
      learnBtn.classList.remove('active-mode');
      rhythmSelector.style.display = 'none';
      infoCard.style.display       = 'none';
      challengeArea.style.display  = 'block';
      challengeScore = 0;
      challengeTotal = 0;
      buildChallengeQueue();
      nextChallengeQuestion();
      scoreDisplay.textContent = '得分 0/0';
    }
  }

  // ─── 事件綁定 ────────────────────────────────────
  document.querySelectorAll('.rhythm-btn').forEach(btn => {
    btn.addEventListener('click', () => switchRhythm(btn.dataset.rhythm));
  });

  learnBtn.addEventListener('click', () => setMode('learn'));
  challengeBtn.addEventListener('click', () => setMode('challenge'));

  challengeNext.addEventListener('click', () => {
    if (challengeQueue.length === 0 && challengeAnswered) {
      // 重新開始
      challengeScore = 0;
      challengeTotal = 0;
      buildChallengeQueue();
      scoreDisplay.textContent = '得分 0/0';
    }
    nextChallengeQuestion();
  });

  // ─── 初始化 ─────────────────────────────────────
  switchRhythm('nsr');
  updateInfoCard('nsr');
  startAnimation();
}


// ═══════════════════════════════════════════════
// 啟動
// ═══════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', () => {
  initECGBackground();
  initTabs();
  initBasicsTabs();
  initLeadPractice();
  initPhotoGallery();
  initQuiz();
  initUploadAnalysis();
  initPractice();
});
