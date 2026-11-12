import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(here, '..', 'data');
fs.mkdirSync(dataDir, { recursive: true });

export const db = new Database(path.join(dataDir, 'sat.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  is_admin INTEGER NOT NULL DEFAULT 0,
  hate_ai INTEGER NOT NULL DEFAULT 0,
  api_key TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS api_words (
  word TEXT PRIMARY KEY COLLATE NOCASE,
  api_key TEXT NOT NULL,
  model TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS questions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL,
  source_ref TEXT,
  section TEXT NOT NULL,
  domain TEXT,
  skill TEXT,
  difficulty TEXT,
  type TEXT NOT NULL,
  stimulus_html TEXT NOT NULL DEFAULT '',
  stem_html TEXT NOT NULL DEFAULT '',
  choices_json TEXT NOT NULL DEFAULT '[]',
  correct_json TEXT,
  rationale_html TEXT,
  plain_text TEXT NOT NULL DEFAULT '',
  hash TEXT,
  in_pool INTEGER NOT NULL DEFAULT 1,
  answer_source TEXT,
  created_by INTEGER,
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_questions_ref ON questions(source, source_ref);
CREATE INDEX IF NOT EXISTS idx_questions_hash ON questions(hash);
CREATE INDEX IF NOT EXISTS idx_questions_pool ON questions(in_pool, section);
CREATE TABLE IF NOT EXISTS bank_questions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL,
  source_ref TEXT,
  section TEXT NOT NULL,
  domain TEXT,
  skill TEXT,
  difficulty TEXT,
  type TEXT NOT NULL,
  stimulus_html TEXT NOT NULL DEFAULT '',
  stem_html TEXT NOT NULL DEFAULT '',
  choices_json TEXT NOT NULL DEFAULT '[]',
  correct_json TEXT,
  rationale_html TEXT,
  plain_text TEXT NOT NULL DEFAULT '',
  hash TEXT,
  in_pool INTEGER NOT NULL DEFAULT 1,
  answer_source TEXT,
  created_by INTEGER,
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_bank_ref ON bank_questions(source, source_ref);
CREATE INDEX IF NOT EXISTS idx_bank_hash ON bank_questions(hash);
CREATE INDEX IF NOT EXISTS idx_bank_section ON bank_questions(section);
CREATE VIEW IF NOT EXISTS all_questions AS SELECT * FROM questions UNION ALL SELECT * FROM bank_questions;
CREATE TABLE IF NOT EXISTS tests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  kind TEXT NOT NULL,
  config_json TEXT NOT NULL,
  stages_json TEXT NOT NULL,
  state_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'in_progress',
  result_json TEXT,
  study_plan TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  finished_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_tests_user ON tests(user_id, status);
`);

export const BANK_OFFSET = 10000000;

if (!db.prepare("SELECT 1 FROM sqlite_sequence WHERE name = 'bank_questions'").get() && !db.prepare('SELECT 1 FROM bank_questions LIMIT 1').get()) {
  db.prepare("INSERT INTO sqlite_sequence (name, seq) VALUES ('bank_questions', ?)").run(BANK_OFFSET);
}

export function qTable(id) {
  return Number(id) >= BANK_OFFSET ? 'bank_questions' : 'questions';
}

function remapTestIds(map) {
  const m = (id) => map.get(Number(id)) ?? Number(id);
  const remapKeys = (obj) => Object.fromEntries(Object.entries(obj || {}).map(([k, v]) => [String(m(k)), v]));
  for (const t of db.prepare('SELECT id, stages_json, state_json, result_json FROM tests').all()) {
    const stages = JSON.parse(t.stages_json).map((s) => (s.questionIds ? { ...s, questionIds: s.questionIds.map(m) } : s));
    const st = JSON.parse(t.state_json);
    st.answers = remapKeys(st.answers);
    st.checked = remapKeys(st.checked);
    st.crossed = remapKeys(st.crossed);
    st.flagged = (st.flagged || []).map(m);
    let result = t.result_json ? JSON.parse(t.result_json) : null;
    if (result) result.items = result.items.map((i) => ({ ...i, questionId: m(i.questionId) }));
    db.prepare('UPDATE tests SET stages_json = ?, state_json = ?, result_json = ? WHERE id = ?').run(JSON.stringify(stages), JSON.stringify(st), result ? JSON.stringify(result) : null, t.id);
  }
}

const legacyBank = db.prepare("SELECT * FROM questions WHERE source = 'collegeboard' ORDER BY id").all();
if (legacyBank.length) {
  const insert = db.prepare(`INSERT OR IGNORE INTO bank_questions (source, source_ref, section, domain, skill, difficulty, type, stimulus_html, stem_html, choices_json, correct_json, rationale_html, plain_text, hash, in_pool, answer_source, created_by, created_at)
    VALUES (@source, @source_ref, @section, @domain, @skill, @difficulty, @type, @stimulus_html, @stem_html, @choices_json, @correct_json, @rationale_html, @plain_text, @hash, 1, @answer_source, @created_by, @created_at)`);
  db.transaction(() => {
    const map = new Map();
    for (const row of legacyBank) {
      const r = insert.run(row);
      const newId = r.changes ? r.lastInsertRowid : db.prepare('SELECT id FROM bank_questions WHERE source = ? AND source_ref = ?').get(row.source, row.source_ref).id;
      map.set(row.id, Number(newId));
    }
    db.prepare("DELETE FROM questions WHERE source = 'collegeboard'").run();
    remapTestIds(map);
  })();
}

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function newShareCode() {
  for (;;) {
    let code = '';
    for (let i = 0; i < 4; i++) code += CODE_CHARS[crypto.randomInt(CODE_CHARS.length)];
    if (!db.prepare('SELECT 1 FROM tests WHERE share_code = ?').get(code)) return code;
  }
}

if (!db.prepare('PRAGMA table_info(tests)').all().some((c) => c.name === 'share_code')) {
  db.exec('ALTER TABLE tests ADD COLUMN share_code TEXT');
}
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_tests_code ON tests(share_code)');
for (const t of db.prepare('SELECT id FROM tests WHERE share_code IS NULL').all()) {
  db.prepare('UPDATE tests SET share_code = ? WHERE id = ?').run(newShareCode(), t.id);
}

for (const table of ['questions', 'bank_questions']) {
  if (!db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === 'explanation_ai')) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN explanation_ai INTEGER NOT NULL DEFAULT 0`);
  }
}
// Look preferences saved on the account (NULL = not saved yet, the device's own choice is used).
for (const [c, type] of [['color_mode', 'TEXT'], ['glass_ui', 'INTEGER']]) {
  if (!db.prepare('PRAGMA table_info(users)').all().some((x) => x.name === c)) db.exec(`ALTER TABLE users ADD COLUMN ${c} ${type}`);
}
// Which version of the PDF reader made a question (NULL = the old picture-heavy reader).
for (const table of ['questions', 'bank_questions']) {
  if (!db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === 'parser_version')) db.exec(`ALTER TABLE ${table} ADD COLUMN parser_version INTEGER`);
}
for (const c of ['background_file', 'background_version']) {
  if (!db.prepare('PRAGMA table_info(users)').all().some((x) => x.name === c)) db.exec(`ALTER TABLE users ADD COLUMN ${c} TEXT`);
}

for (const c of ['source_test_id', 'origin_test_id']) {
  if (!db.prepare('PRAGMA table_info(tests)').all().some((x) => x.name === c)) db.exec(`ALTER TABLE tests ADD COLUMN ${c} INTEGER`);
}
db.exec('CREATE INDEX IF NOT EXISTS idx_tests_origin ON tests(origin_test_id); CREATE INDEX IF NOT EXISTS idx_tests_source ON tests(source_test_id)');
for (const t of db.prepare('SELECT id, config_json FROM tests WHERE source_test_id IS NULL').all()) {
  const code = JSON.parse(t.config_json).sharedFrom;
  if (!code) continue;
  const src = db.prepare('SELECT id, origin_test_id FROM tests WHERE share_code = ?').get(code);
  if (src) db.prepare('UPDATE tests SET source_test_id = ?, origin_test_id = ? WHERE id = ?').run(src.id, src.origin_test_id || src.id, t.id);
}

export function getSetting(key, fallback = null) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : fallback;
}

export function setSetting(key, value) {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, String(value));
}

if (!getSetting('jwt_secret')) setSetting('jwt_secret', crypto.randomBytes(48).toString('hex'));
if (!db.prepare('PRAGMA table_info(users)').all().some((x) => x.name === 'premium')) db.exec('ALTER TABLE users ADD COLUMN premium INTEGER NOT NULL DEFAULT 0');
// Models used to be Claude ids or older JEV versions; clear them so the OpenRouter defaults apply.
if (getSetting('openrouter_models_v2') !== '1') {
  for (const k of ['default_model', 'llm_model', 'jev_model']) db.prepare('DELETE FROM settings WHERE key = ?').run(k);
  setSetting('openrouter_models_v2', '1');
}

export function parseQuestion(row, { includeAnswer = true } = {}) {
  if (!row) return null;
  const q = {
    id: row.id,
    source: row.source,
    section: row.section,
    domain: row.domain,
    skill: row.skill,
    difficulty: row.difficulty,
    type: row.type,
    stimulus_html: row.stimulus_html,
    stem_html: row.stem_html,
    choices: JSON.parse(row.choices_json || '[]'),
    hasAnswer: !!row.correct_json,
    snippet: (row.plain_text || '').replace(/\[figure\]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 180),
  };
  if (includeAnswer) {
    q.correct = row.correct_json ? JSON.parse(row.correct_json) : null;
    q.rationale_html = row.rationale_html || '';
    q.answer_source = row.answer_source;
    q.explanationAi = !!row.explanation_ai;
    q.pdfVersion = row.source === 'pdf' ? row.parser_version || 1 : null;
  }
  return q;
}

export function now() {
  return Date.now();
}
