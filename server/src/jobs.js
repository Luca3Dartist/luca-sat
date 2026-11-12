import { db, now, parseQuestion, getSetting, qTable } from './db.js';
import { jevConfig, solveWithJev, needsVision } from './jev.js';
import { solveQuestion, explainQuestion, htmlToText } from './ai.js';
import { openRouterKey, premiumModel } from './openrouter.js';
import { textHash } from './tests.js';

const CB_BASE = 'https://qbank-api.collegeboard.org/msreportingquestionbank-prod/questionbank/digital';
const jobs = {};

export function jobStatus() {
  return jobs;
}

export function stopJob(name) {
  const job = jobs[name];
  if (!job?.running) throw new Error('That job is not running');
  job.stop = true;
  job.message = 'Stopping after the current questions finish';
  return job;
}

function startJob(name, fn) {
  if (jobs[name]?.running) throw new Error('This job is already running');
  const job = { name, running: true, done: 0, total: 0, added: 0, failed: 0, message: 'Starting', startedAt: now(), finishedAt: null, error: null };
  jobs[name] = job;
  fn(job)
    .then(() => {
      if (job.stop) job.message = `Stopped after ${job.done} of ${job.total}`;
      else if (['Downloading questions', 'Solving questions', 'Writing explanations'].includes(job.message)) job.message = 'Finished';
    })
    .catch((e) => {
      job.error = e.message;
      job.message = 'Failed';
    })
    .finally(() => {
      job.running = false;
      job.finishedAt = now();
    });
  return job;
}

async function postJson(url, body) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(30000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (e) {
      if (attempt === 2) throw e;
      await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
    }
  }
}

async function getJson(url) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (e) {
      if (attempt === 2) throw e;
      await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
    }
  }
}

async function pool(items, size, worker, job) {
  let i = 0;
  const runners = Array.from({ length: size }, async () => {
    while (i < items.length && !job?.stop) {
      const item = items[i++];
      await worker(item);
    }
  });
  await Promise.all(runners);
}

function fromCbDetail(meta, d) {
  const section = meta.section;
  if (d.type === 'mcq') {
    const opts = d.answerOptions || [];
    const choices = opts.map((o, i) => ({ id: 'ABCD'[i], html: o.content }));
    let correct = Array.isArray(d.correct_answer) ? d.correct_answer.map((x) => String(x).toUpperCase()) : null;
    if ((!correct || !correct.length) && Array.isArray(d.keys)) correct = d.keys.map((k) => 'ABCD'[opts.findIndex((o) => o.id === k)]).filter(Boolean);
    return { section, type: 'mcq', stimulus_html: d.stimulus || '', stem_html: d.stem || '', choices, correct: correct?.length ? correct : null, rationale_html: d.rationale || '' };
  }
  const keys = (Array.isArray(d.keys) && d.keys.length ? d.keys : d.correct_answer) || [];
  return { section, type: 'spr', stimulus_html: d.stimulus || '', stem_html: d.stem || '', choices: [], correct: keys.length ? keys.map(String) : null, rationale_html: d.rationale || '' };
}

function fromIbn(meta, r) {
  const ans = r.answer || {};
  const stimulus = r.body || '';
  if (ans.style === 'Multiple Choice' && ans.choices) {
    const letters = Object.keys(ans.choices).sort();
    const choices = letters.map((l, i) => ({ id: 'ABCD'[i], html: ans.choices[l].body }));
    const idx = letters.indexOf(String(ans.correct_choice || '').toLowerCase());
    return { section: meta.section, type: 'mcq', stimulus_html: stimulus, stem_html: r.prompt || '', choices, correct: idx >= 0 ? ['ABCD'[idx]] : null, rationale_html: ans.rationale || '' };
  }
  const text = htmlToText(ans.rationale || '');
  const m = /correct answer is\s*([-−]?\d*\.?\d+(?:\s*\/\s*\d+)?)/i.exec(text);
  const correct = m ? [m[1].replace(/\s+/g, '').replace('−', '-')] : null;
  return { section: meta.section, type: 'spr', stimulus_html: stimulus, stem_html: r.prompt || '', choices: [], correct, rationale_html: ans.rationale || '' };
}

const insertCb = () =>
  db.prepare(`INSERT OR IGNORE INTO bank_questions (source, source_ref, section, domain, skill, difficulty, type, stimulus_html, stem_html, choices_json, correct_json, rationale_html, plain_text, hash, in_pool, answer_source, created_at)
  VALUES ('collegeboard', @ref, @section, @domain, @skill, @difficulty, @type, @stimulus_html, @stem_html, @choices_json, @correct_json, @rationale_html, @plain_text, @hash, 1, @answer_source, @created_at)`);

export function startCollegeBoardFetch() {
  return startJob('collegeboard', async (job) => {
    job.message = 'Downloading question lists';
    const lists = [];
    for (const [test, domain, section] of [[1, 'INI,CAS,EOI,SEC', 'rw'], [2, 'H,P,Q,S', 'math']]) {
      const list = await postJson(`${CB_BASE}/get-questions`, { asmtEventId: 99, test, domain });
      for (const item of list) lists.push({ ...item, section });
    }
    const existing = new Set(db.prepare("SELECT source_ref FROM bank_questions WHERE source = 'collegeboard'").all().map((r) => r.source_ref));
    const todo = lists.filter((x) => !existing.has(x.questionId));
    job.total = todo.length;
    job.message = todo.length ? 'Downloading questions' : 'Database is already up to date';
    const stmt = insertCb();
    const existingHashes = new Set(db.prepare('SELECT hash FROM all_questions WHERE hash IS NOT NULL').all().map((r) => r.hash));
    await pool(todo, 6, async (meta) => {
      try {
        let q;
        if (meta.external_id) q = fromCbDetail(meta, await postJson(`${CB_BASE}/get-question`, { external_id: meta.external_id }));
        else if (meta.ibn) {
          const arr = await getJson(`https://saic.collegeboard.org/disclosed/${meta.ibn}.json`);
          q = fromIbn(meta, Array.isArray(arr) ? arr[0] : arr);
        } else throw new Error('No identifier');
        const plain = htmlToText([q.stimulus_html, q.stem_html, ...q.choices.map((c) => c.html)].join('\n'));
        const hash = textHash(plain);
        const res = stmt.run({
          ref: meta.questionId,
          section: q.section,
          domain: meta.primary_class_cd_desc || null,
          skill: meta.skill_desc || null,
          difficulty: meta.difficulty || null,
          type: q.type,
          stimulus_html: q.stimulus_html,
          stem_html: q.stem_html,
          choices_json: JSON.stringify(q.choices),
          correct_json: q.correct ? JSON.stringify(q.correct) : null,
          rationale_html: q.rationale_html,
          plain_text: plain,
          hash,
          answer_source: q.correct ? 'collegeboard' : null,
          created_at: now(),
        });
        if (res.changes) job.added++;
        if (hash) {
          if (existingHashes.has(hash) && q.correct) {
            db.prepare("UPDATE questions SET correct_json = ?, rationale_html = COALESCE(NULLIF(rationale_html, ''), ?), domain = COALESCE(domain, ?), skill = COALESCE(skill, ?), answer_source = 'collegeboard' WHERE hash = ? AND source = 'pdf'").run(JSON.stringify(q.correct), q.rationale_html, meta.primary_class_cd_desc || null, meta.skill_desc || null, hash);
          }
          existingHashes.add(hash);
        }
      } catch (e) {
        job.failed++;
      }
      job.done++;
    }, job);
    if (!job.stop) setTimeout(maybeAutoFill, 500);
  });
}

export function llmConfig() {
  const key = openRouterKey();
  if (!key) return null;
  return { apiKey: key, model: getSetting('llm_model', '') || premiumModel() };
}

const JEV_MIN_CONFIDENCE = 0.4;

function escapeHtml(t) {
  return String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/\n+/g, '</p><p>');
}

const MISSING_SQL = "correct_json IS NULL OR domain IS NULL OR domain = '' OR skill IS NULL OR skill = ''";
let autoFillPending = false;

export function missingCounts() {
  return db.prepare(`SELECT SUM(correct_json IS NULL) AS answers, SUM(domain IS NULL OR domain = '' OR skill IS NULL OR skill = '') AS categories FROM all_questions`).get();
}

export function maybeAutoFill() {
  if (getSetting('auto_fill', '0') !== '1') return false;
  if (!jevConfig() && !llmConfig()) return false;
  if (jobs.answers?.running) {
    autoFillPending = true;
    return true;
  }
  if (!db.prepare(`SELECT 1 FROM all_questions WHERE ${MISSING_SQL} LIMIT 1`).get()) return false;
  try {
    startAnswerGeneration({ auto: true });
    return true;
  } catch {
    return false;
  }
}

export function startAnswerGeneration({ auto = false } = {}) {
  const jev = jevConfig();
  const llm = llmConfig();
  if (!jev && !llm) throw new Error('Set the OpenRouter key in Admin, Mr AI first');
  const job = startJob('answers', async (job) => {
    const rows = db.prepare(`SELECT * FROM all_questions WHERE ${MISSING_SQL}`).all();
    job.total = rows.length;
    job.auto = auto;
    job.jev = 0;
    job.llm = 0;
    job.categorized = 0;
    job.skipped = 0;
    job.message = rows.length ? 'Solving questions' : 'Every question already has an answer and a category';
    await pool(rows, 3, async (row) => {
      try {
        const q = { ...parseQuestion(row), plain_text: row.plain_text };
        const table = qTable(row.id);
        const needAnswer = !row.correct_json;
        const needCategory = !row.domain || !row.skill;
        const jevAnswers = needAnswer && q.type === 'mcq' && !(llm && needsVision(q));
        let answered = false;
        let categorized = false;
        if (jev && (needCategory || jevAnswers)) {
          const r = await solveWithJev(jev, q, { answer: jevAnswers, category: needCategory });
          if (needCategory && (r.domain || r.skill)) {
            db.prepare(`UPDATE ${table} SET domain = CASE WHEN domain IS NULL OR domain = '' THEN ? ELSE domain END, skill = CASE WHEN skill IS NULL OR skill = '' THEN ? ELSE skill END, difficulty = COALESCE(difficulty, ?) WHERE id = ?`).run(r.domain || null, r.skill || null, r.difficulty || null, row.id);
            job.categorized++;
            categorized = true;
          }
          if (jevAnswers && r.answer && (r.confidence === null || r.confidence >= JEV_MIN_CONFIDENCE || !llm)) {
            db.prepare(`UPDATE ${table} SET correct_json = ?, answer_source = 'jev' WHERE id = ?`).run(JSON.stringify([r.answer]), row.id);
            job.jev++;
            answered = true;
          }
        }
        if (llm && ((needAnswer && !answered) || (needCategory && !categorized))) {
          const r = await solveQuestion(llm, q);
          if (needAnswer && !answered) {
            db.prepare(`UPDATE ${table} SET correct_json = ?, answer_source = 'llm', explanation_ai = CASE WHEN rationale_html IS NULL OR rationale_html = '' THEN 1 ELSE explanation_ai END, rationale_html = CASE WHEN rationale_html IS NULL OR rationale_html = '' THEN ? ELSE rationale_html END WHERE id = ?`).run(JSON.stringify([r.answer]), `<p>${escapeHtml(r.explanation)}</p>`, row.id);
            job.llm++;
            answered = true;
          }
          if (needCategory && !categorized) {
            db.prepare(`UPDATE ${table} SET domain = CASE WHEN domain IS NULL OR domain = '' THEN ? ELSE domain END, skill = CASE WHEN skill IS NULL OR skill = '' THEN ? ELSE skill END, difficulty = COALESCE(difficulty, ?) WHERE id = ?`).run(r.domain || null, r.skill || null, r.difficulty || null, row.id);
            job.categorized++;
            categorized = true;
          }
        }
        if (answered || categorized) job.added++;
        if (needAnswer && !answered) job.skipped++;
      } catch (e) {
        job.failed++;
        job.lastError = e.message;
      }
      job.done++;
    }, job);
    if (!job.stop) job.message = `Finished: ${job.jev} answers by JEV, ${job.llm} by the LLM, ${job.categorized} categorized${job.skipped ? `, ${job.skipped} typed-answer questions skipped because no OpenRouter key is set` : ''}`;
  });
  const watch = setInterval(() => {
    if (job.running) return;
    clearInterval(watch);
    if (autoFillPending) {
      autoFillPending = false;
      setTimeout(maybeAutoFill, 1000);
    }
  }, 1000);
  return job;
}

export function startExplanationGeneration() {
  const llm = llmConfig();
  if (!llm) throw new Error('Set the OpenRouter key in Admin, Mr AI first');
  return startJob('explanations', async (job) => {
    const rows = db.prepare("SELECT * FROM all_questions WHERE correct_json IS NOT NULL AND (rationale_html IS NULL OR rationale_html = '')").all();
    job.total = rows.length;
    job.message = rows.length ? 'Writing explanations' : 'Every answered question already has an explanation';
    await pool(rows, 3, async (row) => {
      try {
        const text = await explainQuestion(llm, parseQuestion(row));
        db.prepare(`UPDATE ${qTable(row.id)} SET rationale_html = ?, explanation_ai = 1 WHERE id = ? AND (rationale_html IS NULL OR rationale_html = '')`).run(`<p>${escapeHtml(text)}</p>`, row.id);
        job.added++;
      } catch (e) {
        job.failed++;
        job.lastError = e.message;
      }
      job.done++;
    }, job);
  });
}

// Writes (or rewrites) the Mr AI explanation for one question.
export async function explainOne(id) {
  const llm = llmConfig();
  if (!llm) throw new Error('Set the OpenRouter key in Admin, Mr AI first');
  const row = db.prepare('SELECT * FROM all_questions WHERE id = ?').get(id);
  if (!row) throw new Error('Question not found');
  if (!row.correct_json) throw new Error('Give this question an answer first');
  const text = await explainQuestion(llm, parseQuestion(row));
  db.prepare(`UPDATE ${qTable(row.id)} SET rationale_html = ?, explanation_ai = 1 WHERE id = ?`).run(`<p>${escapeHtml(text)}</p>`, row.id);
  return parseQuestion(db.prepare('SELECT * FROM all_questions WHERE id = ?').get(id));
}

export function hasDefaultKey() {
  return !!openRouterKey();
}
