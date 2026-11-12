import crypto from 'crypto';
import { db, parseQuestion, now, newShareCode } from './db.js';
import { grade, scaled } from './grading.js';

export const FULL = {
  rw: { count: 27, time: 32 * 60 },
  math: { count: 22, time: 35 * 60 },
  break: 10 * 60,
};

export const MODULE_KEYS = ['rw1', 'rw2', 'math1', 'math2'];

const RW_DOMAINS = [
  ['Craft and Structure', 0.28],
  ['Information and Ideas', 0.26],
  ['Standard English Conventions', 0.26],
  ['Expression of Ideas', 0.2],
];
const MATH_DOMAINS = [
  ['Algebra', 0.35],
  ['Advanced Math', 0.35],
  ['Problem-Solving and Data Analysis', 0.15],
  ['Geometry and Trigonometry', 0.15],
];

export function moduleTitle(key) {
  const sec = key.startsWith('rw') ? 'Reading and Writing' : 'Math';
  return `${sec} - Module ${key.slice(-1)}`;
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function textHash(text) {
  const norm = String(text || '').toLowerCase().replace(/\[figure\]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  if (norm.length < 25) return null;
  return crypto.createHash('sha1').update(norm).digest('hex');
}

function stagesFrom(modules, fraction, breakFull = FULL.break, minBreak = 30) {
  const stages = [];
  const hasRw = modules.some((m) => m.section === 'rw');
  const hasMath = modules.some((m) => m.section === 'math');
  for (const m of modules) {
    if (m.section === 'math' && hasRw && hasMath && !stages.some((s) => s.kind === 'break')) {
      const t = Math.round(breakFull * fraction);
      if (t >= minBreak) stages.push({ kind: 'break', time: t, title: 'Break' });
    }
    stages.push({ kind: 'module', ...m });
  }
  return stages;
}

function usedQuestionIds(userId) {
  const used = new Set();
  for (const r of db.prepare('SELECT stages_json FROM tests WHERE user_id = ?').all(userId)) {
    for (const s of JSON.parse(r.stages_json)) for (const id of s.questionIds || []) used.add(id);
  }
  return used;
}

export function categoryKey(section, domain, skill) {
  return `${section}|${domain || 'Uncategorized'}|${skill || domain || 'Uncategorized'}`;
}

function matchesFilters(r, section, filters) {
  if (!filters) return true;
  if (Array.isArray(filters.skills) && !filters.skills.includes(categoryKey(section, r.domain, r.skill))) return false;
  if (Array.isArray(filters.difficulties) && !filters.difficulties.includes(r.difficulty || 'none')) return false;
  return true;
}

function correctQuestionIds(userId) {
  const ids = new Set();
  for (const r of db.prepare('SELECT status, result_json, state_json FROM tests WHERE user_id = ?').all(userId)) {
    if (r.status === 'finished' && r.result_json) {
      for (const item of JSON.parse(r.result_json).items) if (item.correct === true) ids.add(item.questionId);
    } else {
      const st = JSON.parse(r.state_json);
      const checked = Object.keys(st.checked || {}).map(Number);
      for (const q of questionsByIds(checked)) if (grade(q, st.answers[q.id]) === true) ids.add(q.id);
    }
  }
  return ids;
}

function pickQuestions(section, count, exclude, used, hardBias, bankOnly, filters) {
  const rows = db.prepare(`SELECT id, domain, skill, difficulty, correct_json IS NOT NULL AS answered FROM ${bankOnly ? 'bank_questions' : 'all_questions'} WHERE in_pool = 1 AND section = ?`).all(section);
  const avail = rows.filter((r) => !exclude.has(r.id) && matchesFilters(r, section, filters));
  const score = (r) => (r.answered ? 0 : 4) + (used.has(r.id) ? 2 : 0) + (hardBias && r.difficulty === 'E' ? 1 : 0) + (!hardBias && r.difficulty === 'H' ? 0.5 : 0) + Math.random();
  const domains = section === 'rw' ? RW_DOMAINS : MATH_DOMAINS;
  const picked = [];
  const byDomain = new Map();
  for (const r of avail) {
    const key = domains.find(([d]) => d === r.domain) ? r.domain : '__other';
    if (!byDomain.has(key)) byDomain.set(key, []);
    byDomain.get(key).push(r);
  }
  for (const list of byDomain.values()) list.sort((a, b) => score(a) - score(b));
  let quotas = domains.map(([d, w]) => [d, Math.round(w * count)]);
  let diff = count - quotas.reduce((s, [, q]) => s + q, 0);
  for (let i = 0; diff !== 0 && i < 20; i++) {
    const idx = i % quotas.length;
    quotas[idx][1] = Math.max(0, quotas[idx][1] + Math.sign(diff));
    diff -= Math.sign(diff);
  }
  for (const [d, q] of quotas) {
    const list = byDomain.get(d) || [];
    while (picked.length < count && list.length && picked.filter((p) => p.domain === d).length < q) picked.push(list.shift());
  }
  const rest = [...byDomain.values()].flat().sort((a, b) => score(a) - score(b));
  for (const r of rest) {
    if (picked.length >= count) break;
    if (!picked.includes(r)) picked.push(r);
  }
  const order = domains.map(([d]) => d);
  const diffOrder = { E: 0, M: 1, H: 2 };
  picked.sort((a, b) => {
    if (section === 'rw') {
      const da = order.indexOf(a.domain);
      const dbb = order.indexOf(b.domain);
      return (da < 0 ? 9 : da) - (dbb < 0 ? 9 : dbb) || (diffOrder[a.difficulty] ?? 1) - (diffOrder[b.difficulty] ?? 1);
    }
    return (diffOrder[a.difficulty] ?? 1) - (diffOrder[b.difficulty] ?? 1);
  });
  return picked.map((r) => r.id);
}

export function createGeneratedTest(user, { modules, fraction, showWrong, title, skipCorrect, bankOnly, filters, timed }) {
  const keys = MODULE_KEYS.filter((k) => modules.includes(k));
  if (!keys.length) throw new Error('Select at least one module');
  const f = Math.max(0, Math.min(1, Number(fraction)));
  const used = usedQuestionIds(user.id);
  const exclude = skipCorrect ? correctQuestionIds(user.id) : new Set();
  const mods = [];
  for (const key of keys) {
    const section = key.startsWith('rw') ? 'rw' : 'math';
    const full = FULL[section];
    const count = Math.max(1, Math.round(full.count * f));
    const ids = pickQuestions(section, count, exclude, used, key.endsWith('2'), !!bankOnly, filters || null);
    if (!ids.length && filters) throw new Error(`No ${section === 'rw' ? 'Reading and Writing' : 'Math'} questions match the categories and difficulty you picked. Uncheck that module or pick more categories.`);
    if (!ids.length) throw new Error(skipCorrect ? `You already got every ${section === 'rw' ? 'Reading and Writing' : 'Math'} question right. Turn off the switch to practice them again.` : `The question bank has no ${section === 'rw' ? 'Reading and Writing' : 'Math'} questions yet. Import a PDF or ask an admin to fetch the College Board bank.`);
    ids.forEach((id) => exclude.add(id));
    mods.push({ key, section, module: Number(key.slice(-1)), title: moduleTitle(key), time: Math.max(60, Math.round((full.time * ids.length) / full.count)), questionIds: ids });
  }
  const stages = stagesFrom(mods, f);
  return insertTest(user, title || 'Practice SAT', 'generated', { modules: keys, fraction: f, showWrong: !!showWrong, skipCorrect: !!skipCorrect, bankOnly: !!bankOnly, custom: !!filters, timed: !!timed }, stages);
}

export function createPdfTest(user, { parsed, questionIds, modules, fraction, showWrong, title, timed }) {
  const keys = MODULE_KEYS.filter((k) => modules.includes(k));
  const f = Math.max(0, Math.min(1, Number(fraction)));
  const mods = [];
  for (const key of keys) {
    const section = key.startsWith('rw') ? 'rw' : 'math';
    const moduleNo = Number(key.slice(-1));
    const all = parsed.questions.map((q, i) => ({ q, id: questionIds[i] })).filter((x) => x.q.section === section && x.q.module === moduleNo);
    if (!all.length) continue;
    const count = Math.max(1, Math.round(all.length * f));
    const chosen = [];
    for (let i = 0; i < count; i++) chosen.push(all[Math.floor((i * all.length) / count)].id);
    const fullTime = parsed.timings[key] || (FULL[section].time * all.length) / FULL[section].count;
    mods.push({ key, section, module: moduleNo, title: moduleTitle(key), time: Math.max(60, Math.round((fullTime * chosen.length) / all.length)), questionIds: chosen });
  }
  if (!mods.length) throw new Error('No questions were found in the selected modules of this PDF');
  const stages = stagesFrom(mods, f, parsed.timings.break || FULL.break);
  return insertTest(user, title || 'Imported SAT', 'pdf', { modules: keys, fraction: f, showWrong: !!showWrong, timed: !!timed }, stages);
}

export function createManualTest(user, { questionIds, showWrong, title, timed }) {
  const ids = [...new Set((questionIds || []).map(Number))];
  if (!ids.length) throw new Error('Pick at least one question');
  const qs = questionsByIds(ids, { includeAnswer: false });
  const mods = [];
  for (const section of ['rw', 'math']) {
    const list = qs.filter((q) => q.section === section).map((q) => q.id);
    if (!list.length) continue;
    const full = FULL[section];
    mods.push({ key: `${section}1`, section, module: 1, title: section === 'rw' ? 'Reading and Writing' : 'Math', time: Math.max(60, Math.round((full.time * list.length) / full.count)), questionIds: list });
  }
  if (!mods.length) throw new Error('None of those questions exist anymore');
  const total = mods.reduce((n, m) => n + m.questionIds.length, 0);
  const stages = stagesFrom(mods, Math.min(1, total / (2 * FULL.rw.count + 2 * FULL.math.count)), FULL.break, 120);
  return insertTest(user, title || 'My picked questions', 'manual', { modules: mods.map((m) => m.key), fraction: 1, showWrong: !!showWrong, timed: !!timed }, stages);
}

export function createFromCode(user, code, title, timed) {
  const src = db.prepare('SELECT * FROM tests WHERE share_code = ?').get(String(code || '').trim().toUpperCase());
  if (!src) throw new Error('No test has that code');
  const stages = JSON.parse(src.stages_json);
  const config = { ...JSON.parse(src.config_json), sharedFrom: src.share_code, timed: !!timed };
  const id = insertTest(user, title || src.title, 'shared', config, stages);
  db.prepare('UPDATE tests SET source_test_id = ?, origin_test_id = ? WHERE id = ?').run(src.id, src.origin_test_id || src.id, id);
  return id;
}

function insertTest(user, title, kind, config, stages) {
  // An untimed test has no clock, so it has no breaks either.
  if (config.timed === false) stages = stages.filter((s) => s.kind !== 'break');
  const state = { stage: 0, remaining: { 0: stages[0].time }, answers: {}, flagged: [], checked: {}, current: {} };
  const t = now();
  const r = db.prepare('INSERT INTO tests (user_id, title, kind, config_json, stages_json, state_json, created_at, updated_at, share_code) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(user.id, title, kind, JSON.stringify(config), JSON.stringify(stages), JSON.stringify(state), t, t, newShareCode());
  return r.lastInsertRowid;
}

export function loadTest(id, userId) {
  const row = db.prepare('SELECT * FROM tests WHERE id = ? AND user_id = ?').get(id, userId);
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    kind: row.kind,
    status: row.status,
    shareCode: row.share_code,
    config: JSON.parse(row.config_json),
    stages: JSON.parse(row.stages_json),
    state: JSON.parse(row.state_json),
    result: row.result_json ? JSON.parse(row.result_json) : null,
    studyPlan: row.study_plan,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    finishedAt: row.finished_at,
  };
}

export function saveState(id, state) {
  db.prepare('UPDATE tests SET state_json = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(state), now(), id);
}

export function questionsByIds(ids, opts) {
  if (!ids.length) return [];
  const rows = db.prepare(`SELECT * FROM all_questions WHERE id IN (${ids.map(() => '?').join(',')})`).all(...ids);
  const map = new Map(rows.map((r) => [r.id, parseQuestion(r, opts)]));
  return ids.map((id) => map.get(id)).filter(Boolean);
}

export function computeResult(test) {
  const sections = { rw: { correct: 0, scorable: 0, total: 0 }, math: { correct: 0, scorable: 0, total: 0 } };
  const categories = {};
  const items = [];
  for (const stage of test.stages) {
    if (stage.kind !== 'module') continue;
    const qs = questionsByIds(stage.questionIds);
    qs.forEach((q, idx) => {
      const ans = test.state.answers[q.id];
      const ok = grade(q, ans);
      const sec = sections[stage.section];
      sec.total++;
      if (ok !== null) {
        sec.scorable++;
        if (ok) sec.correct++;
        const cat = q.domain || (stage.section === 'rw' ? 'Reading and Writing (uncategorized)' : 'Math (uncategorized)');
        const skill = q.skill || cat;
        const key = `${stage.section}|${cat}|${skill}`;
        if (!categories[key]) categories[key] = { section: stage.section, domain: cat, skill, correct: 0, total: 0 };
        categories[key].total++;
        if (ok) categories[key].correct++;
      }
      items.push({ questionId: q.id, stage: stage.key, number: idx + 1, answer: ans ?? null, correct: ok });
    });
  }
  const rw = sections.rw.total ? scaled(sections.rw.correct, sections.rw.scorable) : null;
  const math = sections.math.total ? scaled(sections.math.correct, sections.math.scorable) : null;
  let total = null;
  if (rw !== null && math !== null) total = rw + math;
  else if (rw !== null) total = rw * 2;
  else if (math !== null) total = math * 2;
  return {
    sections,
    scores: { rw, math, total, projected: rw === null || math === null },
    categories: Object.values(categories).sort((a, b) => a.correct / a.total - b.correct / b.total),
    items,
  };
}
