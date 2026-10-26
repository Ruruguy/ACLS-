const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');

function speechEnvironment() {
  const records = [];
  const context = vm.createContext({
    document: { getElementById: () => ({ textContent: '' }) },
    logAction: (text, category) => records.push({ text, category }),
    triggerManualShock() {}, triggerAEDShock() {}, administerEpinephrine() {}, triggerROSCState() {},
    setCPRMode() {}, setMetronomeRunning() {},
    recordAirway: device => records.push({ text: `airway:${device}` })
  });
  vm.runInContext(fs.readFileSync(path.join(root, 'voice-aliases.js'), 'utf8'), context);
  const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
  const start = app.indexOf('function findVoiceCommand(');
  const end = app.indexOf('// Build the reference', start);
  vm.runInContext(app.slice(start, end), context);
  return {
    records,
    recognizeAlternatives(texts) { records.length = 0; context.processSpeechAlternatives(texts); return records.find(item => item.category === 'voice')?.text; },
    recognize(text) { records.length = 0; context.processSpeechTranscript(text); return records.find(item => item.category === 'voice')?.text; },
    commands: vm.runInContext('VOICE_COMMANDS', context)
  };
}

test('all expanded phrases dispatch to their own command without collisions', () => {
  const e = speechEnvironment();
  let count = 0;
  for (const command of e.commands) {
    for (const phrase of command.phrases) {
      assert.equal(e.recognize(phrase), `語音指令: ${command.label}`, phrase);
      assert.equal(e.records.filter(item => item.category === 'voice').length, 1);
      count++;
    }
  }
  assert.ok(count > 200, `Expected expanded vocabulary, received ${count}`);
});

test('connected ENDO and LMA speech, transliterations, and spaced letters stay distinct', () => {
  const e = speechEnvironment();
  for (const phrase of ['en豆完成', '恩豆完成', '恩多完成', 'en dou 完成', 'E N D O 完成', 'ＥＮＤＯ完成']) {
    assert.equal(e.recognize(phrase), '語音指令: ENDO 確切呼吸道', phrase);
    assert.equal(e.records.at(-1).text, 'airway:ENDO');
  }
  for (const phrase of ['elma 完成', '艾爾瑪完成', '艾爾姆欸完成', 'L M A 完成']) {
    assert.equal(e.recognize(phrase), '語音指令: LMA 進階呼吸道', phrase);
    assert.equal(e.records.at(-1).text, 'airway:LMA');
  }
});

test('Amiodarone voice is dose-free and supports English, Chinese, and phonetic names', () => {
  const e = speechEnvironment();
  for (const phrase of ['阿米歐達隆三百完成', '阿咪啊打龍三百完成', '阿咪啊打龍300完成', 'amiodarone 300 完成', '阿米歐300完成', '阿咪啊打龍150完成']) {
    assert.equal(e.recognize(phrase), undefined, phrase);
  }
  for (const phrase of ['阿米歐達隆完成', '阿咪啊打龍完成', 'amiodaron 完成', '阿米歐完成', 'Amiodarone done', 'amiodarone complete', 'amio completed', '胺碘酮完成']) {
    assert.equal(e.recognize(phrase), '語音指令: Amiodarone');
    assert.equal(e.records.at(-1).text, 'Amiodarone');
  }
  for (const phrase of ['EPI 完成', '艾皮奈弗林完成', '伊匹餒fin完成', '伊匹餒 FIN 完成']) {
    assert.equal(e.recognize(phrase), '語音指令: Epinephrine 1mg');
  }
  assert.equal(e.recognize('萊多卡因完成'), '語音指令: Lidocaine');
  assert.equal(e.recognize('阿托平完成'), '語音指令: Atropine 1mg');
  assert.equal(e.recognize('阿登諾辛完成'), '語音指令: Adenosine');
});

test('English completion phrases and alternative results execute once without conflicting guesses', () => {
  const e = speechEnvironment();
  assert.equal(e.recognize('ENDO done'), '語音指令: ENDO 確切呼吸道');
  assert.equal(e.recognize('lidocaine complete'), '語音指令: Lidocaine');
  assert.equal(e.recognizeAlternatives(['unrecognized', 'Amiodarone done', 'amio complete']), '語音指令: Amiodarone');
  assert.equal(e.records.filter(item => item.category === 'drug').length, 1);
  assert.equal(e.recognizeAlternatives(['unrecognized', 'Amiodarone done', 'EPI complete']), undefined);
  assert.equal(e.records.length, 0);
  assert.equal(e.recognizeAlternatives(['ENDO done', 'LMA done']), '語音指令: ENDO 確切呼吸道');
});

test('rhythm and ROSC pronunciation variants still require their command prefix', () => {
  const e = speechEnvironment();
  assert.equal(e.recognize('確認肉斯克'), '語音指令: ROSC');
  assert.equal(e.recognize('紀錄心律欸西斯托利'), '語音指令: 心律 Asystole');
  assert.equal(e.recognize('紀錄心律薇欸夫'), '語音指令: 心律 VF');
  assert.equal(e.recognize('紀錄心律皮薇踢'), '語音指令: 心律 pVT');
  assert.equal(e.recognize('紀錄心律艾斯薇踢'), '語音指令: 心律 SVT');
  for (const text of ['en豆', '恩豆', '艾爾瑪', '阿米歐達隆', '伊匹餒fin', '薇欸夫', '肉斯克', '給藥完成', '欸西斯托利', '紀錄心律薇', '阿米歐250完成']) {
    assert.equal(e.recognize(text), undefined, text);
    assert.equal(e.records.length, 0, text);
  }
});
