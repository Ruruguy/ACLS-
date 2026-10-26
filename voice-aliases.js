// Explicit transcription variants, not fuzzy matching or a pronunciation model.
// Completion words, doses, and rhythm prefixes remain part of each command.
const VOICE_PRONUNCIATIONS = {
  ENDO: ['EN豆', '恩豆', '恩多', 'EN多', 'ENDOU', 'EN DOH'],
  LMA: ['ELMA', 'EL EM A', '艾勒姆欸', '艾爾姆欸', '艾爾姆A', '艾爾瑪'],
  EPINEPHRINE: ['EPINEPHRIN', 'EPINEFRINE', 'EPINEFRIN', 'EPI', '艾皮奈弗林', '艾匹奈弗林'],
  AMIO: ['阿米歐', '阿咪歐', '艾米歐', '阿米喔'],
  AMIODARONE: ['AMIODARON', 'AMIODERONE', '阿米歐達隆', '阿咪啊打龍', '阿米歐達龍', '阿咪歐達隆', '艾米歐達隆', '阿米達隆'],
  LIDOCAINE: ['LIDOCAIN', '萊多卡因', '賴多卡因', '利多凱因'],
  ATROPINE: ['ATROPIN', '阿托平', '阿脫品'],
  ADENOSINE: ['ADENOSIN', 'ADENOSENE', '阿登諾辛', '阿德諾辛', '阿丹諾辛', '亞登諾辛'],
  ROSC: ['ROSK', '肉斯克', '羅斯克', '若斯克'],
  IVIO: ['艾薇艾歐', '艾維艾歐'],
  BVM: ['比薇姆', '比維姆', '逼薇姆'],
  AED: ['欸伊低', '欸衣低', '艾伊迪', '欸伊迪'],
  OHCA: ['歐欸尺西欸', '歐艾尺西欸', '歐HCA'],
  IHCA: ['愛欸尺西欸', '艾欸尺西欸', '愛HCA'],
  VF: ['薇欸夫', '維欸夫', 'V欸夫'],
  PVT: ['皮薇踢', '批薇踢', 'P薇T'],
  ASYSTOLE: ['ASYSTOL', 'ASISTOLE', 'ASYSTOLY', '欸西斯托利', '阿西斯托利', '欸西斯透利'],
  PEA: ['皮伊欸', '批伊欸', '皮依欸'],
  NSR: ['恩艾斯阿', '恩艾斯啊'],
  SB: ['艾斯比', '艾斯逼'],
  ST: ['艾斯踢', '艾斯提'],
  SVT: ['艾斯薇踢', '艾斯維踢'],
  VT: ['薇踢', '維踢'],
  AFIB: ['AFIBRILLATION', '欸費布', '欸菲布', '艾費布'],
  AFLUTTER: ['AFLUTER', '欸弗拉特', '欸佛拉特', '艾弗拉特'],
  AVB: ['欸薇比', '欸維比'],
  '5H5T': ['五欸尺五踢', '五艾尺五踢', 'FIVE H FIVE T']
};

function normalizeVoiceText(text) {
  return text.normalize('NFKC').replace(/[^\u3400-\u9FFFA-Za-z0-9]/g, '').toUpperCase();
}

function expandVoiceCommandPhrases(commands) {
  return commands.map(command => {
    const phrases = new Map();
    const add = phrase => {
      const normalized = normalizeVoiceText(phrase);
      if (!phrases.has(normalized)) phrases.set(normalized, phrase);
    };
    for (const original of command.phrases) {
      add(original);
      for (const [token, variants] of Object.entries(VOICE_PRONUNCIATIONS)) {
        // Do not expand short acronyms inside longer English names (e.g. ST in ASYSTOLE).
        const pattern = new RegExp(`(^|[^A-Za-z])${token}(?=$|[^A-Za-z])`, 'gi');
        for (const variant of variants) add(original.replace(pattern, (_, prefix) => prefix + variant));
      }
    }
    return { ...command, phrases: Array.from(phrases.values()) };
  });
}
