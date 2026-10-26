// Global Application State Variables
let audioCtx = null;
let globalTimerInterval = null;
let cprTimerInterval = null;
let metronomeInterval = null;
let epinephrineInterval = null;

let startTime = null;
let cprCountdownLeft = 120; // 2 minutes in seconds
let activeCPRMode = '30:2'; // Default mode
let metronomeBeatCount = 0;
let isMetronomeRunning = true;
let isBreathPaused = false;
let screenWakeLock = null;
let recognition = null;
let isListening = false;
let speechRequested = false;
let speechRestartTimer = null;
let missionActive = false;
let missionId = null;
let missionLogs = [];
let missionEndTime = null;

// Circle Stroke Circumference
const ringCircle = document.getElementById('timer-progress-ring');
const ringRadius = ringCircle.r.baseVal.value;
const ringCircumference = 2 * Math.PI * ringRadius; // ~490.088
ringCircle.style.strokeDasharray = `${ringCircumference} ${ringCircumference}`;
ringCircle.style.strokeDashoffset = 0;

// CPR Mode Parameters & Rules
const CPR_MODES = {
  '30:2': { limit: 30, type: 'ratio' },
  '15:2': { limit: 15, type: 'ratio' },
  'CONT': { limit: 0, type: 'cont' },
  'LUCAS': { limit: 11, type: 'lucas' }, // About 6 seconds at 110 BPM
  'ROSC': { limit: 0, type: 'rosc' }
};

const METRONOME_BPM = 110;
const METRONOME_INTERVAL_MS = 60000 / METRONOME_BPM;

// === 1. Launch & Core Audio Hook ===
function startApp() {
  if (missionActive) return;

  // Initialize Web Audio API on first user gesture (highly critical for Safari/iOS compatibility)
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (AudioContextClass) {
    audioCtx = new AudioContextClass();
    if (audioCtx.state === 'suspended') {
      audioCtx.resume();
    }
  }

  // Hide Splash Screen overlay
  document.getElementById('splash-screen').style.display = 'none';

  // Record start time
  startTime = new Date();
  missionEndTime = null;
  missionId = ReportManager.makeId('case');
  missionLogs = [];
  missionActive = true;
  ReportManager.requestPersistentStorage();

  // Request WakeLock to keep screen on
  requestScreenWakeLock();

  // Start Global Timer & CPR 2-minute Cycle Countdown
  globalTimerInterval = setInterval(updateGlobalStopwatch, 1000);
  startCPRCycleTimer();

  // Start Metronome
  startMetronomeTickLoop();

  // Log initial action
  logAction('急救開始', 'rosc');

  // Auto-start Speech Recognition
  if (!recognition) {
    initSpeechRecognition();
  }
  if (recognition) {
    speechRequested = true;
    startSpeechRecognition();
  }
}

// Speech Synthesis (TTS) Helper
function speakText(text) {
  if ('speechSynthesis' in window) {
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'zh-TW';
    utterance.rate = 1.0;
    window.speechSynthesis.speak(utterance);
  }
}

// Speech Recognition Helpers
function initSpeechRecognition() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    console.warn("Speech recognition is not supported in this browser.");
    return;
  }
  
  recognition = new SpeechRecognition();
  recognition.continuous = true;
  recognition.interimResults = false;
  recognition.lang = 'zh-TW';
  
  recognition.onstart = () => {
    isListening = true;
    updateMicUI(true);
  };
  
  recognition.onerror = (event) => {
    console.error("Speech recognition error:", event.error);
    isListening = false;
    const fatalErrors = ['not-allowed', 'service-not-allowed', 'audio-capture'];
    if (fatalErrors.includes(event.error)) {
      speechRequested = false;
    }
    updateMicUI(false);
  };
  
  recognition.onend = () => {
    isListening = false;
    updateMicUI(false);
    if (speechRequested && missionActive) scheduleSpeechRecognitionRestart();
  };
  
  recognition.onresult = (event) => {
    const resultIndex = event.resultIndex;
    const transcript = event.results[resultIndex][0].transcript.trim();
    console.log("Speech recognized:", transcript);
    processSpeechTranscript(transcript);
  };
}

function startSpeechRecognition() {
  if (!recognition || isListening || !speechRequested) return;
  try {
    recognition.start();
  } catch (error) {
    if (error.name !== 'InvalidStateError') {
      console.error('Speech recognition start error:', error);
    }
  }
}

function scheduleSpeechRecognitionRestart() {
  if (speechRestartTimer) clearTimeout(speechRestartTimer);
  speechRestartTimer = setTimeout(() => {
    speechRestartTimer = null;
    startSpeechRecognition();
  }, 500);
}

function toggleSpeechRecognition() {
  if (!recognition) {
    initSpeechRecognition();
  }
  if (!recognition) {
    alert("您的瀏覽器不支援語音辨識功能。");
    return;
  }
  
  if (speechRequested) {
    speechRequested = false;
    if (speechRestartTimer) clearTimeout(speechRestartTimer);
    recognition.stop();
  } else {
    if (audioCtx && audioCtx.state === 'suspended') {
      audioCtx.resume();
    }
    speechRequested = true;
    startSpeechRecognition();
  }
}

function updateMicUI(listening) {
  const btn = document.getElementById('btn-mic-toggle');
  const text = document.getElementById('mic-status-text');
  if (!btn || !text) return;
  
  if (listening) {
    btn.classList.add('listening');
    text.innerText = '語音：開';
  } else {
    btn.classList.remove('listening');
    text.innerText = '語音：關';
  }
}

function processSpeechTranscript(transcript) {
  // Remove punctuation/spaces and normalize English letters so phrases such as
  // "I V / I O" and "ivio" resolve to the same command.
  const cleanText = normalizeVoiceText(transcript);
  const command = VOICE_COMMANDS.find(({ phrases }) =>
    phrases.some(phrase => cleanText.includes(normalizeVoiceText(phrase)))
  );

  if (!command) return;
  logAction(`語音指令: ${command.label}`, 'voice');
  command.action();
}

function logVoiceRecord(text, category = 'type') {
  logAction(text, category);
}

const VOICE_COMMANDS = expandVoiceCommandPhrases([
  // 電擊：較明確的「手動電擊」必須放在一般「電擊」之前。
  { label: '手動電擊', phrases: ['手動電擊完成', '手動電擊已完成'], action: triggerManualShock },
  { label: 'AED 電擊', phrases: ['AED電擊完成', 'AED電擊已完成', '電擊完成'], action: triggerAEDShock },

  // 給藥：必須包含藥名，避免「給藥完成」被誤記為特定藥物。
  { label: 'Epinephrine 1mg', phrases: ['EPINEPHRINE完成', '腎上腺素完成', '腎上腺素一毫克完成', '強心針完成'], action: administerEpinephrine },
  { label: 'Amio 300mg', phrases: ['AMIO三百完成', 'AMIO300完成', 'AMIODARONE三百完成', 'AMIODARONE300完成', '胺碘酮三百完成'], action: () => logVoiceRecord('Amio 300mg', 'drug') },
  { label: 'Amio 150mg', phrases: ['AMIO一百五完成', 'AMIO150完成', 'AMIODARONE一百五完成', 'AMIODARONE一百五十完成', 'AMIODARONE150完成', '胺碘酮一百五完成'], action: () => logVoiceRecord('Amio 150mg', 'drug') },
  { label: 'Amiodarone（劑量未註明）', phrases: ['AMIODARONE完成', 'AMIO完成'], action: () => logVoiceRecord('Amiodarone（劑量未註明）', 'drug') },
  { label: 'Lidocaine', phrases: ['LIDOCAINE完成', '利多卡因完成'], action: () => logVoiceRecord('Lidocaine', 'drug') },
  { label: 'Atropine 1mg', phrases: ['ATROPINE完成', '阿托品完成', '阿托品一毫克完成'], action: () => logVoiceRecord('Atropine 1mg', 'drug') },
  { label: 'Adenosine', phrases: ['ADENOSINE完成', '腺苷完成'], action: () => logVoiceRecord('Adenosine', 'drug') },

  // CPR 與系統控制。
  { label: 'ROSC', phrases: ['確認恢復自發循環', '恢復自發循環', '確認ROSC'], action: triggerROSCState },
  { label: '30:2 模式', phrases: ['三十比二', '30比2'], action: () => setCPRMode('30:2') },
  { label: '15:2 模式', phrases: ['十五比二', '15比2'], action: () => setCPRMode('15:2') },
  { label: '連續按壓模式', phrases: ['切換連續按壓', '連續按壓模式'], action: () => setCPRMode('CONT') },
  { label: '6 秒給氧模式', phrases: ['切換六秒給氧', '六秒給氧模式', '6秒給氧模式'], action: () => setCPRMode('LUCAS') },
  { label: '節拍器開啟', phrases: ['開啟節拍器', '節拍器開'], action: () => setMetronomeRunning(true) },
  { label: '節拍器關閉', phrases: ['關閉節拍器', '節拍器關'], action: () => setMetronomeRunning(false) },

  // 處置與現場時間戳。
  { label: '建立 IV/IO', phrases: ['建立IVIO完成', 'IVIO完成', '靜脈骨內管路完成'], action: () => logVoiceRecord('建立 IV/IO', 'drug') },
  { label: 'LMA 進階呼吸道', phrases: ['LMA完成', '進階呼吸道完成', '喉罩完成'], action: () => recordAirway('LMA') },
  { label: 'ENDO 確切呼吸道', phrases: ['ENDO完成', '確切呼吸道完成', '氣管插管完成', '插管完成'], action: () => recordAirway('ENDO') },
  { label: 'BVM 給氧', phrases: ['BVM給氧完成', '球囊面罩給氧完成', '給氧完成'], action: () => logVoiceRecord('BVM / 給氧處置完成') },
  { label: '胸外按壓換手', phrases: ['胸外按壓換手完成', '按壓換手完成', '換手完成'], action: () => logVoiceRecord('胸外按壓換手') },
  { label: '脈搏檢查', phrases: ['脈搏檢查完成', '檢查脈搏完成'], action: () => logVoiceRecord('脈搏檢查完成') },
  { label: '貼妥電擊貼片', phrases: ['電擊貼片完成', 'AED貼片完成', '貼片完成'], action: () => logVoiceRecord('電擊貼片已貼妥') },
  { label: '5H5T 評估', phrases: ['5H5T完成', '五H五T完成', '5H5T評估完成'], action: () => logVoiceRecord('5H5T 評估') },
  { label: 'OHCA', phrases: ['紀錄OHCA', '患者OHCA'], action: () => logVoiceRecord('患者類別: OHCA') },
  { label: 'IHCA', phrases: ['紀錄IHCA', '患者IHCA'], action: () => logVoiceRecord('患者類別: IHCA') },

  // 心律紀錄：要求「紀錄／確認心律」前綴，降低一般討論造成的誤記。
  { label: '心律 VF', phrases: ['紀錄心律VF', '確認心律VF', '紀錄心室顫動'], action: () => logVoiceRecord('心律評估: VF', 'ecg') },
  { label: '心律 pVT', phrases: ['紀錄心律PVT', '確認心律PVT', '紀錄無脈搏性心室頻脈', '紀錄無脈搏心室頻脈'], action: () => logVoiceRecord('心律評估: pVT', 'ecg') },
  { label: '心律 Asystole', phrases: ['紀錄心律ASYSTOLE', '確認心電停止', '紀錄心電停止'], action: () => logVoiceRecord('心律評估: Asystole', 'ecg') },
  { label: '心律 PEA', phrases: ['紀錄心律PEA', '確認心律PEA', '紀錄無脈搏電氣活動'], action: () => logVoiceRecord('心律評估: PEA', 'ecg') },
  { label: '心律 NSR', phrases: ['紀錄心律NSR', '確認心律NSR', '紀錄正常竇性心律'], action: () => logVoiceRecord('心律評估: NSR', 'ecg') },
  { label: '心律 SB', phrases: ['紀錄心律SB', '確認心律SB', '紀錄竇性心搏過緩', '紀錄竇性心緩'], action: () => logVoiceRecord('心律評估: SB', 'ecg') },
  { label: '心律 ST', phrases: ['紀錄心律ST', '確認心律ST', '紀錄竇性心搏過速', '紀錄竇性心頻'], action: () => logVoiceRecord('心律評估: ST', 'ecg') },
  { label: '心律 SVT', phrases: ['紀錄心律SVT', '確認心律SVT', '紀錄上心室頻脈', '紀錄心室上頻脈'], action: () => logVoiceRecord('心律評估: SVT', 'ecg') },
  { label: '心律 VT', phrases: ['紀錄心律VT', '確認心律VT', '紀錄心室頻脈'], action: () => logVoiceRecord('心律評估: VT', 'ecg') },
  { label: '心律 AFib', phrases: ['紀錄心律AFIB', '確認心房顫動', '紀錄心房顫動'], action: () => logVoiceRecord('心律評估: AFib', 'ecg') },
  { label: '心律 AFlutter', phrases: ['紀錄心律AFLUTTER', '確認心房撲動', '紀錄心房撲動'], action: () => logVoiceRecord('心律評估: AFlutter', 'ecg') },
  { label: '心律 AVB', phrases: ['紀錄心律AVB', '確認房室傳導阻滯', '紀錄房室傳導阻滯'], action: () => logVoiceRecord('心律評估: AVB', 'ecg') }
]);

// Build the reference from the actual recognition phrases so it stays in sync.
function openVoiceGuide() {
  const dialog = document.getElementById('voice-guide-dialog');
  const container = document.getElementById('voice-guide-commands');
  if (!dialog || !container) return;
  container.replaceChildren();
  const drugLabels = new Set(['Epinephrine 1mg', 'Amio 300mg', 'Amio 150mg', 'Amiodarone（劑量未註明）', 'Lidocaine', 'Atropine 1mg', 'Adenosine']);
  const groupFor = label => {
    if (label.startsWith('心律 ')) return '心律紀錄';
    if (drugLabels.has(label)) return '給藥紀錄';
    if (label === 'AED 電擊' || label === '手動電擊') return '電擊紀錄';
    if (label === 'ROSC' || /模式|節拍器/.test(label)) return 'CPR、節拍器與 ROSC';
    return '呼吸道與其他處置';
  };
  for (const title of ['CPR、節拍器與 ROSC', '電擊紀錄', '給藥紀錄', '呼吸道與其他處置', '心律紀錄']) {
    const heading = document.createElement('h3');
    heading.textContent = title;
    const table = document.createElement('table');
    table.className = 'voice-command-table';
    const head = table.createTHead().insertRow();
    for (const text of ['功能', '可說的指令']) {
      const th = document.createElement('th');
      th.scope = 'col';
      th.textContent = text;
      head.append(th);
    }
    const body = table.createTBody();
    for (const command of VOICE_COMMANDS.filter(item => groupFor(item.label) === title)) {
      const row = body.insertRow();
      row.insertCell().textContent = command.label;
      const phrases = row.insertCell();
      for (const phrase of command.phrases) {
        const line = document.createElement('div');
        line.textContent = `「${phrase.replace(/IVIO/g, 'IV/IO')}」`;
        phrases.append(line);
      }
    }
    container.append(heading, table);
  }
  if (!dialog.open) dialog.showModal();
}

// Crisp beep oscillator sound generator (prevents clicking pops with exponential gain ramps)
function playOscillatorTone(frequency, durationMs) {
  if (!audioCtx) return;
  
  // Resume context if suspended
  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }

  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  
  // A pure sine wave avoids the extra harmonics of a square wave, which can
  // sound like two overlapping clicks on phone speakers.
  osc.type = 'sine';
  osc.frequency.setValueAtTime(frequency, audioCtx.currentTime);
  
  // Set volume envelope
  gain.gain.setValueAtTime(0.32, audioCtx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + (durationMs / 1000));
  
  osc.connect(gain);
  gain.connect(audioCtx.destination);
  
  osc.start();
  osc.stop(audioCtx.currentTime + (durationMs / 1000));
}

// === 2. Global Stopwatch & CPR Timer ===
function updateGlobalStopwatch() {
  const diffMs = new Date() - startTime;
  const totalSeconds = Math.floor(diffMs / 1000);
  
  const s = totalSeconds % 60;
  const m = Math.floor((totalSeconds / 60) % 60);
  const h = Math.floor(totalSeconds / 3600);
  
  document.getElementById('global-timer-readout').innerText = 
    `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

function startCPRCycleTimer() {
  if (cprTimerInterval) clearInterval(cprTimerInterval);
  cprCountdownLeft = 120;
  updateCPRTimerReadout();

  cprTimerInterval = setInterval(() => {
    if (activeCPRMode === 'ROSC') return;

    cprCountdownLeft--;
    updateCPRTimerReadout();

    if (cprCountdownLeft <= 0) {
      cprCountdownLeft = 120;
      logAction('兩分鐘循環結束 (Cycle Finished)', 'end');
    }
  }, 1000);
}

function updateCPRTimerReadout() {
  const mm = Math.floor(cprCountdownLeft / 60).toString().padStart(2, '0');
  const ss = (cprCountdownLeft % 60).toString().padStart(2, '0');
  const readout = document.getElementById('cpr-timer-readout');
  
  readout.innerText = `${mm}:${ss}`;
  
  // Highlight Yellow warning at <= 20 seconds
  if (cprCountdownLeft <= 20) {
    readout.style.color = 'var(--color-yellow)';
  } else {
    readout.style.color = 'var(--ios-text)';
  }
}

function resetCPRCycleTimer() {
  cprCountdownLeft = 120;
  updateCPRTimerReadout();
  logAction('循環重置 (Cycle Reset)');
}

// === 3. Metronome Core Loop & Ratio Handling ===
function startMetronomeTickLoop() {
  if (metronomeInterval) clearInterval(metronomeInterval);
  if (!isMetronomeRunning) return;

  // One consistent compression beat at 110 BPM (~545ms per beat).
  metronomeInterval = setInterval(() => {
    if (isBreathPaused || activeCPRMode === 'ROSC') return;

    metronomeBeatCount++;
    const rule = CPR_MODES[activeCPRMode];

    // --- Mode CONT (Continuous Compression) ---
    if (rule.type === 'cont') {
      playMetronomeCompressionBeep();
      setRingCirclePercentOffset(0);
      document.getElementById('cpr-breath-hint').innerText = '持續按壓';
      return;
    }

    // --- Mode LUCAS (Asynchronous 6s Breaths) ---
    if (rule.type === 'lucas') {
      playMetronomeCompressionBeep();
      
      const remainTicks = rule.limit - metronomeBeatCount;
      const remainSeconds = Math.ceil((remainTicks * METRONOME_INTERVAL_MS) / 1000);
      document.getElementById('cpr-breath-hint').innerText = `倒數: ${remainSeconds}s`;

      const percent = (metronomeBeatCount / rule.limit) * 100;
      setRingCirclePercentOffset(percent);

      if (metronomeBeatCount >= rule.limit) {
        metronomeBeatCount = 0;
        triggerBreathAlertSequence(true); // Asynchronous breath overlay flash
      }
      return;
    }

    // --- Ratio Modes (30:2, 15:2) ---
    playMetronomeCompressionBeep();
    
    const percent = (metronomeBeatCount / rule.limit) * 100;
    setRingCirclePercentOffset(percent);
    document.getElementById('cpr-breath-hint').innerText = `計數: ${metronomeBeatCount}`;

    if (metronomeBeatCount >= rule.limit) {
      isBreathPaused = true;
      metronomeBeatCount = 0;
      document.getElementById('cpr-breath-hint').innerText = '給氧';
      triggerSynchronousBreathsSequence();
    }

  }, METRONOME_INTERVAL_MS);
}

function playMetronomeCompressionBeep() {
  playOscillatorTone(1800, 45);
  triggerCardTickFlash();
}

function setRingCirclePercentOffset(percent) {
  const offset = (percent / 100) * ringCircumference;
  ringCircle.style.strokeDashoffset = offset;
}

// Animate visual cardiogram compression flash on beat
function triggerCardTickFlash() {
  const card = document.getElementById('cpr-metronome-card');
  card.classList.add('flash-cpr-beat');
  setTimeout(() => card.classList.remove('flash-cpr-beat'), 100);
}

// 2 breaths at ratio compression pauses (30:2 or 15:2)
function triggerSynchronousBreathsSequence() {
  // Clear ring circle offset
  setRingCirclePercentOffset(100);

  // First Breath
  triggerVisualFlashOverlay('breath');

  setTimeout(() => {
    // Second Breath
    triggerVisualFlashOverlay('breath');
  }, 1200);

  // Resume Chest Compressions after 2 breaths complete (~2.4s)
  setTimeout(() => {
    if (!missionActive) return;
    isBreathPaused = false;
    setRingCirclePercentOffset(0);
    document.getElementById('cpr-breath-hint').innerText = '準備中...';
  }, 2400);
}

// Visual screen flash indicator overlay for high-stress environments
function triggerVisualFlashOverlay(type) {
  const overlay = document.getElementById('vent-overlay');
  const txt = document.getElementById('vent-text');
  
  if (type === 'breath') {
    txt.innerText = '給氧';
    speakText('給氧');
    overlay.className = 'vent-flash-overlay active-breath';
    setTimeout(() => overlay.className = 'vent-flash-overlay', 800);
  } else if (type === 'shock') {
    txt.innerText = '電擊';
    speakText('電擊');
    overlay.className = 'vent-flash-overlay active-shock';
    setTimeout(() => overlay.className = 'vent-flash-overlay', 800);
  }
}

// Asynchronous background breathing flash
function triggerBreathAlertSequence(isAsynchronous = false) {
  if (isAsynchronous) {
    triggerVisualFlashOverlay('breath');
    setTimeout(() => {
      setRingCirclePercentOffset(0);
    }, 200);
  }
}

// === 4. Metronome Controls & Modes Switch ===
function toggleMetronome() {
  setMetronomeRunning(!isMetronomeRunning);
}

function setMetronomeRunning(shouldRun) {
  if (!missionActive) return;
  if (isMetronomeRunning === shouldRun && metronomeInterval) return;
  isMetronomeRunning = shouldRun;
  const btn = document.getElementById('btn-toggle-metronome');
  
  if (isMetronomeRunning) {
    btn.classList.add('active');
    btn.querySelector('span').innerText = '節拍器：開';
    metronomeBeatCount = 0;
    isBreathPaused = false;
    startMetronomeTickLoop();
  } else {
    btn.classList.remove('active');
    btn.querySelector('span').innerText = '節拍器：關';
    if (metronomeInterval) clearInterval(metronomeInterval);
    setRingCirclePercentOffset(0);
    document.getElementById('cpr-breath-hint').innerText = '準備中...';
  }
}

function setCPRMode(modeName) {
  if (!missionActive) return;
  // Clear active classes
  document.querySelectorAll('.btn-mode').forEach(b => b.classList.remove('active'));
  document.getElementById('btn-rosc-trigger').classList.remove('active');

  const rule = CPR_MODES[modeName];
  activeCPRMode = modeName;
  metronomeBeatCount = 0;
  isBreathPaused = false;
  setRingCirclePercentOffset(0);
  document.getElementById('cpr-breath-hint').innerText = '準備中...';

  // Toggle active class on selected button
  if (modeName === '30:2') document.getElementById('mode-30-2').classList.add('active');
  if (modeName === '15:2') document.getElementById('mode-15-2').classList.add('active');
  if (modeName === 'CONT') document.getElementById('mode-cont').classList.add('active');
  if (modeName === 'LUCAS') document.getElementById('mode-lucas').classList.add('active');

  let statusText = 'CPR 進行中';
  let logText = modeName;

  if (modeName === 'CONT') logText = '連續按壓';
  if (modeName === 'LUCAS') {
    statusText = '6秒給氧照護';
    logText = '6秒給氧 (MCPR)';
  }

  document.getElementById('cpr-status-label').innerText = statusText;
  if (isMetronomeRunning) startMetronomeTickLoop();
  logAction(`模式切換: ${logText}`);
}

function triggerROSCState() {
  if (!missionActive) return;
  document.querySelectorAll('.btn-mode').forEach(b => b.classList.remove('active'));
  document.getElementById('btn-rosc-trigger').classList.add('active');

  activeCPRMode = 'ROSC';
  isBreathPaused = false;
  setRingCirclePercentOffset(0);

  document.getElementById('cpr-status-label').innerText = 'ROSC / 復甦後照護';
  document.getElementById('cpr-breath-hint').innerText = '監測生命徵象';

  logAction('患者恢復自發循環 (ROSC)', 'rosc');
}

// === 5. Shock Shorter Helpers ===
function triggerAEDShock() {
  if (!missionActive) return;
  logAction('AED 電擊', 'shock');
  triggerVisualFlashOverlay('shock');
  resetCPRCycleTimer();
}

function triggerManualShock() {
  if (!missionActive) return;
  const joules = document.getElementById('manual-joules-select').value;
  logAction(`手動電擊 ${joules}J (Manual Shock)`, 'shock');
  triggerVisualFlashOverlay('shock');
  resetCPRCycleTimer();
}

function logECGRhythm(selectElement) {
  const rhythm = selectElement.value;
  if (rhythm) {
    logAction(`心律評估: ${rhythm}`, 'ecg');
    selectElement.selectedIndex = 0; // Reset index to default placeholder
  }
}

// === 6. Epinephrine Medication Logic ===
function administerEpinephrine() {
  if (!missionActive) return;
  const btn = document.getElementById('btn-epinephrine');
  const timerLabel = document.getElementById('epi-timer-readout');
  const bar = document.getElementById('epi-progress-bar');

  logAction('給予 Epinephrine 1mg', 'drug');

  // Reset any alert states
  btn.classList.remove('epi-alert');

  // Set transition progress bar
  bar.style.transition = 'none';
  bar.style.width = '0%';
  bar.style.display = 'block';

  // Force reflow and run visual transition across 180s (3min)
  setTimeout(() => {
    bar.style.transition = 'width 180s linear';
    bar.style.width = '100%';
  }, 50);

  let countdownLeft = 180;
  if (epinephrineInterval) clearInterval(epinephrineInterval);

  timerLabel.innerText = '下劑倒數: 03:00';

  epinephrineInterval = setInterval(() => {
    countdownLeft--;
    
    const m = Math.floor(countdownLeft / 60);
    const s = countdownLeft % 60;
    timerLabel.innerText = `下劑倒數: ${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;

    if (countdownLeft <= 0) {
      clearInterval(epinephrineInterval);
      timerLabel.innerText = '請立即給藥';
      speakText('給藥');
      btn.classList.add('epi-alert'); // Triggers green pulsating glowing animation
    }
  }, 1000);
}

// === 7. Logging & TXT Export System ===
function recordAirway(device) {
  if (!missionActive) return;
  if (device === 'LMA') logAction('建立進階呼吸道 (LMA)', 'lma');
  if (device === 'ENDO') logAction('建立確切呼吸道 (ENDO)', 'endo');
}

function logAction(text, category = '') {
  const container = document.getElementById('logs-container');
  const entry = document.createElement('div');
  
  let finalCategory = category;
  if (!['lma', 'endo'].includes(category) && (text.includes('建立 IV/IO') || text.includes('建立IV/IO') || text.includes('建立進階呼吸道'))) {
    finalCategory = 'dark-green';
  }
  entry.className = `log-entry ${finalCategory}`;

  const now = new Date();
  const eventRecord = {
    id: ReportManager.makeId('event'),
    timestamp: now.toISOString(),
    text,
    category: finalCategory
  };
  missionLogs.push(eventRecord);
  if (missionId && startTime) {
    ReportManager.saveSnapshot({
      id: missionId,
      startedAt: startTime.toISOString(),
      endedAt: (missionEndTime || now).toISOString(),
      updatedAt: now.toISOString(),
      status: missionActive ? 'in_progress' : 'completed',
      timeline: missionLogs.map(item => ({ ...item }))
    }).catch(error => console.error('自動存檔失敗', error));
  }
  entry.dataset.eventId = eventRecord.id;
  const h = now.getHours().toString().padStart(2, '0');
  const m = now.getMinutes().toString().padStart(2, '0');
  const s = now.getSeconds().toString().padStart(2, '0');

  const timeElement = document.createElement('span');
  timeElement.className = 'log-time';
  timeElement.textContent = `${h}:${m}:${s}`;
  const messageElement = document.createElement('span');
  messageElement.className = 'log-msg';
  messageElement.textContent = text;
  entry.append(timeElement, messageElement);

  container.prepend(entry);
}

function exportLogsToTxt() {
  let doc = `紀錄時間: ${new Date().toLocaleString('zh-TW')}\n`;
  doc += "===================================\n\n";

  const events = missionLogs.slice().sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
  events.forEach(event => {
    const time = new Date(event.timestamp).toLocaleTimeString('zh-TW', { hour12: false });
    let msg = event.text;
    if (msg.includes('急救流程啟動') || msg.includes('Code Blue Started')) {
      msg = '急救開始';
    }
    if (msg.includes('患者恢復自發循環 (ROSC) - 進入照護模式') || msg.includes('患者恢復自發循環 (ROSC)-進入照護模式')) {
      msg = '患者恢復自發循環 (ROSC)';
    }
    doc += `[${time}] ${msg}\n`;
  });

  doc += "\n===================================\n";

  const blob = new Blob([doc], { type: 'text/plain;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `救護助手急救紀錄_${new Date().getTime()}.txt`;
  a.click();
  ReportManager.showFileLocation(a.download);
  setTimeout(() => URL.revokeObjectURL(a.href), 0);
}

function applySavedReportToCurrentMission(report) {
  if (!report || report.id !== missionId) return;
  missionLogs = report.timeline.map(item => ({ ...item }));
}

function isCurrentMissionActive(id) {
  return missionActive && missionId === id;
}

function endResuscitationMission() {
  if (!missionActive) return;
  missionEndTime = new Date();
  missionActive = false;
  // Clear all running intervals
  if (globalTimerInterval) clearInterval(globalTimerInterval);
  if (cprTimerInterval) clearInterval(cprTimerInterval);
  if (metronomeInterval) clearInterval(metronomeInterval);
  if (epinephrineInterval) clearInterval(epinephrineInterval);

  // Stop Speech Recognition
  speechRequested = false;
  isListening = false;
  if (speechRestartTimer) clearTimeout(speechRestartTimer);
  if (recognition) {
    try {
      recognition.stop();
    } catch (e) {
      console.error("Error stopping recognition:", e);
    }
  }

  // Stop WakeLock screen lock
  releaseScreenWakeLock();

  // Metronome stops
  document.getElementById('cpr-status-label').innerText = '任務結束';
  document.getElementById('cpr-timer-readout').innerText = 'STOP';
  document.getElementById('cpr-timer-readout').style.color = 'var(--color-red)';
  document.getElementById('cpr-breath-hint').innerText = '';
  setRingCirclePercentOffset(0);

  // Reset metronome toggle
  const metroToggle = document.getElementById('btn-toggle-metronome');
  metroToggle.classList.remove('active');
  metroToggle.querySelector('span').innerText = '已停止';
  isMetronomeRunning = false;

  // Epinephrine reset
  const epiBtn = document.getElementById('btn-epinephrine');
  epiBtn.classList.remove('epi-alert');
  document.getElementById('epi-timer-readout').innerText = '任務結束';
  const epiProgress = document.getElementById('epi-progress-bar');
  epiProgress.style.transition = 'none';
  epiProgress.style.width = '0%';

  // Keep the record export available, but lock all clinical controls after mission end.
  document.querySelectorAll('#cpr-main-panel button:not(#btn-export-logs), #cpr-main-panel select, #btn-mic-toggle').forEach(control => {
    control.disabled = true;
  });
  epiBtn.style.pointerEvents = 'none';
  epiBtn.setAttribute('aria-disabled', 'true');

  logAction('任務結束 (Mission Ended)', 'end');

  const report = {
    id: missionId || ReportManager.makeId('case'),
    startedAt: startTime ? startTime.toISOString() : missionEndTime.toISOString(),
    endedAt: missionEndTime.toISOString(),
    updatedAt: missionEndTime.toISOString(),
    status: 'completed',
    note: '',
    timeline: missionLogs.map(item => ({ ...item }))
  };
  ReportManager.saveAndOpen(report);
}

// === 8. Screen WakeLock API ===
async function requestScreenWakeLock() {
  if ('wakeLock' in navigator) {
    try {
      screenWakeLock = await navigator.wakeLock.request('screen');
      console.log('Screen Wake Lock acquired successfully.');
    } catch (err) {
      console.log(`Failed to acquire Screen Wake Lock: ${err.message}`);
    }
  }
}

function releaseScreenWakeLock() {
  if (screenWakeLock !== null) {
    screenWakeLock.release().then(() => {
      screenWakeLock = null;
      console.log('Screen Wake Lock released.');
    });
  }
}

// Re-request wake lock if tab loses focus and returns
document.addEventListener('visibilitychange', async () => {
  if (screenWakeLock !== null && document.visibilityState === 'visible') {
    requestScreenWakeLock();
  }
});

// Recover records independently of clinical timers or microphone permissions.
ReportManager.initialize();
