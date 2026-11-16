'use strict';
/* ============================================================================
   채원이·주원이네 반짝하루 · app.js
   - 가족 기록장 (기기 안 저장이 기본)
   - 선택: Supabase로 실시간 가족 공유
   ========================================================================== */

/* ---------------------------------------------------------------- 1. 설정 */
const APP_VERSION = 3;
const STORAGE_KEY = 'chaewon-sparkle-v3';
const PREFS_KEY = 'chaewon-sparkle-prefs';
const LEGACY_KEYS = ['chaewon-sparkle-v2', 'chaewon-sparkle-v1'];
const SEOUL = 'Asia/Seoul';

/* 실시간 가족 공유 (Supabase). 아래 세 값을 채우면 모든 휴대폰이 같은 기록을 봐요.
   비워두면 이 기기의 브라우저(localStorage)에만 저장돼요. 설정 화면에서도 넣을 수 있어요. */
const SYNC_CONFIG = {
  supabaseUrl: 'https://exdhgwkudejynccxqdhm.supabase.co',
  supabaseAnonKey: 'sb_publishable_hjshLIBPkJb7Sqjjhw2FPw_44Mbr_95',
  familyId: 'chaewon-family'
};
const SYNC_OVERRIDE_KEY = 'chaewon-sparkle-sync';
const SYNC_POLL_MS = 5000;

/* ---------------------------------------------------------------- 2. 날짜 */
const DAY_FMT = new Intl.DateTimeFormat('sv-SE', { timeZone: SEOUL, year: 'numeric', month: '2-digit', day: '2-digit' });
const LONG_DATE_FMT = new Intl.DateTimeFormat('ko-KR', { timeZone: SEOUL, month: 'long', day: 'numeric', weekday: 'short' });
const MOMENT_FMT = new Intl.DateTimeFormat('ko-KR', { timeZone: SEOUL, month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit' });

const pad2 = n => String(n).padStart(2, '0');
/** 서울 기준 오늘 날짜 키 (YYYY-MM-DD). toISOString을 쓰면 오전 9시 전에 하루가 밀려요. */
const dayKey = date => DAY_FMT.format(date || new Date());
/** 서울 기준 연/월/일 숫자 */
function seoulYMD(date) {
  const parts = DAY_FMT.format(date || new Date()).split('-');
  return { y: Number(parts[0]), m: Number(parts[1]), d: Number(parts[2]) };
}
/** 0부터 시작하는 month로 날짜 키 만들기 */
const keyOf = (y, m0, d) => `${y}-${pad2(m0 + 1)}-${pad2(d)}`;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const nowLabel = () => MOMENT_FMT.format(new Date());
function clockLabel(ts) {
  try { return new Date(ts).toLocaleTimeString('ko-KR', { hour: 'numeric', minute: '2-digit' }); }
  catch (err) { return MOMENT_FMT.format(new Date(ts)); }
}

/* ---------------------------------------------------------------- 3. 공통 */
const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const $ = sel => document.querySelector(sel);
const text = (v, max) => String(v == null ? '' : v).trim().slice(0, max);
const clampInt = (v, min, max) => {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
};
const uid = () => {
  try { return crypto.randomUUID(); } catch (err) { /* 구형 사파리 */ }
  return 'id' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
};
const safeId = v => (typeof v === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(v) ? v : '');
const PHOTO_RE = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;
const safePhoto = v => (typeof v === 'string' && v.length < 400000 && PHOTO_RE.test(v) ? v : '');

/* ---------------------------------------------------------------- 4. 데이터 */
const TONES = 5;

const MISSIONS = [
  ['🤗', '서로 꼬옥 안아주기', '따뜻한 포옹으로 사랑을 충전해요.'],
  ['🍓', '간식 함께 준비하기', '채원이도 주원이도 작은 요리사가 되어봐요.'],
  ['🎨', '우리 가족 얼굴 그리기', '닮은 곳을 찾아보면 더 재미있어요.'],
  ['💬', '오늘 좋았던 일 하나 말하기', '작은 행복을 서로 나눠봐요.'],
  ['🎵', '좋아하는 노래 함께 부르기', '우리 집을 작은 무대로 만들어요.'],
  ['🧸', '장난감 함께 정리하기', '같이 하면 금방 끝나요!']
];

const CHEER_PRESETS = [
  ['노력 칭찬', '결과보다 네가 노력한 마음이 더 멋져. 오늘도 사랑해! 💗'],
  ['오늘 마무리', '오늘 하루도 수고했어. 내일도 함께 반짝여 보자! 🌙']
];

const ROUTES = [
  ['home', '🏠', '우리 집'],
  ['routine', '🌼', '오늘 할 일'],
  ['study', '📚', '공부방'],
  ['money', '🐷', '용돈통장'],
  ['chat', '💌', '가족 쪽지'],
  ['records', '⭐', '도장판']
];

const DEFAULT_PEOPLE = [
  { id: 'child', name: '채원공주', emoji: '👸🏻', note: '매일 조금씩 자라는 중', photo: '', tone: 0, role: 'kid' },
  { id: 'child2', name: '주원이', emoji: '🧒🏻', note: '씩씩하게 자라는 중', photo: '', tone: 3, role: 'kid' },
  { id: 'mom', name: '엄마', emoji: '🌷', note: '우리 집 다정한 응원단', photo: '', tone: 1, role: 'parent' },
  { id: 'dad', name: '아빠', emoji: '🐻', note: '언제나 든든한 내 편', photo: '', tone: 2, role: 'parent' }
];

const DEFAULT_TASKS = [
  { id: 's1', person: 'child', title: '소리 내어 책 읽기', detail: '재미있는 책 10분', reward: 100, kind: 'study', repeat: true },
  { id: 's2', person: 'child', title: '수학 한 장 풀기', detail: '천천히, 꼼꼼하게', reward: 100, kind: 'study', repeat: true },
  { id: 's3', person: 'child', title: '영어 단어 만나기', detail: '새로운 단어 5개', reward: 50, kind: 'study', repeat: true },
  { id: 't1', person: 'child', title: '장난감 제자리에 정리하기', detail: '', reward: 0, kind: 'routine', repeat: true },
  { id: 't2', person: 'child', title: '스스로 양치하기', detail: '', reward: 0, kind: 'routine', repeat: true },
  { id: 's4', person: 'child2', title: '받아쓰기 연습하기', detail: '한 줄씩 또박또박', reward: 50, kind: 'study', repeat: true },
  { id: 's5', person: 'child2', title: '수학 문제집 한 장', detail: '스스로 풀어보기', reward: 100, kind: 'study', repeat: true },
  { id: 's6', person: 'child2', title: '좋아하는 책 읽기', detail: '10분 동안', reward: 100, kind: 'study', repeat: true },
  { id: 't3', person: 'child2', title: '장난감 정리하기', detail: '', reward: 0, kind: 'routine', repeat: true },
  { id: 't4', person: 'child2', title: '스스로 양치하기', detail: '', reward: 0, kind: 'routine', repeat: true },
  { id: 't5', person: 'mom', title: '아이들과 그림책 읽기', detail: '', reward: 0, kind: 'routine', repeat: true },
  { id: 't6', person: 'mom', title: '함께 밥상 차리기', detail: '', reward: 0, kind: 'routine', repeat: true },
  { id: 't7', person: 'dad', title: '아이들과 신나게 놀기', detail: '', reward: 0, kind: 'routine', repeat: true },
  { id: 't8', person: 'dad', title: '저녁 산책 함께하기', detail: '', reward: 0, kind: 'routine', repeat: true }
];

function defaultState() {
  const kidIds = DEFAULT_PEOPLE.filter(p => p.role === 'kid').map(p => p.id);
  const money = {};
  const stamps = {};
  kidIds.forEach(id => {
    money[id] = { opening: 0, goal: 10000, transactions: [] };
    stamps[id] = [];
  });
  return {
    version: APP_VERSION,
    people: DEFAULT_PEOPLE.map(p => Object.assign({}, p)),
    tasks: DEFAULT_TASKS.map(t => Object.assign({}, t)),
    checks: {},
    stamps: stamps,
    money: money,
    encouragements: [],
    messages: [],
    missionIndex: 0,
    missionDays: []
  };
}

function uniqDates(list) {
  const out = [];
  (Array.isArray(list) ? list : []).forEach(d => {
    if (typeof d === 'string' && DATE_RE.test(d) && out.indexOf(d) < 0) out.push(d);
  });
  return out.sort();
}

function normalizeTransactions(list) {
  const out = [];
  (Array.isArray(list) ? list : []).forEach(item => {
    if (!item || typeof item !== 'object') return;
    const amount = clampInt(item.amount, -100000000, 100000000);
    const title = text(item.title, 60);
    if (!amount || !title) return;
    const rec = {
      id: safeId(item.id) || uid(),
      date: (typeof item.date === 'string' && DATE_RE.test(item.date)) ? item.date : dayKey(),
      title: title,
      amount: amount
    };
    if (typeof item.task === 'string' && item.task) rec.task = item.task;
    out.push(rec);
  });
  return out.slice(-2000);
}

function normalizePeople(list) {
  const seen = {};
  const out = [];
  (Array.isArray(list) ? list : []).forEach((p, index) => {
    if (!p || typeof p !== 'object') return;
    let id = safeId(p.id);
    if (!id || seen[id]) id = 'p' + index + '-' + Math.random().toString(36).slice(2, 7);
    seen[id] = true;
    const role = (p.role === 'kid' || p.role === 'parent') ? p.role : (id === 'child' ? 'kid' : 'parent');
    out.push({
      id: id,
      name: text(p.name, 15) || '가족',
      emoji: text(p.emoji, 8) || '💗',
      note: text(p.note, 40),
      photo: safePhoto(p.photo),
      tone: Number.isInteger(p.tone) ? ((p.tone % TONES) + TONES) % TONES : index % TONES,
      role: role
    });
    if (out.length >= 12) return;
  });
  if (!out.length) return [];
  if (!out.some(p => p.role === 'kid')) out[0].role = 'kid';
  return out;
}

/** 어떤 저장본이든 안전한 현재 모양으로 바꿔요. 잘못된 값이면 null. */
function normalizeState(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const people = normalizePeople(raw.people);
  if (!people.length) return null;

  const ids = {};
  people.forEach(p => { ids[p.id] = true; });
  const kidIds = people.filter(p => p.role === 'kid').map(p => p.id);

  const tasks = [];
  (Array.isArray(raw.tasks) ? raw.tasks : []).forEach((t, index) => {
    if (!t || typeof t !== 'object') return;
    if (!ids[t.person]) return;
    const kind = t.kind === 'study' ? 'study' : (t.kind === 'routine' ? 'routine' : '');
    const title = text(t.title, 60);
    if (!kind || !title) return;
    const isKid = kidIds.indexOf(t.person) >= 0;
    const task = {
      id: safeId(t.id) || (kind + index + '-' + Math.random().toString(36).slice(2, 7)),
      person: t.person,
      kind: kind,
      title: title,
      detail: text(t.detail, 60),
      reward: (kind === 'study' && isKid) ? clampInt(t.reward, 0, 100000) : 0,
      repeat: t.repeat !== false
    };
    if (typeof t.created === 'string' && DATE_RE.test(t.created)) task.created = t.created;
    tasks.push(task);
  });
  const taskIds = {};
  tasks.forEach(t => { taskIds[t.id] = true; });

  const checks = {};
  if (raw.checks && typeof raw.checks === 'object') {
    Object.keys(raw.checks).forEach(date => {
      if (!DATE_RE.test(date) || !Array.isArray(raw.checks[date])) return;
      const list = raw.checks[date].filter(id => typeof id === 'string' && taskIds[id]);
      if (list.length) checks[date] = list;
    });
  }

  const stamps = {};
  kidIds.forEach(id => { stamps[id] = []; });
  if (raw.stamps && !Array.isArray(raw.stamps) && typeof raw.stamps === 'object') {
    kidIds.forEach(id => { stamps[id] = uniqDates(raw.stamps[id]); });
  } else if (Array.isArray(raw.stamps)) {
    stamps[kidIds[0]] = uniqDates(raw.stamps);
  }

  const money = {};
  kidIds.forEach(id => { money[id] = { opening: 0, goal: 10000, transactions: [] }; });
  if (raw.money && typeof raw.money === 'object' && !Array.isArray(raw.money)) {
    kidIds.forEach(id => {
      const src = raw.money[id];
      if (!src || typeof src !== 'object') return;
      money[id] = {
        opening: clampInt(src.opening, 0, 100000000),
        goal: clampInt(src.goal, 1, 100000000) || 10000,
        transactions: normalizeTransactions(src.transactions)
      };
    });
  } else if (raw.transactions || raw.opening !== undefined || raw.goal !== undefined) {
    // 예전(한 명이던) 기록을 첫째 아이 통장으로 옮겨요.
    money[kidIds[0]] = {
      opening: clampInt(raw.opening, 0, 100000000),
      goal: clampInt(raw.goal, 1, 100000000) || 10000,
      transactions: normalizeTransactions(raw.transactions)
    };
  }

  const messages = [];
  (Array.isArray(raw.messages) ? raw.messages : []).forEach(m => {
    if (!m || typeof m !== 'object') return;
    const body = text(m.text, 500);
    if (!body) return;
    messages.push({
      id: safeId(m.id) || uid(),
      person: ids[m.person] ? m.person : people[0].id,
      text: body,
      date: typeof m.date === 'string' ? text(m.date, 40) : nowLabel(),
      at: Number.isFinite(m.at) ? m.at : Date.now()
    });
  });

  const encouragements = [];
  (Array.isArray(raw.encouragements) ? raw.encouragements : []).forEach(m => {
    if (!m || typeof m !== 'object') return;
    const body = text(m.text, 200);
    if (!body) return;
    encouragements.push({
      id: safeId(m.id) || uid(),
      person: ids[m.person] ? m.person : people[0].id,
      kid: kidIds.indexOf(m.kid) >= 0 ? m.kid : kidIds[0],
      text: body,
      date: (typeof m.date === 'string' && DATE_RE.test(m.date)) ? m.date : dayKey(),
      at: Number.isFinite(m.at) ? m.at : Date.now()
    });
  });

  const missionIndex = Number.isInteger(raw.missionIndex) ? ((raw.missionIndex % MISSIONS.length) + MISSIONS.length) % MISSIONS.length : 0;

  return {
    version: APP_VERSION,
    people: people,
    tasks: tasks,
    checks: checks,
    stamps: stamps,
    money: money,
    encouragements: encouragements.slice(-500),
    messages: messages.slice(-500),
    missionIndex: missionIndex,
    missionDays: uniqDates(raw.missionDays)
  };
}

/* ---------------------------------------------------------------- 5. 저장 */
let storageWorks = true;

function loadJson(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch (err) {
    storageWorks = false;
    return null;
  }
}

function loadState() {
  let raw = loadJson(STORAGE_KEY);
  if (!raw) {
    for (let i = 0; i < LEGACY_KEYS.length; i += 1) {
      raw = loadJson(LEGACY_KEYS[i]);
      if (raw) break;
    }
  }
  return normalizeState(raw) || defaultState();
}

function loadPrefs() {
  const raw = loadJson(PREFS_KEY) || {};
  return {
    viewer: typeof raw.viewer === 'string' ? raw.viewer : '',
    activeKid: typeof raw.activeKid === 'string' ? raw.activeKid : ''
  };
}

let state = loadState();
let prefs = loadPrefs();
let page = 'home';
let calOffset = 0;
let roleMenuOpen = false;
let timerSeconds = 600;
let timerEnd = 0;
let timerInterval = null;
let photoPerson = null;

function kids() { return state.people.filter(p => p.role === 'kid'); }
function personById(id) { return state.people.find(p => p.id === id) || null; }

function viewerPerson() {
  const found = personById(prefs.viewer);
  if (found) return found;
  const parent = state.people.find(p => p.role === 'parent');
  return parent || state.people[0];
}

function activeKid() {
  const found = personById(prefs.activeKid);
  if (found && found.role === 'kid') return found;
  const list = kids();
  return list[0] || state.people[0];
}

const isKidView = () => viewerPerson().role === 'kid';

function ledger(kidId) {
  if (!state.money[kidId]) state.money[kidId] = { opening: 0, goal: 10000, transactions: [] };
  const book = state.money[kidId];
  if (!Array.isArray(book.transactions)) book.transactions = [];
  return book;
}
function stampsOf(kidId) {
  if (!Array.isArray(state.stamps[kidId])) state.stamps[kidId] = [];
  return state.stamps[kidId];
}
function balance(kidId) {
  const book = ledger(kidId);
  return book.opening + book.transactions.reduce((sum, t) => sum + t.amount, 0);
}
function earnedToday(kidId) {
  const today = dayKey();
  return ledger(kidId).transactions
    .filter(t => t.date === today && t.amount > 0)
    .reduce((sum, t) => sum + t.amount, 0);
}
const checked = task => (state.checks[dayKey()] || []).indexOf(task.id) >= 0;
const visibleTask = task => task.repeat !== false || task.created === dayKey();

function savePrefs() {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch (err) { /* 기기 설정은 못 저장해도 괜찮아요 */ }
}

function saveLocal() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    storageWorks = true;
    return true;
  } catch (err) {
    storageWorks = false;
    const quota = !!(err && (err.name === 'QuotaExceededError' || err.code === 22));
    setSaved(quota ? '○ 저장 공간 부족 · 백업 필요' : '○ 자동 저장을 쓸 수 없어요', 'error', quota ? '○ 공간 부족' : '○ 저장 불가');
    toast(quota
      ? '저장 공간이 부족해요. 설정에서 백업해 주세요.'
      : '이 브라우저에서는 자동 저장이 안 돼요. 설정에서 백업해 주세요.');
    return false;
  }
}

/** 모든 변경 뒤에 호출: 기기에 저장하고, 공유 중이면 서버로도 보내요. */
function save() {
  const ok = saveLocal();
  if (!ok) return;
  if (sync.cfg.enabled) {
    setSaved('● 실시간 가족 공유 중', 'live', '● 실시간 공유');
    schedulePush();
  } else {
    setSaved('● 이 기기에 자동 저장', 'local', '● 기기 저장');
  }
}

function setSaved(msg, kind, shortMsg) {
  const el = $('#saved');
  if (!el) return;
  const long = el.querySelector('.saved-long');
  const short = el.querySelector('.saved-short');
  if (long && short) {
    long.textContent = msg;
    short.textContent = shortMsg || msg;
  } else {
    el.textContent = msg;
  }
  el.title = msg;
  el.className = kind === 'error' ? 'error' : (kind === 'local' ? 'offline' : '');
  el.setAttribute('data-kind', kind || 'live');
}

/* ---------------------------------------------------------------- 6. 동기화 */
const sync = {
  cfg: { enabled: false, supabaseUrl: '', supabaseAnonKey: '', familyId: 'chaewon-family' },
  remoteAt: '',
  pollTimer: null,
  pushTimer: null,
  busy: false,
  lastError: '',
  lastOkAt: 0
};

function loadSyncConfig() {
  const override = loadJson(SYNC_OVERRIDE_KEY) || {};
  const pick = key => (override[key] !== undefined && override[key] !== null ? override[key] : SYNC_CONFIG[key]);
  const cfg = {
    supabaseUrl: text(pick('supabaseUrl'), 300).replace(/\/+$/, ''),
    supabaseAnonKey: text(pick('supabaseAnonKey'), 900),
    familyId: text(pick('familyId'), 80) || 'chaewon-family'
  };
  cfg.enabled = /^https:\/\//i.test(cfg.supabaseUrl) && cfg.supabaseAnonKey.length > 20;
  return cfg;
}

function syncHeaders(extra) {
  const headers = {
    apikey: sync.cfg.supabaseAnonKey,
    Authorization: 'Bearer ' + sync.cfg.supabaseAnonKey,
    'Content-Type': 'application/json'
  };
  if (extra) Object.keys(extra).forEach(key => { headers[key] = extra[key]; });
  return headers;
}

async function syncCall(path, init) {
  const url = sync.cfg.supabaseUrl + path;
  const res = await fetch(url, init);
  const body = await res.text();
  if (!res.ok) {
    let detail = body ? body.slice(0, 200) : '';
    try {
      const parsed = JSON.parse(body);
      detail = parsed.message || parsed.hint || parsed.details || detail;
    } catch (err) { /* 본문이 JSON이 아니에요 */ }
    throw new Error(detail || ('HTTP ' + res.status));
  }
  return body ? JSON.parse(body) : null;
}

function syncError(err) {
  sync.lastError = err && err.message ? err.message : '연결하지 못했어요';
  setSaved('○ 연결 끊김 · 기기에 저장', 'error', '○ 연결 끊김');
}

function syncOk() {
  sync.lastError = '';
  sync.lastOkAt = Date.now();
  setSaved('● 실시간 가족 공유 중', 'live', '● 실시간 공유');
}

const isTyping = () => {
  const el = document.activeElement;
  return !!(el && /^(input|textarea|select)$/i.test(el.tagName || ''));
};

/** 서버의 최신 기록을 받아와요. */
async function syncPull(options) {
  const opts = options || {};
  if (!sync.cfg.enabled || sync.busy) return false;
  if (!opts.force) {
    if (document.hidden) return false;
    if ($('#dialog') && $('#dialog').open) return false;
    if (isTyping()) return false;
  }
  sync.busy = true;
  try {
    const query = '/rest/v1/family_state?id=eq.' + encodeURIComponent(sync.cfg.familyId) + '&select=id,data,updated_at';
    const rows = await syncCall(query, { method: 'GET', headers: syncHeaders(), cache: 'no-store' });
    syncOk();
    const row = Array.isArray(rows) ? rows[0] : null;
    if (!row || !row.updated_at) return true;
    if (row.updated_at === sync.remoteAt) return true;
    const incoming = normalizeState(row.data);
    sync.remoteAt = row.updated_at;
    if (incoming && JSON.stringify(incoming) !== JSON.stringify(state)) {
      state = incoming;
      saveLocal();
      render();
      toast('가족 기록을 새로 받았어요 ☁');
    }
    return true;
  } catch (err) {
    syncError(err);
    return false;
  } finally {
    sync.busy = false;
  }
}

/** 이 기기의 기록을 서버로 보내요. */
async function syncPush() {
  if (!sync.cfg.enabled) return false;
  try {
    const stamp = new Date().toISOString();
    const rows = await syncCall('/rest/v1/family_state?on_conflict=id', {
      method: 'POST',
      headers: syncHeaders({ Prefer: 'resolution=merge-duplicates,return=representation' }),
      body: JSON.stringify([{ id: sync.cfg.familyId, data: state, updated_at: stamp }])
    });
    const row = Array.isArray(rows) ? rows[0] : null;
    sync.remoteAt = (row && row.updated_at) || stamp;
    syncOk();
    return true;
  } catch (err) {
    syncError(err);
    return false;
  }
}

function schedulePush() {
  if (!sync.cfg.enabled) return;
  clearTimeout(sync.pushTimer);
  sync.pushTimer = setTimeout(() => { syncPush(); }, 700);
}

function syncStart() {
  sync.cfg = loadSyncConfig();
  clearInterval(sync.pollTimer);
  sync.pollTimer = null;
  sync.remoteAt = '';
  if (!sync.cfg.enabled) {
    if (storageWorks) setSaved('● 이 기기에 자동 저장', 'local', '● 기기 저장');
    else setSaved('○ 자동 저장을 쓸 수 없어요', 'error', '○ 저장 불가');
    return;
  }
  setSaved('● 실시간 가족 공유 중', 'live', '● 실시간 공유');
  syncPull({ force: true });
  sync.pollTimer = setInterval(() => { syncPull(); }, SYNC_POLL_MS);
}

async function syncNow(manual) {
  if (!sync.cfg.enabled) {
    if (manual) toast('설정에서 Supabase 주소와 키를 먼저 저장해 주세요.');
    return;
  }
  const pulled = await syncPull({ force: true });
  const pushed = pulled ? await syncPush() : false;
  if (manual) toast(pulled && pushed ? '가족 기록을 주고받았어요 ☁' : '연결하지 못했어요. 주소와 키를 확인해 주세요.');
  if (page === 'settings') render();
}

function saveSyncConfig(event) {
  event.preventDefault();
  const form = new FormData(event.target);
  const cfg = {
    supabaseUrl: text(form.get('url'), 300).replace(/\/+$/, ''),
    supabaseAnonKey: text(form.get('key'), 900),
    familyId: text(form.get('familyId'), 80) || 'chaewon-family'
  };
  if (cfg.supabaseUrl && !/^https:\/\//i.test(cfg.supabaseUrl)) {
    toast('https://로 시작하는 주소를 넣어 주세요.');
    return;
  }
  if (cfg.supabaseUrl && cfg.supabaseAnonKey.length < 20) {
    toast('anon public key도 함께 넣어 주세요.');
    return;
  }
  try {
    if (cfg.supabaseUrl) localStorage.setItem(SYNC_OVERRIDE_KEY, JSON.stringify(cfg));
    else saveSyncOff();
  } catch (err) {
    toast('이 브라우저에서는 설정을 저장할 수 없어요.');
    return;
  }
  syncStart();
  render();
  toast(cfg.supabaseUrl ? '가족 공유를 연결했어요 ☁' : '이 기기에만 저장하도록 바꿨어요');
  if (cfg.supabaseUrl) syncNow(false);
}

/** 이 기기에서만 저장하도록 끄기. 기본 값이 들어 있어도 꺼지도록 빈 설정을 남겨요. */
function saveSyncOff() {
  localStorage.setItem(SYNC_OVERRIDE_KEY, JSON.stringify({
    supabaseUrl: '',
    supabaseAnonKey: '',
    familyId: SYNC_CONFIG.familyId
  }));
}

function clearSyncConfig() {
  try { saveSyncOff(); } catch (err) { /* 무시 */ }
  syncStart();
  render();
  toast('가족 공유를 껐어요. 이 기기에만 저장돼요.');
}

/* ---------------------------------------------------------------- 7. 화면 */
function go(target) {
  page = target;
  if (location.hash !== '#' + target) location.hash = '#' + target;
  render();
  window.scrollTo(0, 0);
}

function routeFromHash() {
  const raw = (location.hash || '').replace('#', '');
  const ok = ROUTES.some(r => r[0] === raw) || raw === 'settings';
  return ok ? raw : 'home';
}

function heading(title, sub, extra) {
  return `<div class="page-heading"><div><p class="eyebrow">OUR LITTLE HAPPY MOMENTS</p><h1>${title}</h1><p>${sub}</p></div>${extra || ''}</div>`;
}

const VIEWS = { home, routine, study, money, chat, records, settings };

function render() {
  if (!VIEWS[page]) page = 'home';
  const nav = $('#nav');
  if (nav) {
    nav.innerHTML = ROUTES.map(route => {
      const active = page === route[0];
      return `<a href="#${route[0]}" class="${active ? 'active' : ''}"${active ? ' aria-current="page"' : ''}><span class="nav-icon" aria-hidden="true">${route[1]}</span>${route[2]}</a>`;
    }).join('');
  }
  const main = $('#main');
  if (main) main.innerHTML = VIEWS[page]();
  renderRoleControl();
  if (page === 'study') updateClock();
}

function roleLabel(person) {
  return `${person.emoji} ${person.name} 화면`;
}

function renderRoleControl() {
  const button = $('#roleControl');
  const menu = $('#roleMenu');
  if (!button || !menu) return;
  const current = viewerPerson();
  button.innerHTML = `${esc(roleLabel(current))} <span aria-hidden="true">▾</span>`;
  button.setAttribute('aria-expanded', roleMenuOpen ? 'true' : 'false');
  menu.hidden = !roleMenuOpen;
  menu.innerHTML = `<p class="role-menu-head">누구의 화면으로 볼까요?</p>` + state.people.map(person => {
    const active = person.id === current.id;
    return `<button type="button" class="role-item ${active ? 'active' : ''}" onclick="selectViewer('${person.id}')">
      <span aria-hidden="true">${esc(person.emoji)}</span>
      <span class="who"><b>${esc(person.name)}</b><small>${esc(person.note || (person.role === 'kid' ? '우리 집 아이' : '우리 집 어른'))}</small></span>
      <span class="check" aria-hidden="true">✓</span>
    </button>`;
  }).join('') + `<p class="role-menu-hint">쪽지와 응원 한마디는 고른 가족 이름으로 남아요. 아이 화면에서는 할 일 등록·수정 버튼이 숨겨져요.</p>`;
}

function toggleRoleMenu(event) {
  if (event) event.stopPropagation();
  roleMenuOpen = !roleMenuOpen;
  renderRoleControl();
}

function closeRoleMenu() {
  if (!roleMenuOpen) return;
  roleMenuOpen = false;
  renderRoleControl();
}

function selectViewer(id) {
  const person = personById(id);
  if (!person) return;
  prefs.viewer = person.id;
  if (person.role === 'kid') prefs.activeKid = person.id;
  savePrefs();
  closeRoleMenu();
  render();
  toast(`${person.name} 화면으로 바꿨어요`);
}

function selectKid(id) {
  const kid = personById(id);
  if (!kid) return;
  prefs.activeKid = kid.id;
  savePrefs();
  render();
}

function kidSwitch(extraClass) {
  const list = kids();
  if (list.length < 2) return '';
  const active = activeKid();
  return `<div class="kid-switch ${extraClass || ''}" role="tablist" aria-label="아이 선택">` + list.map(kid => {
    const on = kid.id === active.id;
    return `<button type="button" role="tab" aria-selected="${on ? 'true' : 'false'}" class="${on ? 'active' : ''}" onclick="selectKid('${kid.id}')"><span aria-hidden="true">${esc(kid.emoji)}</span>${esc(kid.name)}</button>`;
  }).join('') + `</div>`;
}

/* ---------------------------------------------------------------- 8. 조각들 */
function avatarHtml(person, extraClass) {
  const readOnly = isKidView();
  const cls = 'avatar' + (readOnly ? ' readonly' : '') + (extraClass ? ' ' + extraClass : '');
  const inner = person.photo
    ? `<img src="${person.photo}" alt="${esc(person.name)}">`
    : `<span aria-hidden="true">${esc(person.emoji)}</span>`;
  if (readOnly) {
    return `<span class="${cls}" title="${esc(person.name)}">${inner}</span>`;
  }
  return `<button type="button" class="${cls}" onclick="pickPhoto('${person.id}')" aria-label="${esc(person.name)} 사진 바꾸기">${inner}</button>`;
}

function toast(message, options) {
  const opts = options || {};
  const box = $('#toast');
  const label = $('#toastText');
  const action = $('#toastAction');
  if (!box || !label) return;
  label.textContent = message;
  if (opts.actionLabel && typeof opts.onAction === 'function') {
    if (action) {
      action.textContent = opts.actionLabel;
      action.hidden = false;
      action.onclick = () => {
        hideToast();
        opts.onAction();
      };
    }
  } else if (action) {
    action.hidden = true;
    action.onclick = null;
  }
  box.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(hideToast, opts.duration || (opts.actionLabel ? 6500 : 2800));
}

function hideToast() {
  const box = $('#toast');
  if (box) box.classList.remove('show');
}

function celebrate() {
  for (let i = 0; i < 20; i += 1) {
    const bit = document.createElement('span');
    bit.className = 'confetti';
    bit.textContent = ['🌸', '⭐', '💗', '✨'][i % 4];
    bit.style.left = Math.random() * 100 + 'vw';
    bit.style.animationDelay = Math.random() * 0.5 + 's';
    document.body.appendChild(bit);
    setTimeout(() => { if (bit.parentNode) bit.parentNode.removeChild(bit); }, 2500);
  }
}

function weekStrip(kidId) {
  const today = dayKey();
  const { y, m, d } = seoulYMD();
  const anchor = new Date(Date.UTC(y, m - 1, d));
  const monday = new Date(anchor.getTime() - ((anchor.getUTCDay() + 6) % 7) * 86400000);
  const stamps = stampsOf(kidId);
  const labels = ['월', '화', '수', '목', '금', '토', '일'];
  return `<div class="week">` + labels.map((label, index) => {
    const day = new Date(monday.getTime() + index * 86400000);
    const key = `${day.getUTCFullYear()}-${pad2(day.getUTCMonth() + 1)}-${pad2(day.getUTCDate())}`;
    const done = stamps.indexOf(key) >= 0;
    return `<div class="day">${label}<div class="stamp ${done ? 'done' : ''} ${key === today ? 'today' : ''}">${done ? '🌸' : '·'}</div></div>`;
  }).join('') + `</div>`;
}

function familyGrid() {
  return `<div class="family-grid">` + state.people.map(person => {
    const score = person.role === 'kid'
      ? `⭐ ${stampsOf(person.id).length}개의 반짝 도장`
      : '♡ 오늘도 함께해요';
    return `<div class="family-card tone-${person.tone}">
      <span class="small-star" aria-hidden="true">✦</span>
      ${avatarHtml(person)}
      <div class="card-body"><h3>${esc(person.name)}</h3><p>${esc(person.note || (person.role === 'kid' ? '우리 집 아이' : '우리 집 어른'))}</p><div class="score">${score}</div></div>
    </div>`;
  }).join('') + `</div>`;
}

/* ---------------------------------------------------------------- 9. 우리 집 */
function home() {
  const kid = activeKid();
  const mission = MISSIONS[state.missionIndex] || MISSIONS[0];
  const missionDone = state.missionDays.indexOf(dayKey()) >= 0;
  return heading('우리 가족, 오늘도 반짝!', '작은 도전도, 다정한 마음도 차곡차곡 모아요.',
    `<span class="date-pill">📅 ${LONG_DATE_FMT.format(new Date())}</span>`)
    + `<section class="hero">
        <div class="hero-text">
          <span class="tag">🌷 채원공주와 주원이를 위한 작은 세상</span>
          <h2>오늘은 어떤 <em>반짝임</em>을<br>만나게 될까?</h2>
          <p>잘하지 않아도 괜찮아. 한 걸음이면 충분해 ♡</p>
        </div>
        <div class="hero-art" aria-hidden="true">
          <div class="hill"></div><span class="cloud">☁️</span><span class="castle">🏰</span>
          <span class="sparkle">✦</span><span class="flower">🌷</span><span class="star-float">⭐</span>
        </div>
      </section>`
    + cheerCard(kid)
    + `<div class="section-title"><h2>우리 집 반짝 멤버</h2><small>${isKidView() ? '우리 가족, 오늘도 함께해요 ♡' : '사진을 누르면 바꿀 수 있어요 📷'}</small></div>`
    + familyGrid()
    + `<div class="grid-two">${stampPanel(kid)}${missionPanel(mission, missionDone)}</div>`
    + studySummary();
}

function cheerCard(kid) {
  const today = dayKey();
  const notes = state.encouragements.filter(note => note.kid === kid.id && note.date === today).slice(-4);
  const canWrite = !isKidView();
  const writer = viewerPerson();
  const noteHtml = notes.length
    ? notes.map(note => {
        const writerPerson = personById(note.person);
        return `<div class="cheer-note">
          <span class="cheer-heart" aria-hidden="true">${esc(writerPerson ? writerPerson.emoji : '💗')}</span>
          <div><small>${esc(writerPerson ? writerPerson.name : '가족')} · 오늘의 마음</small><p>${esc(note.text)}</p></div>
          <button type="button" class="cheer-del" onclick="confirmRemoveCheer('${note.id}')" aria-label="이 응원 지우기">×</button>
        </div>`;
      }).join('')
    : `<div class="cheer-note">
        <span class="cheer-heart" aria-hidden="true">💌</span>
        <div><small>${esc(kid.name)}를 응원해요</small><p>${canWrite
          ? `오늘 ${esc(kid.name)}에게 전하고 싶은 말을 남겨 주세요.`
          : `${esc(kid.name)}아, 오늘도 너의 속도로 반짝여 봐!`}</p></div>
      </div>`;

  const composer = canWrite
    ? `<form class="cheer-compose" onsubmit="submitCheer(event)">
        <textarea name="text" rows="2" maxlength="200" required placeholder="예: 어려워도 끝까지 해본 네가 정말 멋졌어!" aria-label="${esc(kid.name)}에게 응원 한마디"></textarea>
        <button class="primary" type="submit">${esc(writer.name)} 마음 보내기 💗</button>
      </form>
      <div class="cheer-quick">${CHEER_PRESETS.map((preset, index) => `<button type="button" onclick="fillCheer(${index})">${esc(preset[0])}</button>`).join('')}</div>`
    : `<p class="sub" style="margin-bottom:0">엄마·아빠의 응원은 여기에 도착해요 ♡</p>`;

  return `<section class="panel cheer-panel">
    <div class="panel-head">
      <h2>💗 ${esc(kid.name)}에게, 응원 한마디</h2>
      ${kids().length > 1 ? kidSwitch('small') : '<span class="badge">오늘의 마음 우체통</span>'}
    </div>
    <p class="sub">결과보다 소중한 건, 오늘도 해본 너의 마음이야.</p>
    ${noteHtml}
    ${composer}
  </section>`;
}

function fillCheer(index) {
  const preset = CHEER_PRESETS[index];
  const box = $('.cheer-compose textarea');
  if (!preset || !box) return;
  box.value = preset[1];
  box.focus();
}

function submitCheer(event) {
  event.preventDefault();
  const form = new FormData(event.target);
  addCheer(activeKid().id, form.get('text'));
}

function addCheer(kidId, message) {
  const body = text(message, 200);
  if (!body) {
    toast('한마디를 적어 주세요 💗');
    return;
  }
  state.encouragements.push({
    id: uid(),
    person: viewerPerson().id,
    kid: kidId,
    text: body,
    date: dayKey(),
    at: Date.now()
  });
  save();
  render();
  celebrate();
  toast('응원이 도착했어요 💗');
}

function confirmRemoveCheer(id) {
  const note = state.encouragements.find(item => item.id === id);
  if (!note) return;
  const writer = personById(note.person);
  openForm({
    title: '이 응원을 지울까요?',
    body: `<p>“${esc(note.text)}”</p><p class="sub">${esc(writer ? writer.name : '가족')}의 오늘 한마디예요.</p>`,
    submitLabel: '지우기',
    danger: true,
    onSubmit: () => {
      const index = state.encouragements.indexOf(note);
      state.encouragements.splice(index, 1);
      save();
      render();
      toast('응원을 지웠어요', {
        actionLabel: '되돌리기',
        onAction: () => {
          state.encouragements.splice(index, 0, note);
          save();
          render();
          toast('되돌렸어요 💗');
        }
      });
    }
  });
}

function stampPanel(kid) {
  const stamps = stampsOf(kid.id);
  const todayDone = stamps.indexOf(dayKey()) >= 0;
  return `<section class="panel">
    <div class="panel-head">
      <h2>🌸 ${esc(kid.name)} 도장판</h2>
      ${kids().length > 1 ? kidSwitch('small') : `<span class="badge">차곡차곡 ${stamps.length}개</span>`}
    </div>
    <p class="sub">공부나 할 일을 마치면, 오늘의 꽃이 피어나요. 지금까지 ${stamps.length}개.</p>
    ${weekStrip(kid.id)}
    <div class="panel-bottom">
      <span>${todayDone ? '오늘도 꽃이 피었어요!' : '오늘의 첫 도장을 기다려요'}</span>
      <button type="button" class="link-button" onclick="go('records')">도장판 보기 ↗</button>
    </div>
  </section>`;
}

function missionPanel(mission, missionDone) {
  return `<section class="panel mission">
    <div class="panel-head"><h2>🎲 오늘의 가족 미션</h2><span class="badge">하루 한 번, 함께</span></div>
    <div class="mission-body">
      <span class="mission-emoji" aria-hidden="true">${mission[0]}</span>
      <div><h3>${esc(mission[1])}</h3><p>${esc(mission[2])}</p></div>
    </div>
    <div class="actions">
      <button type="button" class="primary green" onclick="completeMission()">${missionDone ? '✓ 오늘 미션 성공!' : '다 같이 했어요! 🙌'}</button>
      <button type="button" class="secondary" onclick="nextMission()" aria-label="다른 미션 뽑기">↻</button>
    </div>
  </section>`;
}

function studySummary() {
  const list = kids().map(kid => {
    const tasks = state.tasks.filter(t => t.person === kid.id && t.kind === 'study' && visibleTask(t));
    const done = tasks.filter(checked).length;
    return `${esc(kid.name)} ${done}/${tasks.length}`;
  }).join(' · ');
  return `<section class="panel study-summary">
    <span class="summary-icon" aria-hidden="true">📚</span>
    <div class="summary-body">
      <h3>조금씩, 즐겁게! 오늘의 공부</h3>
      <p>${list} 완료 · 오늘도 두 아이를 응원해요</p>
    </div>
    <button type="button" class="primary" onclick="go('study')">공부방 가기 →</button>
  </section>`;
}

function completeMission() {
  if (state.missionDays.indexOf(dayKey()) >= 0) {
    toast('오늘의 가족 미션은 이미 완료했어요 ♡');
    return;
  }
  state.missionDays.push(dayKey());
  save();
  render();
  celebrate();
  toast('우리 가족 최고! 사랑이 한 뼘 자랐어요 💗');
}

function nextMission() {
  if (state.missionDays.indexOf(dayKey()) >= 0) {
    toast('오늘 미션을 이미 마쳤어요. 내일 또 만나요!');
    return;
  }
  state.missionIndex = (state.missionIndex + 1) % MISSIONS.length;
  save();
  render();
}

/* ---------------------------------------------------------------- 10. 할 일 */
function taskHtml(task, canCheck) {
  const done = checked(task);
  return `<div class="task ${done ? 'checked' : ''}">
    <input id="chk-${task.id}" type="checkbox" ${done ? 'checked' : ''} ${canCheck ? '' : 'disabled'} onchange="toggleTask('${task.id}')">
    <label class="task-label" for="chk-${task.id}"><span>${esc(task.title)}</span>${task.detail ? `<small>${esc(task.detail)}</small>` : ''}</label>
    ${task.kind === 'study' && task.reward ? `<span class="reward">🪙 ${task.reward.toLocaleString()}원</span>` : ''}
    ${isKidView() ? '' : `<button type="button" class="edit-btn" onclick="editTask('${task.id}')" aria-label="할 일 수정">✎</button>
    <button type="button" class="edit-btn" onclick="removeTask('${task.id}')" aria-label="할 일 삭제">×</button>`}
  </div>`;
}

function taskGroup(person, kind) {
  const tasks = state.tasks.filter(t => t.person === person.id && t.kind === kind && visibleTask(t));
  const done = tasks.filter(checked).length;
  const canEdit = !isKidView();
  const canCheck = canEdit || person.id === viewerPerson().id;
  const earned = person.role === 'kid' ? earnedToday(person.id) : 0;
  const percent = tasks.length ? Math.round((done / tasks.length) * 100) : 0;
  return `<section class="panel task-group" data-person="${person.id}">
    <div class="panel-head">
      <h3>${avatarHtml(person, 'small')}<span class="who">${esc(person.name)}<small>${esc(person.note || (person.role === 'kid' ? '우리 집 아이' : '우리 집 어른'))}</small></span></h3>
      <span class="badge">${done} / ${tasks.length} 완료${earned ? ` · 오늘 +${earned.toLocaleString()}원` : ''}</span>
    </div>
    <div class="progress"><span style="width:${percent}%"></span></div>
    ${tasks.map(task => taskHtml(task, canCheck)).join('')}
    ${tasks.length ? '' : '<p class="empty">작은 도전 하나를 추가해 보세요 🌱</p>'}
    ${canEdit ? `<button type="button" class="link-button add-task" onclick="editTask(null,'${person.id}','${kind}')">+ ${esc(person.name)} ${kind === 'study' ? '공부' : '할 일'} 추가</button>` : ''}
  </section>`;
}

function routine() {
  return heading('오늘의 작은 약속 🌼', '엄마도 아빠도 함께! 하나씩 해내는 기쁨을 느껴요.')
    + state.people.map(person => taskGroup(person, 'routine')).join('');
}

function study() {
  const studyPeople = state.people.filter(person => person.role === 'kid' ||
    state.tasks.some(task => task.person === person.id && task.kind === 'study'));
  return heading('반짝 공부방 📚', '매일 조금씩 자라는 마음. 공부를 마치면 용돈도 차곡차곡!')
    + `<section class="panel timer">
        <div class="panel-head"><h2>⏳ 지금은 집중할 시간</h2><span class="badge">소리 알림은 이 화면이 열려 있을 때</span></div>
        <div class="clock" id="clock" aria-live="off">10:00</div>
        <div class="timer-controls">
          <button type="button" class="secondary" onclick="setTimer(10)">10분</button>
          <button type="button" class="secondary" onclick="setTimer(20)">20분</button>
          <button type="button" class="secondary" onclick="setTimer(30)">30분</button>
          <select id="customMinutes" aria-label="직접 시간 선택">
            <option value="1">1분</option><option value="5">5분</option><option value="15">15분</option><option value="40">40분</option>
          </select>
          <button type="button" class="secondary" onclick="applyCustomMinutes()">시간 적용</button>
        </div>
        <div class="timer-controls" style="margin-top:12px">
          <button type="button" class="primary" id="timerStart" onclick="startTimer()">${timerEnd ? 'Ⅱ 잠깐 쉬기' : '▶ 시작하기'}</button>
          <button type="button" class="secondary" onclick="setTimer(10)">↻ 초기화</button>
        </div>
      </section>
      <div class="spacer" style="height:18px"></div>`
    + studyPeople.map(person => taskGroup(person, 'study')).join('');
}

function applyCustomMinutes() {
  const select = $('#customMinutes');
  if (select) setTimer(Number(select.value));
}

function toggleTask(id) {
  const task = state.tasks.find(item => item.id === id);
  if (!task) return;
  const today = dayKey();
  const list = state.checks[today] || (state.checks[today] = []);
  const index = list.indexOf(id);
  const kid = personById(task.person);

  if (index < 0) {
    list.push(id);
    if (kid && kid.role === 'kid' && task.kind === 'study' && task.reward > 0) {
      ledger(kid.id).transactions.push({ id: uid(), date: today, title: task.title, amount: task.reward, task: id });
    }
    if (kid && kid.role === 'kid' && stampsOf(kid.id).indexOf(today) < 0) {
      stampsOf(kid.id).push(today);
    }
    save();
    render();
    celebrate();
    toast(kid && kid.role === 'kid' && task.reward
      ? `참 잘했어요! ${task.reward.toLocaleString()}원이 쌓였어요 🪙`
      : '참 잘했어요! 반짝 도장 꾹 🌸');
    return;
  }

  list.splice(index, 1);
  if (!list.length) delete state.checks[today];
  if (kid && kid.role === 'kid') {
    const book = ledger(kid.id);
    book.transactions = book.transactions.filter(entry => !(entry.task === id && entry.date === today));
    const stillDone = state.tasks.some(item => item.person === kid.id && checked(item));
    if (!stillDone) {
      state.stamps[kid.id] = stampsOf(kid.id).filter(day => day !== today);
    }
  }
  save();
  render();
  toast('완료를 취소했어요. 적립금도 함께 되돌렸어요.');
}

function editTask(id, person, kind) {
  const existing = id ? state.tasks.find(item => item.id === id) : null;
  const owner = existing ? existing.person : (person || activeKid().id);
  const ownerPerson = personById(owner);
  const isKid = !!(ownerPerson && ownerPerson.role === 'kid');
  const taskKind = existing ? existing.kind : (kind || 'routine');
  const draft = existing || { title: '', detail: '', reward: 100, repeat: true };
  const moneyField = (taskKind === 'study' && isKid)
    ? `<label>완료하면 쌓이는 용돈 (원)<input name="reward" type="number" min="0" max="100000" step="1" inputmode="numeric" value="${draft.reward}"></label>`
    : '';
  openForm({
    title: existing ? '작은 도전 수정하기' : '새로운 도전 추가하기',
    fields: `<label>이름<input name="title" required maxlength="60" value="${esc(draft.title)}" placeholder="예: 그림책 10분 읽기"></label>
      <label>양이나 설명<input name="detail" maxlength="60" value="${esc(draft.detail || '')}" placeholder="예: 천천히, 꼼꼼하게"></label>
      ${moneyField}
      <label>반복<select name="repeat">
        <option value="true" ${draft.repeat !== false ? 'selected' : ''}>매일 다시 나타나요</option>
        <option value="false" ${draft.repeat === false ? 'selected' : ''}>오늘만 할 일이에요</option>
      </select></label>`,
    onSubmit: form => {
      const title = text(form.get('title'), 60);
      if (!title) return false;
      const reward = isKid && taskKind === 'study' ? clampInt(form.get('reward'), 0, 100000) : 0;
      if (existing) {
        if (checked(existing) && existing.kind === 'study' && reward !== existing.reward) {
          toast('오늘 완료를 먼저 취소한 뒤 적립금을 바꿔 주세요.');
          return false;
        }
        existing.title = title;
        existing.detail = text(form.get('detail'), 60);
        existing.reward = reward;
        existing.repeat = form.get('repeat') === 'true';
      } else {
        const task = {
          id: uid(),
          person: owner,
          kind: taskKind,
          title: title,
          detail: text(form.get('detail'), 60),
          reward: reward,
          repeat: form.get('repeat') === 'true'
        };
        if (!task.repeat) task.created = dayKey();
        state.tasks.push(task);
      }
      save();
      render();
      toast('저장했어요 ♡');
    }
  });
}

function removeTask(id) {
  const task = state.tasks.find(item => item.id === id);
  if (!task) return;
  openForm({
    title: '이 도전을 삭제할까요?',
    body: `<p><b>${esc(task.title)}</b></p><p class="sub">지금까지 쌓인 용돈과 도장 기록은 그대로 남아요.</p>`,
    submitLabel: '삭제하기',
    danger: true,
    onSubmit: () => {
      state.tasks = state.tasks.filter(item => item.id !== id);
      Object.keys(state.checks).forEach(date => {
        state.checks[date] = state.checks[date].filter(taskId => taskId !== id);
        if (!state.checks[date].length) delete state.checks[date];
      });
      save();
      render();
      toast('도전을 삭제했어요');
    }
  });
}

/* ---------------------------------------------------------------- 11. 공부방 타이머 */
function updateClock() {
  const clock = $('#clock');
  if (!clock) return;
  clock.textContent = pad2(Math.floor(timerSeconds / 60)) + ':' + pad2(timerSeconds % 60);
}

function setTimer(minutes) {
  clearInterval(timerInterval);
  timerInterval = null;
  timerEnd = 0;
  timerSeconds = Math.max(1, Math.min(180, Math.round(minutes || 10))) * 60;
  updateClock();
  const button = $('#timerStart');
  if (button) button.textContent = '▶ 시작하기';
}

function startTimer() {
  const button = $('#timerStart');
  if (timerEnd) {
    timerSeconds = Math.max(0, Math.ceil((timerEnd - Date.now()) / 1000));
    timerEnd = 0;
    clearInterval(timerInterval);
    timerInterval = null;
    if (button) button.textContent = '▶ 이어하기';
    updateClock();
    return;
  }
  if (timerSeconds <= 0) timerSeconds = 600;
  timerEnd = Date.now() + timerSeconds * 1000;
  if (button) button.textContent = 'Ⅱ 잠깐 쉬기';
  clearInterval(timerInterval);
  timerInterval = setInterval(() => {
    timerSeconds = Math.max(0, Math.ceil((timerEnd - Date.now()) / 1000));
    updateClock();
    if (timerSeconds > 0) return;
    clearInterval(timerInterval);
    timerInterval = null;
    timerEnd = 0;
    toast('집중 시간 끝! 정말 잘했어요 🎉');
    celebrate();
    const startBtn = $('#timerStart');
    if (startBtn) startBtn.textContent = '▶ 다시 시작';
    playChime();
  }, 250);
}

function playChime() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    [523, 659, 784].forEach((frequency, index) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = frequency;
      gain.gain.value = 0.08;
      osc.start(ctx.currentTime + index * 0.18);
      osc.stop(ctx.currentTime + index * 0.18 + 0.15);
    });
  } catch (err) { /* 소리는 없어도 괜찮아요 */ }
}

/* ---------------------------------------------------------------- 12. 용돈통장 */
function money() {
  const kid = activeKid();
  const book = ledger(kid.id);
  const total = book.transactions.filter(entry => entry.amount > 0).reduce((sum, entry) => sum + entry.amount, 0);
  const spent = book.transactions.filter(entry => entry.amount < 0).reduce((sum, entry) => sum - entry.amount, 0);
  const current = balance(kid.id);
  const remaining = Math.max(0, book.goal - current);
  const percent = Math.min(100, Math.max(0, Math.round((current / book.goal) * 100)));
  const rows = book.transactions.slice().reverse();

  return heading(`${kid.name}의 용돈통장 🐷`, '작은 노력의 결실을 모아, 나만의 꿈에 한 걸음 더!')
    + (kids().length > 1 ? `<div class="kid-switch" role="tablist" aria-label="아이 선택" style="margin-bottom:16px">${kids().map(item => {
        const on = item.id === kid.id;
        return `<button type="button" role="tab" aria-selected="${on ? 'true' : 'false'}" class="${on ? 'active' : ''}" onclick="selectKid('${item.id}')"><span aria-hidden="true">${esc(item.emoji)}</span>${esc(item.name)}</button>`;
      }).join('')}</div>` : '')
    + `<div class="big-balance">
        <h2>지금까지 모은 반짝 용돈</h2>
        <strong>${current.toLocaleString()}<span> 원</span></strong>
        <p>시작 용돈 ${book.opening.toLocaleString()}원 · 적립 +${total.toLocaleString()}원 · 사용 −${spent.toLocaleString()}원</p>
        <div class="actions">
          <button type="button" class="secondary" onclick="addMoney(1)">+ 용돈 받았어요</button>
          <button type="button" class="secondary" onclick="addMoney(-1)">− 용돈 썼어요</button>
        </div>
      </div>
      <section class="panel">
        <div class="panel-head"><h2>🎁 ${esc(kid.name)}의 저금 목표</h2><button type="button" class="link-button" onclick="changeGoal()">목표 바꾸기</button></div>
        <p class="sub">${book.goal.toLocaleString()}원까지 ${remaining.toLocaleString()}원 남았어요.</p>
        <div class="progress"><span style="width:${percent}%"></span></div>
      </section>
      <section class="panel" style="margin-top:18px">
        <h2>🧾 용돈 발자국</h2>
        <p class="sub">${isKidView() ? '기록은 이 기기에 차곡차곡 쌓여요.' : '잘못 적은 기록은 × 로 지울 수 있어요.'}</p>
        ${rows.map(entry => `<div class="log-row">
          <span aria-hidden="true">${entry.amount > 0 ? '🪙' : '🛍️'}</span>
          <div class="log-text"><p>${esc(entry.title)}</p><small>${esc(shortDate(entry.date))}</small></div>
          <b class="amount ${entry.amount > 0 ? 'plus' : 'minus'}">${entry.amount > 0 ? '+' : '−'}${Math.abs(entry.amount).toLocaleString()}원</b>
          ${isKidView() ? '' : `<button type="button" class="row-del" onclick="confirmRemoveTransaction('${kid.id}','${entry.id}')" aria-label="이 기록 지우기">×</button>`}
        </div>`).join('') || '<div class="empty">첫 번째 반짝 용돈을 기다려요 🐷<br><br>공부를 마치거나 받은 용돈을 적어보세요.</div>'}
      </section>`;
}

function shortDate(key) {
  if (!DATE_RE.test(key || '')) return key || '';
  const parts = key.split('-');
  const year = seoulYMD().y;
  const label = `${Number(parts[1])}월 ${Number(parts[2])}일`;
  return String(Number(parts[0])) === String(year) ? label : `${parts[0]}년 ${label}`;
}

function addMoney(sign) {
  const kid = activeKid();
  openForm({
    title: sign > 0 ? `${kid.name}가 용돈을 받았어요 🪙` : `${kid.name}가 용돈을 썼어요 🛍️`,
    fields: `<label>어떤 용돈인가요?<input name="title" required maxlength="60" placeholder="${sign > 0 ? '예: 할머니가 주신 용돈' : '예: 문구점에서 색연필'}"></label>
      <label>금액 (원)<input name="amount" type="number" required min="1" max="10000000" step="1" inputmode="numeric" placeholder="0"></label>`,
    onSubmit: form => {
      const amount = clampInt(form.get('amount'), 1, 10000000) * sign;
      const title = text(form.get('title'), 60);
      if (!title) return false;
      if (balance(kid.id) + amount < 0) {
        toast('모은 용돈보다 많이 쓸 수 없어요.');
        return false;
      }
      ledger(kid.id).transactions.push({ id: uid(), date: dayKey(), title: title, amount: amount });
      save();
      render();
      toast('용돈을 기록했어요 🐷');
    }
  });
}

function confirmRemoveTransaction(kidId, id) {
  const book = ledger(kidId);
  const index = book.transactions.findIndex(entry => entry.id === id);
  if (index < 0) return;
  const entry = book.transactions[index];
  const fromTask = entry.task ? '공부를 마쳐서 쌓인 용돈이에요. 지워도 완료 표시와 도장은 그대로 남아요.' : '직접 적은 기록이에요.';
  openForm({
    title: '이 기록을 지울까요?',
    body: `<p><b>${esc(entry.title)}</b></p>
      <p>${entry.amount > 0 ? '+' : '−'}${Math.abs(entry.amount).toLocaleString()}원 · ${esc(shortDate(entry.date))}</p>
      <p class="sub">${fromTask}</p>`,
    submitLabel: '지우기',
    danger: true,
    onSubmit: () => {
      book.transactions.splice(index, 1);
      save();
      render();
      toast('용돈 기록을 지웠어요', {
        actionLabel: '되돌리기',
        onAction: () => {
          book.transactions.splice(index, 0, entry);
          save();
          render();
          toast('기록을 되돌렸어요 🐷');
        }
      });
    }
  });
}

function changeGoal() {
  const kid = activeKid();
  const book = ledger(kid.id);
  openForm({
    title: `${kid.name}는 어떤 꿈을 모을까요? 🎁`,
    fields: `<label>목표 금액 (원)<input type="number" name="goal" min="1" max="100000000" step="1" inputmode="numeric" required value="${book.goal}"></label>`,
    onSubmit: form => {
      book.goal = clampInt(form.get('goal'), 1, 100000000);
      save();
      render();
      toast('저금 목표를 바꿨어요');
    }
  });
}

/* ---------------------------------------------------------------- 13. 가족 쪽지 */
function chat() {
  const me = viewerPerson();
  const list = state.messages.map(message => {
    const writer = personById(message.person) || state.people[0];
    const mine = message.person === me.id;
    return `<div class="message ${mine ? 'right' : ''}">
      <span class="msg-emoji" aria-hidden="true">${esc(writer.emoji)}</span>
      <div class="msg-body">
        <small>${esc(writer.name)}${mine ? ' · 나' : ''} · ${esc(message.date)}</small>
        <div class="bubble-row">
          <div class="bubble">${esc(message.text)}</div>
          <button type="button" class="msg-del" onclick="confirmRemoveMessage('${message.id}')" aria-label="이 쪽지 지우기">×</button>
        </div>
      </div>
    </div>`;
  }).join('');

  return heading('우리 가족의 다정한 쪽지 💌', '고마운 마음, 사랑하는 마음을 말풍선에 담아요.')
    + `<div class="notice">쪽지는 이 기기 안에 차곡차곡 저장돼요. 같은 기기에서는 언제든 다시 읽을 수 있고, 설정에서 백업 파일을 내려받아 두면 기기를 바꿔도 마음이 그대로 남아요. 가족 공유를 켜면 다른 휴대폰에서도 함께 볼 수 있어요. 💌</div>
      <section class="panel">
        <div class="chat" id="chatMessages">${list || `<div class="empty" style="padding:55px 10px"><div style="font-size:42px">💌</div><p>첫 쪽지를 남겨볼까요?</p>“오늘도 많이 사랑해!”</div>`}</div>
        <form class="chat-compose" onsubmit="sendMessage(event)">
          ${isKidView() ? '' : `<select name="person" aria-label="보내는 가족">${state.people.map(person => `<option value="${person.id}" ${person.id === me.id ? 'selected' : ''}>${esc(person.name)}</option>`).join('')}</select>`}
          <input name="message" maxlength="500" required placeholder="다정한 마음을 적어주세요" aria-label="쪽지 내용" autocomplete="off">
          <button class="primary" type="submit">보내기 ♡</button>
        </form>
        <div class="quick-notes">
          <button type="button" class="secondary" onclick="quickMessage('사랑해요 💗')">💗 사랑해요</button>
          <button type="button" class="secondary" onclick="quickMessage('참 잘했어요! 🙌')">🙌 참 잘했어요</button>
          <button type="button" class="secondary" onclick="quickMessage('오늘도 고마워요 🌷')">🌷 고마워요</button>
        </div>
      </section>`;
}

function sendMessage(event) {
  event.preventDefault();
  const form = new FormData(event.target);
  postMessage(form.get('person'), form.get('message'));
}

function postMessage(personId, message) {
  const body = text(message, 500);
  if (!body) return;
  const writer = personById(personId) ? personId : viewerPerson().id;
  state.messages.push({ id: uid(), person: writer, text: body, date: nowLabel(), at: Date.now() });
  save();
  render();
  const box = $('#chatMessages');
  if (box) box.scrollTop = box.scrollHeight;
  toast('마음을 남겼어요 💌');
}

function quickMessage(message) {
  const select = $('.chat-compose select');
  postMessage(select ? select.value : viewerPerson().id, message);
}

function confirmRemoveMessage(id) {
  const message = state.messages.find(item => item.id === id);
  if (!message) return;
  const writer = personById(message.person);
  openForm({
    title: '이 쪽지를 지울까요?',
    body: `<p>“${esc(message.text)}”</p><p class="sub">${esc(writer ? writer.name : '가족')} · ${esc(message.date)}</p>`,
    submitLabel: '지우기',
    danger: true,
    onSubmit: () => {
      const index = state.messages.indexOf(message);
      state.messages.splice(index, 1);
      save();
      render();
      toast('쪽지를 지웠어요', {
        actionLabel: '되돌리기',
        onAction: () => {
          state.messages.splice(index, 0, message);
          save();
          render();
          toast('쪽지를 되돌렸어요 💌');
        }
      });
    }
  });
}

/* ---------------------------------------------------------------- 14. 도장판 */
function records() {
  const kid = activeKid();
  const stamps = stampsOf(kid.id);
  const now = seoulYMD();
  const first = new Date(Date.UTC(now.y, now.m - 1 + calOffset, 1));
  const year = first.getUTCFullYear();
  const month = first.getUTCMonth();
  const days = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const startBlank = (new Date(Date.UTC(year, month, 1)).getUTCDay() + 6) % 7;
  const monthKey = `${year}-${pad2(month + 1)}`;
  const monthCount = stamps.filter(day => day.indexOf(monthKey) === 0).length;
  const today = dayKey();

  let cells = '';
  for (let i = 0; i < startBlank; i += 1) cells += '<div class="cal-day blank"></div>';
  for (let day = 1; day <= days; day += 1) {
    const key = keyOf(year, month, day);
    const has = stamps.indexOf(key) >= 0;
    cells += `<div class="cal-day ${has ? 'has' : ''} ${key === today ? 'today' : ''}">${day}<span class="flower-ico" aria-hidden="true">${has ? '🌸' : '·'}</span></div>`;
  }

  return heading(`${kid.name}의 꽃 도장판 🌸`, '어제보다 한 뼘 더! 매일의 작은 성장을 기억해요.')
    + (kids().length > 1 ? `<div class="kid-switch" role="tablist" aria-label="아이 선택" style="margin-bottom:16px">${kids().map(item => {
        const on = item.id === kid.id;
        return `<button type="button" role="tab" aria-selected="${on ? 'true' : 'false'}" class="${on ? 'active' : ''}" onclick="selectKid('${item.id}')"><span aria-hidden="true">${esc(item.emoji)}</span>${esc(item.name)}</button>`;
      }).join('')}</div>` : '')
    + `<section class="panel">
        <div class="panel-head">
          <div class="cal-nav">
            <button type="button" class="secondary" onclick="shiftMonth(-1)" aria-label="이전 달">‹</button>
            <h2>${year}년 ${month + 1}월</h2>
            <button type="button" class="secondary" onclick="shiftMonth(1)" aria-label="다음 달">›</button>
          </div>
          <span class="badge">이번 달 꽃 ${monthCount}개</span>
        </div>
        <p class="sub">하루에 한 번, 꽃이 피어나요. 지금까지 모두 ${stamps.length}개.</p>
        <div class="cal">${['월', '화', '수', '목', '금', '토', '일'].map(day => `<div class="dow">${day}</div>`).join('')}${cells}</div>
      </section>
      <div class="notice">${esc(kid.name)}가 공부나 오늘 할 일을 하나라도 마치면 도장이 찍혀요. 그날의 완료를 모두 취소하면 도장도 함께 취소돼요.</div>`;
}

function shiftMonth(delta) {
  calOffset += delta;
  render();
}

/* ---------------------------------------------------------------- 15. 설정 */
function settings() {
  const kidView = isKidView();
  return heading('우리 가족 맞춤 설정 ⚙', '이름도, 사진도, 저장 방식도 우리 가족답게.')
    + `<div class="settings-grid">
        ${familyPanel(kidView)}
        ${kidView ? '' : openingPanel()}
        ${syncPanel()}
        ${backupPanel(kidView)}
      </div>`;
}

function familyPanel(kidView) {
  return `<section class="panel">
    <div class="panel-head">
      <h2>👨‍👩‍👧‍👦 우리 가족</h2>
      ${kidView ? '<span class="badge">보기만 해요</span>' : '<button type="button" class="link-button" onclick="openAddMember()">+ 가족 추가</button>'}
    </div>
    <p class="sub">${kidView
      ? '이름과 사진은 엄마·아빠 화면에서 바꿀 수 있어요. 위쪽 화면 버튼으로 바꿀 수 있어요.'
      : '사진을 누르면 앨범에서 골라 바꿀 수 있어요. 아이 화면에서는 이름·사진이 잠겨요.'}</p>
    ${state.people.map(person => `<div class="member-row">
      ${avatarHtml(person)}
      <div class="member-info">
        <b>${esc(person.name)} <span class="role-tag ${person.role === 'kid' ? 'kid' : ''}">${person.role === 'kid' ? '아이' : '어른'}</span></b>
        <small>${esc(person.note || '한마디를 적어 보세요')}</small>
      </div>
      ${kidView ? '' : `<div class="row-actions">
        <button type="button" class="link-button" onclick="editMember('${person.id}')">수정</button>
        ${state.people.length > 1 ? `<button type="button" class="row-del" onclick="confirmRemoveMember('${person.id}')" aria-label="${esc(person.name)} 가족에서 빼기">×</button>` : ''}
      </div>`}
    </div>`).join('')}
    ${kidView ? '' : `<div class="notice soft">채원공주·주원이처럼 ‘아이’로 표시한 가족은 공부방 용돈과 도장판을 각자 가져요. ‘어른’은 응원과 쪽지를 함께 남겨요.</div>`}
  </section>`;
}

function openingPanel() {
  const list = kids();
  return `<section class="panel">
    <h2>🐷 처음 모아둔 용돈 · 저금 목표</h2>
    <p class="sub">공부로 쌓이는 용돈과 별도로, 이미 모아둔 금액을 아이별로 적어요.</p>
    ${list.map(kid => {
      const book = ledger(kid.id);
      return `<div class="kid-money-row">
        <span class="name">${esc(kid.emoji)} ${esc(kid.name)}</span>
        <input type="number" min="0" max="100000000" step="1" inputmode="numeric" value="${book.opening}" aria-label="${esc(kid.name)} 시작 용돈" onchange="setOpening('${kid.id}', this.value)">
        <small style="font-size:10px;color:var(--muted)">원</small>
      </div>`;
    }).join('')}
    <p class="sub" style="margin-bottom:0">저금 목표는 용돈통장 화면에서 아이별로 바꿀 수 있어요.</p>
  </section>`;
}

function syncPanel() {
  const cfg = sync.cfg && sync.cfg.enabled ? sync.cfg : loadSyncConfig();
  const statusText = cfg.enabled
    ? (sync.lastError ? `○ 연결에 문제가 있어요 · ${esc(sync.lastError)}` : '● 실시간 가족 공유 중')
    : '● 이 기기에 자동 저장 중 (공유 꺼짐)';
  const last = sync.lastOkAt ? `${clockLabel(sync.lastOkAt)}에 확인했어요. ` : '';
  return `<section class="panel">
    <h2>☁ 실시간 가족 공유 (선택)</h2>
    <p class="sub">Supabase를 연결하면 엄마·아빠 휴대폰이 5초마다 같은 기록을 주고받아요. 비워두면 이 기기에만 저장돼요.</p>
    <div class="storage-status ${cfg.enabled ? '' : 'offline'}">${statusText}</div>
    <form class="sync-fields" onsubmit="saveSyncConfig(event)">
      <label>프로젝트 주소 (Project URL)<input name="url" value="${esc(cfg.supabaseUrl)}" placeholder="https://abcdefgh.supabase.co" inputmode="url" autocomplete="off" spellcheck="false"></label>
      <label>anon public key<input name="key" value="${esc(cfg.supabaseAnonKey)}" placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6..." autocomplete="off" spellcheck="false"></label>
      <label>가족 코드 (표의 id)<input name="familyId" value="${esc(cfg.familyId)}" placeholder="chaewon-family" autocomplete="off" spellcheck="false"></label>
      <div class="actions">
        <button class="primary" type="submit">연결 저장</button>
        <button class="secondary" type="button" onclick="syncNow(true)">지금 동기화</button>
        <button class="secondary" type="button" onclick="clearSyncConfig()">공유 끄기</button>
      </div>
    </form>
    <p class="sync-status">${last}${cfg.enabled ? '두 기기에서 동시에 고치면 마지막에 저장한 기록이 남아요.' : '설정 값은 이 브라우저에만 저장돼요.'}</p>
    <details class="notice soft">
      <summary style="cursor:pointer;font-weight:700">처음 한 번만: Supabase 표 만들기</summary>
      <p>Supabase SQL Editor에서 아래를 실행한 뒤, 위에 주소와 키를 넣어 주세요. 가족 코드는 남에게 알려주지 마세요.</p>
      <pre style="white-space:pre-wrap;font-size:10.5px;line-height:1.7;background:#fff;padding:10px;border-radius:10px;overflow:auto">create table if not exists public.family_state (
  id text primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.family_state enable row level security;
create policy family_read on public.family_state for select using (true);
create policy family_write on public.family_state for insert with check (true);
create policy family_update on public.family_state for update using (true);</pre>
    </details>
  </section>`;
}

function backupPanel(kidView) {
  return `<section class="panel">
    <h2>💾 저장과 백업</h2>
    <p class="sub">가족 정보, 할 일, 도장, 용돈, 쪽지, 응원 한마디가 이 브라우저에 자동 저장돼요.</p>
    <div class="storage-status ${storageWorks ? '' : 'offline'}">${storageWorks ? '● 이 기기에 저장 중' : '○ 저장 공간을 쓸 수 없어요'}</div>
    <div class="notice">브라우저 데이터를 지우거나 기기를 바꾸면 기록이 사라질 수 있어요. 백업 파일을 내려받아 구글드라이브에 보관해 주세요. 다른 기기에서는 그 파일을 불러오면 이어서 볼 수 있어요.</div>
    <div class="actions">
      <button class="primary" type="button" onclick="exportData()">↓ 전체 기록 백업</button>
      ${kidView ? '' : `<button class="secondary" type="button" onclick="pickImport()">↑ 백업 불러오기</button>`}
    </div>
    <p class="sub">백업에는 가족 사진과 모든 기록이 들어 있어요. 불러오면 이 기기의 현재 기록을 대체해요.</p>
  </section>`;
}

function openAddMember() {
  openForm({
    title: '가족을 한 명 더 모셔요 🌷',
    fields: `<label>이름<input name="name" required maxlength="15" placeholder="예: 할머니"></label>
      <label>그림(이모지)<input name="emoji" maxlength="8" value="💗" placeholder="💗"></label>
      <label>한마디<input name="note" maxlength="40" placeholder="예: 주말마다 놀러 오세요"></label>
      <label>구분<select name="role">
        <option value="kid">아이 (공부·용돈·도장판을 따로 가져요)</option>
        <option value="parent">어른</option>
      </select></label>`,
    submitLabel: '가족에 추가 ♡',
    onSubmit: form => {
      const name = text(form.get('name'), 15);
      if (!name) return false;
      const member = {
        id: 'm' + Date.now().toString(36),
        name: name,
        emoji: text(form.get('emoji'), 8) || '💗',
        note: text(form.get('note'), 40),
        photo: '',
        tone: state.people.length % TONES,
        role: form.get('role') === 'kid' ? 'kid' : 'parent'
      };
      state.people.push(member);
      if (member.role === 'kid') {
        state.stamps[member.id] = [];
        state.money[member.id] = { opening: 0, goal: 10000, transactions: [] };
      }
      save();
      render();
      toast('우리 가족이 한 명 늘었어요 🌷');
    }
  });
}

function editMember(id) {
  const person = personById(id);
  if (!person) return;
  openForm({
    title: `${person.name} 이야기 ✎`,
    fields: `<label>이름<input name="name" required maxlength="15" value="${esc(person.name)}"></label>
      <label>그림(이모지)<input name="emoji" maxlength="8" value="${esc(person.emoji)}"></label>
      <label>한마디<input name="note" maxlength="40" value="${esc(person.note)}" placeholder="예: 우리 집 다정한 응원단"></label>
      <label>구분<select name="role">
        <option value="kid" ${person.role === 'kid' ? 'selected' : ''}>아이 (공부·용돈·도장판을 따로)</option>
        <option value="parent" ${person.role === 'parent' ? 'selected' : ''}>어른</option>
      </select></label>`,
    onSubmit: form => {
      const name = text(form.get('name'), 15);
      if (!name) return false;
      const role = form.get('role') === 'kid' ? 'kid' : 'parent';
      if (person.role === 'kid' && role === 'parent' && kids().length <= 1) {
        toast('아이는 최소 한 명이 있어야 해요.');
        return false;
      }
      person.name = name;
      person.emoji = text(form.get('emoji'), 8) || person.emoji;
      person.note = text(form.get('note'), 40);
      person.role = role;
      if (role === 'kid') {
        if (!state.stamps[person.id]) state.stamps[person.id] = [];
        if (!state.money[person.id]) state.money[person.id] = { opening: 0, goal: 10000, transactions: [] };
      }
      save();
      render();
      toast('저장했어요 ♡');
    }
  });
}

function confirmRemoveMember(id) {
  const person = personById(id);
  if (!person) return;
  if (state.people.length <= 1) {
    toast('가족은 최소 한 명이 있어야 해요.');
    return;
  }
  const tasks = state.tasks.filter(task => task.person === id);
  const messages = state.messages.filter(item => item.person === id).length;
  const cheers = state.encouragements.filter(item => item.person === id).length;
  const stamps = stampsOf(id).length;
  openForm({
    title: '가족 목록에서 뺄까요?',
    body: `<p><b>${esc(person.name)}</b> 가족을 목록에서 뺄까요?</p>
      <p class="sub">함께 정리돼요 — ${person.role === 'kid' ? '도장 ' + stamps + '개 · ' : ''}할 일 ${tasks.length}개 · 쪽지 ${messages}개 · 응원 ${cheers}개${person.role === 'kid' ? ' · 용돈 기록' : ''}</p>
      <p class="sub">되돌릴 수 없으니 필요하면 먼저 백업해 주세요.</p>`,
    submitLabel: '가족에서 빼기',
    danger: true,
    onSubmit: () => {
      const taskIds = tasks.map(task => task.id);
      state.people = state.people.filter(item => item.id !== id);
      state.tasks = state.tasks.filter(task => task.person !== id);
      Object.keys(state.checks).forEach(date => {
        state.checks[date] = state.checks[date].filter(taskId => taskIds.indexOf(taskId) < 0);
        if (!state.checks[date].length) delete state.checks[date];
      });
      state.messages = state.messages.filter(item => item.person !== id);
      state.encouragements = state.encouragements.filter(item => item.person !== id);
      delete state.stamps[id];
      delete state.money[id];
      if (!personById(prefs.viewer)) prefs.viewer = state.people[0].id;
      if (!personById(prefs.activeKid) || !activeKid()) prefs.activeKid = (kids()[0] || state.people[0]).id;
      savePrefs();
      save();
      render();
      toast('가족 목록을 정리했어요');
    }
  });
}

function setOpening(kidId, value) {
  const book = ledger(kidId);
  const next = clampInt(value, 0, 100000000);
  const spent = book.transactions.reduce((sum, entry) => sum + entry.amount, 0);
  if (next + spent < 0) {
    toast('잔액이 0원보다 작아질 수 없어요.');
    render();
    return;
  }
  book.opening = next;
  save();
  render();
  toast('시작 용돈을 저장했어요');
}

/* ---------------------------------------------------------------- 16. 사진 */
function pickPhoto(id) {
  if (isKidView()) return;
  photoPerson = id;
  const input = $('#photoInput');
  if (!input) return;
  input.value = '';
  input.click();
}

async function onPhotoPicked(event) {
  const file = event.target.files && event.target.files[0];
  if (!file) return;
  if (!/^image\//.test(file.type)) {
    toast('사진 파일을 골라 주세요.');
    return;
  }
  const person = personById(photoPerson);
  if (!person) return;
  try {
    const bitmap = await createImageBitmap(file);
    const canvas = document.createElement('canvas');
    canvas.width = 240;
    canvas.height = 240;
    const size = Math.min(bitmap.width, bitmap.height);
    canvas.getContext('2d').drawImage(bitmap, (bitmap.width - size) / 2, (bitmap.height - size) / 2, size, size, 0, 0, 240, 240);
    person.photo = canvas.toDataURL('image/jpeg', 0.85);
    save();
    render();
    toast('가족 사진을 바꿨어요 📷');
  } catch (err) {
    toast('사진을 읽지 못했어요. JPG나 PNG로 다시 골라 주세요.');
  }
}

function resetPhoto(id) {
  const person = personById(id);
  if (!person) return;
  person.photo = '';
  save();
  render();
}

/* ---------------------------------------------------------------- 17. 백업 */
function exportData() {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `chaewon-juwon-family-${dayKey()}.json`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast('백업 파일을 내려받았어요. 드라이브에 보관해 주세요.');
}

function pickImport() {
  const input = $('#importInput');
  if (!input) return;
  input.value = '';
  input.click();
}

async function onImportPicked(event) {
  const file = event.target.files && event.target.files[0];
  if (!file) return;
  try {
    if (file.size > 6000000) throw new Error('too big');
    const parsed = JSON.parse(await file.text());
    const incoming = normalizeState(parsed);
    if (!incoming || !Array.isArray(parsed.people) || !parsed.people.length) throw new Error('invalid');
    openForm({
      title: '가족 기록을 바꿀까요?',
      body: `<p>불러올 기록: 가족 ${incoming.people.length}명 · 할 일 ${incoming.tasks.length}개 · 쪽지 ${incoming.messages.length}개</p>
        <p class="sub">이 기기의 현재 기록이 백업 파일의 기록으로 바뀌어요. 먼저 지금 기록을 백업해 두면 안전해요.</p>`,
      submitLabel: '불러오기',
      danger: true,
      onSubmit: () => {
        state = incoming;
        if (!personById(prefs.viewer)) prefs.viewer = state.people[0].id;
        if (!personById(prefs.activeKid)) prefs.activeKid = (kids()[0] || state.people[0]).id;
        savePrefs();
        save();
        render();
        toast('백업 기록을 불러왔어요 ♡');
      }
    });
  } catch (err) {
    toast('올바른 반짝하루 백업 파일을 골라 주세요.');
  }
  event.target.value = '';
}

/* ---------------------------------------------------------------- 18. 다이얼로그 */
function openForm(options) {
  const dialog = $('#dialog');
  const form = $('#dialogForm');
  if (!dialog || !form) return;
  $('#dialogTitle').textContent = options.title || '';
  $('#dialogBody').innerHTML = options.body || '';
  $('#dialogFields').innerHTML = options.fields || '';
  const submit = $('#dialogSubmit');
  if (submit) {
    submit.textContent = options.submitLabel || '저장하기 ♡';
    submit.className = 'primary' + (options.danger ? ' danger' : '');
  }
  form.onsubmit = event => {
    event.preventDefault();
    const data = new FormData(event.target);
    if (options.onSubmit(data) !== false) closeDialog();
  };
  if (!dialog.open) dialog.showModal();
  const first = $('#dialogFields').querySelector('input,select,textarea') || $('#dialogCancel');
  if (first) setTimeout(() => { try { first.focus(); } catch (err) { /* 무시 */ } }, 40);
}

function closeDialog() {
  const dialog = $('#dialog');
  if (dialog && dialog.open) dialog.close();
}

/* ---------------------------------------------------------------- 19. 시작 */
function start() {
  page = routeFromHash();
  bindOnce();
  render();
  syncStart();
}

function bindOnce() {
  const photo = $('#photoInput');
  if (photo) photo.onchange = onPhotoPicked;
  const importer = $('#importInput');
  if (importer) importer.onchange = onImportPicked;
  const closeButton = $('#dialogClose');
  if (closeButton) closeButton.onclick = closeDialog;
  const cancelButton = $('#dialogCancel');
  if (cancelButton) cancelButton.onclick = closeDialog;
  const dialog = $('#dialog');
  if (dialog) dialog.addEventListener('click', event => { if (event.target === dialog) closeDialog(); });

  document.addEventListener('click', event => {
    if (!roleMenuOpen) return;
    const wrap = document.querySelector('.role-wrap');
    if (wrap && wrap.contains(event.target)) return;
    closeRoleMenu();
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && roleMenuOpen) closeRoleMenu();
  });
  window.addEventListener('hashchange', () => {
    page = routeFromHash();
    render();
  });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) syncPull({ force: true });
  });
  window.addEventListener('focus', () => { syncPull({ force: true }); });
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
}
