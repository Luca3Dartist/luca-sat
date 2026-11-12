import express from 'express';
import cookieParser from 'cookie-parser';
import multer from 'multer';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';
import { db, getSetting, setSetting, parseQuestion, now, qTable, BANK_OFFSET } from './db.js';
import { parseSatPdf, IMAGE_DIR, PDF_READER_VERSION } from './pdf.js';
import { createGeneratedTest, createPdfTest, createManualTest, createFromCode, categoryKey, loadTest, saveState, questionsByIds, computeResult, textHash, FULL, MODULE_KEYS } from './tests.js';
import { grade } from './grading.js';
import { resolveAi, aiStatus, maskKey, tutorChat, studyPlan, questionAsText } from './ai.js';
import { jobStatus, startCollegeBoardFetch, startAnswerGeneration, startExplanationGeneration, stopJob, maybeAutoFill, missingCounts, explainOne } from './jobs.js';
import { freeModel, premiumModel, jevModel } from './openrouter.js';

const here = path.dirname(fileURLToPath(import.meta.url));

// Which commit is running: v<number of commits> and the short hash, read once at startup.
const APP_VERSION = (() => {
  const git = (...args) => execFileSync('git', ['-C', path.join(here, '..', '..'), ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  try {
    return { number: Number(git('rev-list', '--count', 'HEAD')), commit: git('rev-parse', '--short', 'HEAD'), date: git('log', '-1', '--format=%cI') };
  } catch {
    return { number: null, commit: null, date: null };
  }
})();
const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 80 * 1024 * 1024 } });
const PORT = Number(process.env.PORT || 3001);
const BG_DIR = path.join(here, '..', 'data', 'backgrounds');
fs.mkdirSync(BG_DIR, { recursive: true });
const BG_TYPES = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' };
const bgUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

app.use(express.json({ limit: '2mb' }));
app.use(cookieParser());
app.use('/images', express.static(IMAGE_DIR, { maxAge: '30d', immutable: true }));

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function publicUser(u) {
  return {
    id: u.id,
    username: u.username,
    isAdmin: !!u.is_admin,
    hateAi: !!u.hate_ai,
    premium: !!u.premium,
    background: u.background_file ? `/api/me/background?v=${u.background_version}` : null,
    backgroundAnimated: /\.gif$/i.test(u.background_file || ''),
    ai: aiStatus(u),
  };
}

function issue(res, user) {
  const token = jwt.sign({ uid: user.id }, getSetting('jwt_secret'), { expiresIn: '60d' });
  res.cookie('sat_token', token, { httpOnly: true, sameSite: 'lax', maxAge: 60 * 24 * 3600 * 1000 });
}

function auth(req, res, next) {
  try {
    const payload = jwt.verify(req.cookies.sat_token || '', getSetting('jwt_secret'));
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(payload.uid);
    if (!user) throw new Error();
    req.user = user;
    next();
  } catch {
    res.status(401).json({ error: 'Not signed in' });
  }
}

function admin(req, res, next) {
  if (!req.user.is_admin) return res.status(403).json({ error: 'Admins only' });
  next();
}

app.post('/api/auth/register', wrap(async (req, res) => {
  const username = String(req.body.username || '').trim();
  const password = String(req.body.password ?? '');
  if (!username) return res.status(400).json({ error: 'Pick a username' });
  if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(username)) return res.status(400).json({ error: 'That username is taken' });
  const first = db.prepare('SELECT COUNT(*) AS n FROM users').get().n === 0;
  const r = db.prepare('INSERT INTO users (username, password_hash, is_admin, created_at) VALUES (?, ?, ?, ?)').run(username, bcrypt.hashSync(password, 10), first ? 1 : 0, now());
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(r.lastInsertRowid);
  issue(res, user);
  res.json(publicUser(user));
}));

app.post('/api/auth/login', wrap(async (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(String(req.body.username || '').trim());
  if (!user || !bcrypt.compareSync(String(req.body.password ?? ''), user.password_hash)) return res.status(401).json({ error: 'Wrong username or password' });
  issue(res, user);
  res.json(publicUser(user));
}));

app.post('/api/auth/logout', (req, res) => {
  res.clearCookie('sat_token');
  res.json({ ok: true });
});

app.get('/api/auth/me', auth, (req, res) => res.json(publicUser(req.user)));

app.put('/api/me/password', auth, (req, res) => {
  if (!bcrypt.compareSync(String(req.body.current ?? ''), req.user.password_hash)) return res.status(400).json({ error: 'Your current password is wrong' });
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(String(req.body.next ?? ''), 10), req.user.id);
  res.json({ ok: true });
});

app.put('/api/me/settings', auth, (req, res) => {
  if (req.body.hateAi !== undefined) db.prepare('UPDATE users SET hate_ai = ? WHERE id = ?').run(req.body.hateAi ? 1 : 0, req.user.id);
  res.json(publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id)));
});

app.post('/api/me/background', auth, bgUpload.single('image'), (req, res) => {
  const ext = req.file && BG_TYPES[req.file.mimetype];
  if (!ext) return res.status(400).json({ error: 'Choose a PNG, JPG, GIF or WebP image' });
  if (req.user.background_file) fs.rmSync(path.join(BG_DIR, req.user.background_file), { force: true });
  const name = `user-${req.user.id}-${Date.now()}.${ext}`;
  fs.writeFileSync(path.join(BG_DIR, name), req.file.buffer);
  db.prepare('UPDATE users SET background_file = ?, background_version = ? WHERE id = ?').run(name, String(Date.now()), req.user.id);
  res.json(publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id)));
});

app.get('/api/me/background', auth, (req, res) => {
  if (!req.user.background_file) return res.status(404).json({ error: 'No background' });
  res.set('Cache-Control', 'private, max-age=31536000, immutable');
  res.sendFile(path.join(BG_DIR, req.user.background_file));
});

app.delete('/api/me/background', auth, (req, res) => {
  if (req.user.background_file) fs.rmSync(path.join(BG_DIR, req.user.background_file), { force: true });
  db.prepare('UPDATE users SET background_file = NULL, background_version = NULL WHERE id = ?').run(req.user.id);
  res.json(publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id)));
});

app.get('/api/stats', auth, (req, res) => {
  const rows = db.prepare("SELECT id, title, result_json, finished_at, config_json FROM tests WHERE user_id = ? AND status = 'finished' ORDER BY finished_at").all(req.user.id);
  const tests = rows.map((r) => {
    const result = JSON.parse(r.result_json);
    const config = JSON.parse(r.config_json);
    return { id: r.id, title: r.title, finishedAt: r.finished_at, fraction: config.fraction, ...result.scores };
  });
  const avg = (k) => {
    const v = tests.map((t) => t[k]).filter((x) => x !== null && x !== undefined);
    return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : null;
  };
  const inProgress = db.prepare("SELECT COUNT(*) AS n FROM tests WHERE user_id = ? AND status = 'in_progress'").get(req.user.id).n;
  res.json({ tests, average: { total: avg('total'), rw: avg('rw'), math: avg('math') }, best: tests.reduce((m, t) => (t.total > (m ?? 0) ? t.total : m), null), inProgress });
});

app.post('/api/tests/manual', auth, (req, res) => {
  try {
    res.json({ id: createManualTest(req.user, req.body) });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post('/api/tests/from-code', auth, (req, res) => {
  try {
    res.json({ id: createFromCode(req.user, req.body.code, req.body.title, req.body.timed === true) });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.get('/api/tests/code/:code', auth, (req, res) => {
  const r = db.prepare('SELECT t.title, t.stages_json, u.username FROM tests t JOIN users u ON u.id = t.user_id WHERE t.share_code = ?').get(String(req.params.code).trim().toUpperCase());
  if (!r) return res.status(404).json({ error: 'No test has that code' });
  const stages = JSON.parse(r.stages_json).filter((s) => s.kind === 'module');
  res.json({ title: r.title, by: r.username, modules: stages.map((s) => `${s.title} (${s.questionIds.length})`), questions: stages.reduce((n, s) => n + s.questionIds.length, 0) });
});

app.get('/api/categories', auth, (req, res) => {
  const table = req.query.bankOnly === 'true' ? 'bank_questions' : 'all_questions';
  const rows = db.prepare(`SELECT section, domain, skill, difficulty, COUNT(*) AS n FROM ${table} WHERE in_pool = 1 GROUP BY section, domain, skill, difficulty`).all();
  const map = new Map();
  for (const r of rows) {
    const key = categoryKey(r.section, r.domain, r.skill);
    if (!map.has(key)) map.set(key, { key, section: r.section, domain: r.domain || 'Uncategorized', skill: r.skill || r.domain || 'Uncategorized', count: 0, byDifficulty: {} });
    const c = map.get(key);
    c.count += r.n;
    c.byDifficulty[r.difficulty || 'none'] = (c.byDifficulty[r.difficulty || 'none'] || 0) + r.n;
  }
  res.json([...map.values()].sort((a, b) => a.section.localeCompare(b.section) || a.domain.localeCompare(b.domain) || a.skill.localeCompare(b.skill)));
});

app.get('/api/questions', auth, (req, res) => {
  const page = Math.max(0, Number(req.query.page || 0));
  const size = Math.min(50, Number(req.query.size || 20));
  const where = ['in_pool = 1'];
  const params = [];
  for (const f of ['section', 'domain', 'difficulty', 'source']) {
    if (req.query[f]) {
      where.push(`${f} = ?`);
      params.push(req.query[f]);
    }
  }
  if (req.query.search) {
    where.push('plain_text LIKE ?');
    params.push(`%${req.query.search}%`);
  }
  const w = `WHERE ${where.join(' AND ')}`;
  const total = db.prepare(`SELECT COUNT(*) AS n FROM all_questions ${w}`).get(...params).n;
  const rows = db.prepare(`SELECT * FROM all_questions ${w} ORDER BY id LIMIT ? OFFSET ?`).all(...params, size, page * size);
  res.json({ total, items: rows.map((r) => parseQuestion(r, { includeAnswer: false })) });
});

app.get('/api/my-test-questions', auth, (req, res) => {
  const tests = db.prepare('SELECT id, title, share_code, stages_json, created_at FROM tests WHERE user_id = ? ORDER BY created_at DESC').all(req.user.id);
  res.json(tests.map((t) => {
    const stages = JSON.parse(t.stages_json).filter((s) => s.kind === 'module');
    return { id: t.id, title: t.title, shareCode: t.share_code, createdAt: t.created_at, modules: stages.map((s) => ({ title: s.title, questions: questionsByIds(s.questionIds, { includeAnswer: false }).map((q) => ({ id: q.id, section: q.section, domain: q.domain, skill: q.skill, difficulty: q.difficulty, type: q.type, snippet: q.snippet })) })) };
  }));
});

function ownedTest(req, res) {
  const row = db.prepare('SELECT * FROM tests WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!row) res.status(404).json({ error: 'Test not found' });
  return row;
}

function linkedCopies(testId) {
  return db.prepare('SELECT t.*, u.username FROM tests t JOIN users u ON u.id = t.user_id WHERE (t.origin_test_id = ? OR t.source_test_id = ?) AND t.id != ? ORDER BY t.updated_at DESC').all(testId, testId, testId);
}

app.get('/api/tests/:id/takers', auth, (req, res) => {
  const owner = ownedTest(req, res);
  if (!owner) return;
  const stages = JSON.parse(owner.stages_json).filter((s) => s.kind === 'module');
  const qById = new Map();
  for (const s of stages) for (const q of questionsByIds(s.questionIds)) qById.set(q.id, q);
  const copies = linkedCopies(owner.id);
  const stats = new Map();
  const takers = copies.map((c) => {
    const st = JSON.parse(c.state_json);
    const result = c.result_json ? JSON.parse(c.result_json) : null;
    let correct = 0;
    let scorable = 0;
    let answered = 0;
    for (const [qid, q] of qById) {
      const ans = st.answers[qid];
      const has = ans !== undefined && ans !== null && ans !== '';
      const ok = has ? grade(q, ans) : q.correct ? false : null;
      if (!stats.has(qid)) stats.set(qid, { answered: 0, right: 0, wrong: 0, choices: {} });
      const s = stats.get(qid);
      if (has) {
        answered++;
        s.answered++;
        if (q.type === 'mcq') s.choices[ans] = (s.choices[ans] || 0) + 1;
      }
      if (ok !== null) {
        scorable++;
        if (ok) {
          correct++;
          if (has) s.right++;
        } else if (has) s.wrong++;
      }
    }
    return {
      id: c.id,
      username: c.username,
      status: c.status,
      viaCode: JSON.parse(c.config_json).sharedFrom,
      direct: c.source_test_id === owner.id,
      answered,
      questions: qById.size,
      correct,
      scorable,
      scores: result?.scores || null,
      startedAt: c.created_at,
      updatedAt: c.updated_at,
      finishedAt: c.finished_at,
    };
  });
  const questions = [];
  for (const s of stages) {
    s.questionIds.forEach((qid, i) => {
      const q = qById.get(qid);
      if (!q) return;
      questions.push({ id: qid, stage: s.title, number: i + 1, section: q.section, skill: q.skill, domain: q.domain, difficulty: q.difficulty, type: q.type, correct: q.correct, snippet: q.snippet, ...(stats.get(qid) || { answered: 0, right: 0, wrong: 0, choices: {} }) });
    });
  }
  res.json({ test: { id: owner.id, title: owner.title, shareCode: owner.share_code }, takers, questions });
});

app.get('/api/tests/:id/takers/:copyId', auth, (req, res) => {
  const owner = ownedTest(req, res);
  if (!owner) return;
  const copy = linkedCopies(owner.id).find((c) => c.id === Number(req.params.copyId));
  if (!copy) return res.status(404).json({ error: 'That person did not take this test' });
  const st = JSON.parse(copy.state_json);
  const stages = JSON.parse(copy.stages_json).map((s) => {
    if (s.kind !== 'module') return s;
    return { ...s, questions: questionsByIds(s.questionIds).map((q) => ({ ...q, isCorrect: st.answers[q.id] === undefined || st.answers[q.id] === null || st.answers[q.id] === '' ? (q.correct ? false : null) : grade(q, st.answers[q.id]) })) };
  });
  res.json({ id: copy.id, username: copy.username, status: copy.status, title: copy.title, finishedAt: copy.finished_at, updatedAt: copy.updated_at, result: copy.result_json ? JSON.parse(copy.result_json) : null, answers: st.answers, stages });
});

function testSummary(r) {
  const stages = JSON.parse(r.stages_json);
  const state = JSON.parse(r.state_json);
  const config = JSON.parse(r.config_json);
  const result = r.result_json ? JSON.parse(r.result_json) : null;
  const questions = stages.reduce((n, s) => n + (s.questionIds?.length || 0), 0);
  return {
    id: r.id,
    title: r.title,
    kind: r.kind,
    status: r.status,
    shareCode: r.share_code,
    takers: db.prepare('SELECT COUNT(*) AS n FROM tests WHERE (origin_test_id = ? OR source_test_id = ?) AND id != ?').get(r.id, r.id, r.id).n,
    config,
    modules: stages.filter((s) => s.kind === 'module').map((s) => s.title),
    questions,
    answered: Object.values(state.answers).filter((a) => a !== null && a !== '').length,
    stage: state.stage,
    stageCount: stages.length,
    scores: result?.scores || null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    finishedAt: r.finished_at,
  };
}

app.get('/api/tests', auth, (req, res) => {
  const rows = db.prepare('SELECT * FROM tests WHERE user_id = ? ORDER BY updated_at DESC').all(req.user.id);
  res.json(rows.map(testSummary));
});

app.get('/api/admin/version', auth, admin, (req, res) => res.json(APP_VERSION));

app.get('/api/meta', auth, (req, res) => {
  const counts = Object.fromEntries(db.prepare('SELECT section, COUNT(*) AS n FROM all_questions WHERE in_pool = 1 GROUP BY section').all().map((r) => [r.section, r.n]));
  const bankCounts = Object.fromEntries(db.prepare('SELECT section, COUNT(*) AS n FROM bank_questions GROUP BY section').all().map((r) => [r.section, r.n]));
  res.json({ full: FULL, moduleKeys: MODULE_KEYS, bank: { rw: counts.rw || 0, math: counts.math || 0 }, bankOnly: { rw: bankCounts.rw || 0, math: bankCounts.math || 0 } });
});

app.post('/api/tests/generate', auth, (req, res) => {
  try {
    const id = createGeneratedTest(req.user, req.body);
    res.json({ id });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

function wordBag(text) {
  const bag = new Map();
  // Split letters from digits too, so "x^2" and an old "x 2" compare the same.
  const norm = String(text || '').toLowerCase().replace(/\[figure\]/g, ' ').replace(/([a-z])(?=\d)|(\d)(?=[a-z])/g, '$1$2 ');
  for (const w of norm.split(/[^a-z0-9]+/)) if (w) bag.set(w, (bag.get(w) || 0) + 1);
  return bag;
}

// How much two word bags overlap, from 0 to 1 (both need enough words to compare).
function similarity(a, b) {
  let na = 0;
  let nb = 0;
  let common = 0;
  for (const n of a.values()) na += n;
  for (const n of b.values()) nb += n;
  if (na < 8 || nb < 8) return 0;
  for (const [w, n] of a) common += Math.min(n, b.get(w) || 0);
  return (2 * common) / (na + nb);
}

app.post('/api/tests/import', auth, upload.single('pdf'), wrap(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Choose a PDF file' });
  const addToDb = req.body.addToDatabase === 'true';
  let parsed;
  try {
    parsed = await parseSatPdf(req.file.buffer);
  } catch (e) {
    return res.status(400).json({ error: `Could not read this PDF: ${e.message}` });
  }
  if (!parsed.questions.length) return res.status(400).json({ error: 'No SAT questions were found in this PDF' });
  const ids = [];
  let added = 0;
  let reused = 0;
  let refreshed = 0;
  let upgraded = 0;
  const V = PDF_READER_VERSION;
  const choicesJson = (q) => JSON.stringify(q.choices.map((c) => ({ id: c.id, html: c.html })));
  const sameSource = db.prepare("SELECT id, parser_version FROM questions WHERE source = 'pdf' AND source_ref LIKE ? ESCAPE '\\' ORDER BY id LIMIT 1");
  const refresh = db.prepare('UPDATE questions SET type = ?, stimulus_html = ?, stem_html = ?, choices_json = ?, plain_text = ?, hash = ?, parser_version = ? WHERE id = ?');
  const likeEscape = (t) => t.replace(/[\\%_]/g, (c) => `\\${c}`);
  const insert = db.prepare(`INSERT INTO questions (source, source_ref, section, type, stimulus_html, stem_html, choices_json, plain_text, hash, in_pool, created_by, created_at, parser_version)
    VALUES ('pdf', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  // Questions imported with an older PDF reader, to find the same question again by its wording.
  const oldPdf = db.prepare("SELECT id, section, type, plain_text FROM questions WHERE source = 'pdf' AND COALESCE(parser_version, 1) < ?").all(V).map((r) => ({ ...r, words: wordBag(r.plain_text) }));
  const used = new Set();
  const tx = db.transaction(() => {
    for (const q of parsed.questions) {
      const hash = textHash(q.text);
      // 1. The same file was imported before: same question number.
      let target = sameSource.get(`${likeEscape(req.file.originalname)}#${q.section}${q.module}-${q.number}-%`);
      const existing = !target && hash ? db.prepare('SELECT id, in_pool, source, parser_version FROM all_questions WHERE hash = ? ORDER BY correct_json IS NULL, id LIMIT 1').get(hash) : null;
      // 2. The exact same text exists but was made by an older reader.
      if (existing && existing.source === 'pdf' && (existing.parser_version || 1) < V) target = existing;
      // 3. An old-version copy with nearly the same wording (old reading shuffled or dropped some text).
      if (!target && !existing) {
        const words = wordBag(q.text);
        let best = null;
        for (const o of oldPdf) {
          if (used.has(o.id) || o.section !== q.section || o.type !== q.type) continue;
          const score = similarity(words, o.words);
          if (score >= 0.85 && (!best || score > best.score)) best = { id: o.id, parser_version: 1, score };
        }
        if (best) target = best;
      }
      if (target && !used.has(target.id)) {
        // Replace the old version, keeping its answer, category and explanation.
        used.add(target.id);
        refresh.run(q.type, q.stimulus_html, q.stem_html, choicesJson(q), q.text, hash, V, target.id);
        if (addToDb) db.prepare('UPDATE questions SET in_pool = 1 WHERE id = ?').run(target.id);
        ids.push(target.id);
        if ((target.parser_version || 1) < V) upgraded++;
        else refreshed++;
        continue;
      }
      if (existing && (existing.in_pool || !addToDb)) {
        ids.push(existing.id);
        reused++;
        continue;
      }
      if (existing && addToDb) {
        if (existing.id < BANK_OFFSET) db.prepare('UPDATE questions SET in_pool = 1 WHERE id = ?').run(existing.id);
        ids.push(existing.id);
        added++;
        continue;
      }
      const ref = `${req.file.originalname}#${q.section}${q.module}-${q.number}-${now()}`;
      const r = insert.run(ref, q.section, q.type, q.stimulus_html, q.stem_html, choicesJson(q), q.text, hash, addToDb ? 1 : 0, req.user.id, now(), V);
      ids.push(r.lastInsertRowid);
      if (addToDb) added++;
    }
  });
  tx();
  console.log(`[pdf import] ${req.file.originalname} by ${req.user.username}: ${parsed.questions.length} found, ${upgraded} old-version questions replaced with reader v${V}, ${refreshed} re-read, ${reused} already in the database, ${added} added`);
  maybeAutoFill();
  const modules = String(req.body.modules || MODULE_KEYS.join(',')).split(',').filter(Boolean);
  try {
    const id = createPdfTest(req.user, {
      parsed,
      questionIds: ids,
      modules,
      fraction: Number(req.body.fraction ?? 1),
      showWrong: req.body.showWrong === 'true',
      timed: req.body.timed === 'true',
      title: req.body.title || req.file.originalname.replace(/\.pdf$/i, ''),
    });
    res.json({ id, found: parsed.questions.length, added, reused, refreshed, upgraded, readerVersion: V });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
}));

function testPayload(test) {
  const finished = test.status === 'finished';
  const showWrong = test.config.showWrong;
  const stages = test.stages.map((s) => {
    if (s.kind !== 'module') return s;
    const qs = questionsByIds(s.questionIds, { includeAnswer: true }).map((q) => {
      const out = { ...q };
      const checked = test.state.checked[q.id];
      if (finished || (showWrong && checked)) out.isCorrect = grade(q, test.state.answers[q.id]);
      if (!finished && !(showWrong && checked)) {
        delete out.correct;
        delete out.rationale_html;
        delete out.explanationAi;
      }
      return out;
    });
    return { ...s, questions: qs };
  });
  return { ...test, stages };
}

app.get('/api/tests/:id', auth, (req, res) => {
  const test = loadTest(req.params.id, req.user.id);
  if (!test) return res.status(404).json({ error: 'Test not found' });
  res.json(testPayload(test));
});

app.delete('/api/tests/:id', auth, (req, res) => {
  db.prepare('DELETE FROM tests WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
  res.json({ ok: true });
});

app.put('/api/tests/:id/state', auth, (req, res) => {
  const test = loadTest(req.params.id, req.user.id);
  if (!test) return res.status(404).json({ error: 'Test not found' });
  if (test.status === 'finished') return res.json({ ok: true });
  const { remaining, flagged, current } = req.body;
  const st = test.state;
  if (typeof remaining === 'number') st.remaining[st.stage] = Math.max(0, Math.min(remaining, test.stages[st.stage].time));
  if (Array.isArray(flagged)) st.flagged = flagged.map(Number);
  if (current && typeof current === 'object') st.current = { ...st.current, [st.stage]: Number(current[st.stage] ?? 0) };
  if (req.body.crossed && typeof req.body.crossed === 'object') {
    st.crossed = st.crossed || {};
    for (const [qid, letters] of Object.entries(req.body.crossed)) {
      if (Array.isArray(letters)) st.crossed[qid] = letters.filter((l) => ['A', 'B', 'C', 'D'].includes(l));
    }
  }
  saveState(test.id, st);
  res.json({ ok: true });
});

app.post('/api/tests/:id/answer', auth, (req, res) => {
  const test = loadTest(req.params.id, req.user.id);
  if (!test) return res.status(404).json({ error: 'Test not found' });
  if (test.status === 'finished') return res.status(400).json({ error: 'This test is finished' });
  const stage = test.stages[test.state.stage];
  const qid = Number(req.body.questionId);
  if (stage.kind !== 'module' || !stage.questionIds.includes(qid)) return res.status(400).json({ error: 'That question is not in the current module' });
  if (test.config.showWrong && test.state.checked[qid]) return res.status(400).json({ error: 'This answer is locked' });
  test.state.answers[qid] = req.body.answer ?? null;
  let feedback = null;
  if (test.config.showWrong && req.body.check) {
    const q = parseQuestion(db.prepare('SELECT * FROM all_questions WHERE id = ?').get(qid));
    const ok = grade(q, req.body.answer);
    if (ok !== null) test.state.checked[qid] = true;
    feedback = { correct: ok, answer: ok === null ? null : q.correct, rationale_html: ok === null ? null : q.rationale_html, explanationAi: ok === null ? false : q.explanationAi };
  }
  if (typeof req.body.remaining === 'number') test.state.remaining[test.state.stage] = req.body.remaining;
  saveState(test.id, test.state);
  res.json({ ok: true, feedback });
});

function finishTest(test) {
  test.status = 'finished';
  const result = computeResult(test);
  db.prepare("UPDATE tests SET status = 'finished', result_json = ?, state_json = ?, finished_at = ?, updated_at = ? WHERE id = ?").run(JSON.stringify(result), JSON.stringify(test.state), now(), now(), test.id);
}

app.post('/api/tests/:id/next', auth, (req, res) => {
  const test = loadTest(req.params.id, req.user.id);
  if (!test) return res.status(404).json({ error: 'Test not found' });
  if (test.status === 'finished') return res.json({ finished: true });
  if (Number(req.body.from) !== test.state.stage) return res.json({ stage: test.state.stage });
  const st = test.state;
  st.remaining[st.stage] = 0;
  st.stage++;
  if (st.stage >= test.stages.length) {
    st.stage = test.stages.length - 1;
    finishTest(test);
    return res.json({ finished: true });
  }
  st.remaining[st.stage] = test.stages[st.stage].time;
  saveState(test.id, st);
  res.json({ stage: st.stage });
});

app.post('/api/tests/:id/finish', auth, (req, res) => {
  const test = loadTest(req.params.id, req.user.id);
  if (!test) return res.status(404).json({ error: 'Test not found' });
  if (test.status !== 'finished') finishTest(test);
  res.json({ finished: true });
});

function wrongSamples(test, result) {
  const ids = result.items.filter((i) => i.correct === false).map((i) => i.questionId);
  return questionsByIds(ids).map((q) => ({ domain: q.domain, text: questionAsText(q) }));
}

app.post('/api/tests/:id/study-plan', auth, wrap(async (req, res) => {
  const test = loadTest(req.params.id, req.user.id);
  if (!test || test.status !== 'finished') return res.status(404).json({ error: 'Finished test not found' });
  if (test.studyPlan && !req.body.refresh) return res.json({ plan: test.studyPlan });
  const cfg = resolveAi(req.user);
  if (!cfg) return res.status(400).json({ error: 'Mr AI is not available for your account' });
  const plan = await studyPlan(cfg, test.result, wrongSamples(test, test.result));
  db.prepare('UPDATE tests SET study_plan = ? WHERE id = ?').run(plan, test.id);
  res.json({ plan });
}));

app.post('/api/ai/chat', auth, wrap(async (req, res) => {
  const cfg = resolveAi(req.user);
  if (!cfg) return res.status(400).json({ error: 'Mr AI is not available for your account' });
  const test = loadTest(req.body.testId, req.user.id);
  if (!test) return res.status(404).json({ error: 'Test not found' });
  const qid = Number(req.body.questionId);
  const inTest = test.stages.some((s) => s.questionIds?.includes(qid));
  if (!inTest) return res.status(400).json({ error: 'Question not in this test' });
  if (test.status !== 'finished' && !test.state.checked[qid]) return res.status(400).json({ error: 'Answer the question first' });
  const q = parseQuestion(db.prepare('SELECT * FROM all_questions WHERE id = ?').get(qid));
  const reply = await tutorChat(cfg, q, test.state.answers[qid], Array.isArray(req.body.messages) ? req.body.messages : []);
  res.json({ reply });
}));

app.get('/api/admin/users', auth, admin, (req, res) => {
  res.json(db.prepare('SELECT id, username, is_admin, hate_ai, premium, created_at, (SELECT COUNT(*) FROM tests t WHERE t.user_id = users.id) AS tests FROM users ORDER BY username').all());
});

app.post('/api/admin/users/:id/password', auth, admin, (req, res) => {
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(String(req.body.password ?? ''), 10), req.params.id);
  res.json({ ok: true });
});

app.patch('/api/admin/users/:id', auth, admin, (req, res) => {
  if (Number(req.params.id) === req.user.id && req.body.isAdmin === false) return res.status(400).json({ error: 'You cannot remove your own admin role' });
  if (req.body.isAdmin !== undefined) db.prepare('UPDATE users SET is_admin = ? WHERE id = ?').run(req.body.isAdmin ? 1 : 0, req.params.id);
  if (req.body.premium !== undefined) db.prepare('UPDATE users SET premium = ? WHERE id = ?').run(req.body.premium ? 1 : 0, req.params.id);
  res.json({ ok: true });
});

app.delete('/api/admin/users/:id', auth, admin, (req, res) => {
  if (Number(req.params.id) === req.user.id) return res.status(400).json({ error: 'You cannot delete yourself' });
  db.prepare('DELETE FROM users WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

app.get('/api/admin/ai', auth, admin, (req, res) => {
  res.json({
    key: maskKey(getSetting('openrouter_api_key', '')),
    freeModel: freeModel(),
    premiumModel: premiumModel(),
    jevModel: jevModel(),
    llmModel: getSetting('llm_model', ''),
  });
});

app.put('/api/admin/ai', auth, admin, (req, res) => {
  if (typeof req.body.key === 'string' && req.body.key.trim()) setSetting('openrouter_api_key', req.body.key.trim());
  if (req.body.clearKey) setSetting('openrouter_api_key', '');
  for (const [field, key] of [['freeModel', 'free_model'], ['premiumModel', 'premium_model'], ['jevModel', 'jev_model'], ['llmModel', 'llm_model']]) {
    if (typeof req.body[field] === 'string') setSetting(key, req.body[field].trim());
  }
  if (typeof req.body.autoFill === 'boolean') {
    setSetting('auto_fill', req.body.autoFill ? '1' : '0');
    if (req.body.autoFill) maybeAutoFill();
  }
  res.json({ ok: true });
});

app.get('/api/admin/bank', auth, admin, (req, res) => {
  const rows = db.prepare('SELECT source, section, in_pool, correct_json IS NOT NULL AS answered, COUNT(*) AS n FROM all_questions GROUP BY source, section, in_pool, answered').all();
  const missingExplanations = db.prepare("SELECT COUNT(*) AS n FROM all_questions WHERE correct_json IS NOT NULL AND (rationale_html IS NULL OR rationale_html = '')").get().n;
  const aiExplanations = db.prepare('SELECT COUNT(*) AS n FROM all_questions WHERE explanation_ai = 1').get().n;
  const missing = missingCounts();
  const oldPdf = db.prepare("SELECT COUNT(*) AS n FROM questions WHERE source = 'pdf' AND COALESCE(parser_version, 1) < ?").get(PDF_READER_VERSION).n;
  res.json({ rows, oldPdf, pdfReaderVersion: PDF_READER_VERSION, missingExplanations, aiExplanations, missingAnswers: missing.answers || 0, missingCategories: missing.categories || 0, autoFill: getSetting('auto_fill', '0') === '1', jobs: jobStatus() });
});

app.get('/api/admin/questions', auth, admin, (req, res) => {
  const page = Math.max(0, Number(req.query.page || 0));
  const size = Math.min(100, Number(req.query.size || 25));
  const where = [];
  const params = [];
  if (req.query.section) {
    where.push('section = ?');
    params.push(req.query.section);
  }
  if (req.query.source) {
    where.push('source = ?');
    params.push(req.query.source);
  }
  const missing = req.query.missing || (req.query.unanswered === 'true' ? 'answer' : '');
  if (missing === 'answer') where.push('correct_json IS NULL');
  if (missing === 'explanation') where.push("(rationale_html IS NULL OR rationale_html = '')");
  if (missing === 'category') where.push("(domain IS NULL OR domain = '' OR skill IS NULL OR skill = '')");
  if (missing === 'oldpdf') {
    where.push("source = 'pdf' AND COALESCE(parser_version, 1) < ?");
    params.push(PDF_READER_VERSION);
  }
  if (req.query.search) {
    where.push('plain_text LIKE ?');
    params.push(`%${req.query.search}%`);
  }
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = db.prepare(`SELECT COUNT(*) AS n FROM all_questions ${w}`).get(...params).n;
  const rows = db.prepare(`SELECT * FROM all_questions ${w} ORDER BY id DESC LIMIT ? OFFSET ?`).all(...params, size, page * size);
  res.json({ total, items: rows.map((r) => ({ ...parseQuestion(r), in_pool: !!r.in_pool })) });
});

app.put('/api/admin/questions/:id', auth, admin, (req, res) => {
  const { correct, domain, skill, difficulty, inPool } = req.body;
  const table = qTable(req.params.id);
  if (correct !== undefined) {
    const list = Array.isArray(correct) ? correct : String(correct).split(',').map((s) => s.trim()).filter(Boolean);
    db.prepare(`UPDATE ${table} SET correct_json = ?, answer_source = 'manual' WHERE id = ?`).run(list.length ? JSON.stringify(list) : null, req.params.id);
  }
  if (domain !== undefined) db.prepare(`UPDATE ${table} SET domain = ? WHERE id = ?`).run(domain || null, req.params.id);
  if (skill !== undefined) db.prepare(`UPDATE ${table} SET skill = ? WHERE id = ?`).run(skill || null, req.params.id);
  if (difficulty !== undefined) db.prepare(`UPDATE ${table} SET difficulty = ? WHERE id = ?`).run(difficulty || null, req.params.id);
  if (inPool !== undefined) db.prepare(`UPDATE ${table} SET in_pool = ? WHERE id = ?`).run(inPool ? 1 : 0, req.params.id);
  res.json({ ok: true });
});

app.post('/api/admin/questions/:id/explain', auth, admin, wrap(async (req, res) => {
  try {
    const q = await explainOne(Number(req.params.id));
    res.json({ ...q, in_pool: !!db.prepare('SELECT in_pool FROM all_questions WHERE id = ?').get(q.id).in_pool });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
}));

app.post('/api/admin/jobs/collegeboard', auth, admin, (req, res) => {
  try {
    res.json(startCollegeBoardFetch());
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post('/api/admin/jobs/explanations', auth, admin, (req, res) => {
  try {
    res.json(startExplanationGeneration());
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post('/api/admin/jobs/:name/stop', auth, admin, (req, res) => {
  try {
    res.json(stopJob(req.params.name));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post('/api/admin/jobs/answers', auth, admin, (req, res) => {
  try {
    res.json(startAnswerGeneration());
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

const clientDist = path.join(here, '..', '..', 'client', 'dist');
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get(/^(?!\/api|\/images).*/, (req, res) => res.sendFile(path.join(clientDist, 'index.html')));
}

app.use((err, req, res, next) => {
  const status = err.status || 500;
  res.status(status).json({ error: err.message || 'Something went wrong' });
});

app.listen(PORT, () => {
  console.log(`Luca's SAT running on http://localhost:${PORT}`);
});
