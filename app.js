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
  'LUCAS': { limit: 12, type: 'lucas' }, // Breath every 12 ticks (6s) at 120bpm
  'ROSC': { limit: 0, type: 'rosc' }
};

// === 1. Launch & Core Audio Hook ===
function startApp() {
  // Initialize Web Audio API on first user gesture (highly critical for Safari/iOS compatibility)
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  audioCtx = new AudioContextClass();
  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }

  // Hide Splash Screen overlay
  document.getElementById('splash-screen').style.display = 'none';

  // Record start time
  startTime = new Date();

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
  if (recognition && !isListening) {
    isListening = true;
    try {
      recognition.start();
    } catch (e) {
      console.error("Auto-start speech recognition error:", e);
    }
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
    if (isListening && event.error !== 'not-allowed') {
      try {
        recognition.start();
      } catch (e) {
        console.error("Failed to restart speech recognition:", e);
      }
    } else {
      isListening = false;
      updateMicUI(false);
    }
  };
  
  recognition.onend = () => {
    if (isListening) {
      try {
        recognition.start();
      } catch (e) {
        console.error("Error restarting recognition on end:", e);
      }
    } else {
      updateMicUI(false);
    }
  };
  
  recognition.onresult = (event) => {
    const resultIndex = event.resultIndex;
    const transcript = event.results[resultIndex][0].transcript.trim();
    console.log("Speech recognized:", transcript);
    processSpeechTranscript(transcript);
  };
}

function toggleSpeechRecognition() {
  if (!recognition) {
    initSpeechRecognition();
  }
  if (!recognition) {
    alert("您的瀏覽器不支援語音辨識功能。");
    return;
  }
  
  if (isListening) {
    isListening = false;
    recognition.stop();
  } else {
    if (audioCtx && audioCtx.state === 'suspended') {
      audioCtx.resume();
    }
    isListening = true;
    try {
      recognition.start();
    } catch (e) {
      console.error("Speech recognition start error:", e);
    }
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
  const cleanText = transcript.replace(/[，。！？、\s]/g, '');
  if (cleanText.includes('完成')) {
    logAction(`語音紀錄: "${cleanText}"`, 'voice');
    
    if (cleanText.includes('給藥完成') || cleanText.includes('強心針完成')) {
      administerEpinephrine();
    } else if (cleanText.includes('電擊完成')) {
      triggerAEDShock();
    }
  }
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
  
  osc.type = 'square'; // Identical square wave sound to target app
  osc.frequency.setValueAtTime(frequency, audioCtx.currentTime);
  
  // Set volume envelope
  gain.gain.setValueAtTime(0.5, audioCtx.currentTime);
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

    // Visual & audio tick warnings at <= 20 seconds
    if (cprCountdownLeft <= 20 && cprCountdownLeft > 0) {
      playOscillatorTone(800, 150); // Small rhythm prompt tone
    }

    if (cprCountdownLeft <= 0) {
      playOscillatorTone(2000, 1000); // 2 min warning alarm
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

  // 120 bpm = tick every 500ms
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
      const remainSeconds = Math.ceil(remainTicks / 2);
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

  }, 500);
}

function playMetronomeCompressionBeep() {
  playOscillatorTone(3300, 50); // Crisp 3300Hz quick click
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
  playOscillatorTone(1000, 800); // 1000Hz long breath sound
  triggerVisualFlashOverlay('breath');

  setTimeout(() => {
    // Second Breath
    playOscillatorTone(1000, 800);
    triggerVisualFlashOverlay('breath');
  }, 1200);

  // Resume Chest Compressions after 2 breaths complete (~2.4s)
  setTimeout(() => {
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
    playOscillatorTone(1000, 800);
    triggerVisualFlashOverlay('breath');
    setTimeout(() => {
      setRingCirclePercentOffset(0);
    }, 200);
  }
}

// === 4. Metronome Controls & Modes Switch ===
function toggleMetronome() {
  isMetronomeRunning = !isMetronomeRunning;
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
  logAction(`模式切換: ${logText}`);
}

function triggerROSCState() {
  document.querySelectorAll('.btn-mode').forEach(b => b.classList.remove('active'));
  document.getElementById('btn-rosc-trigger').classList.add('active');

  activeCPRMode = 'ROSC';
  isBreathPaused = false;
  if (metronomeInterval) clearInterval(metronomeInterval);
  setRingCirclePercentOffset(0);

  document.getElementById('cpr-status-label').innerText = 'ROSC / 復甦後照護';
  document.getElementById('cpr-breath-hint').innerText = '監測生命徵象';

  logAction('患者恢復自發循環 (ROSC)', 'rosc');
}

// === 5. Shock Shorter Helpers ===
function triggerAEDShock() {
  logAction('AED 電擊', 'shock');
  triggerVisualFlashOverlay('shock');
  resetCPRCycleTimer();
}

function triggerManualShock() {
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
      playOscillatorTone(1500, 500); // Admin alarm prompt
      btn.classList.add('epi-alert'); // Triggers green pulsating glowing animation
    }
  }, 1000);
}

// === 7. Logging & TXT Export System ===
function logAction(text, category = '') {
  const container = document.getElementById('logs-container');
  const entry = document.createElement('div');
  
  let finalCategory = category;
  if (text.includes('建立 IV/IO') || text.includes('建立IV/IO') || text.includes('建立進階呼吸道')) {
    finalCategory = 'dark-green';
  }
  entry.className = `log-entry ${finalCategory}`;

  const now = new Date();
  const h = now.getHours().toString().padStart(2, '0');
  const m = now.getMinutes().toString().padStart(2, '0');
  const s = now.getSeconds().toString().padStart(2, '0');

  entry.innerHTML = `
    <span class="log-time">${h}:${m}:${s}</span>
    <span class="log-msg">${text}</span>
  `;

  container.prepend(entry);
}

function exportLogsToTxt() {
  let doc = `紀錄時間: ${new Date().toLocaleString()}\n`;
  doc += "===================================\n\n";

  const entries = document.querySelectorAll('.log-entry');
  
  // Read array backwards to align logs in chronologically ascending order
  const array = Array.from(entries).reverse();
  array.forEach(entry => {
    const time = entry.querySelector('.log-time').innerText;
    let msg = entry.querySelector('.log-msg').innerText;
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
}

function endResuscitationMission() {
  // Clear all running intervals
  if (globalTimerInterval) clearInterval(globalTimerInterval);
  if (cprTimerInterval) clearInterval(cprTimerInterval);
  if (metronomeInterval) clearInterval(metronomeInterval);
  if (epinephrineInterval) clearInterval(epinephrineInterval);

  // Stop Speech Recognition
  isListening = false;
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

  // Epinephrine reset
  const epiBtn = document.getElementById('btn-epinephrine');
  epiBtn.classList.remove('epi-alert');
  document.getElementById('epi-timer-readout').innerText = '任務結束';
  document.getElementById('epi-progress-bar').style.width = '0%';

  logAction('任務結束 (Mission Ended)', 'end');
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
