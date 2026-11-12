import { db, getSetting } from './db.js';
import { htmlToText } from './ai.js';

export const JEV_DEFAULT_URL = 'https://api.aimlapi.com/v1/decisions';
export const JEV_DEFAULT_MODEL = 'typesafe/jev';

const DOMAINS = {
  rw: ['Information and Ideas', 'Craft and Structure', 'Expression of Ideas', 'Standard English Conventions'],
  math: ['Algebra', 'Advanced Math', 'Problem-Solving and Data Analysis', 'Geometry and Trigonometry'],
};

export function jevConfig() {
  const key = getSetting('jev_api_key', '');
  if (!key) return null;
  return { url: getSetting('jev_url', '') || JEV_DEFAULT_URL, key, model: getSetting('jev_model', '') || JEV_DEFAULT_MODEL };
}

function choiceText(q, id) {
  const c = q.choices.find((x) => x.id === id);
  const t = c ? htmlToText(c.html).replace(/\[image:[^\]]*\]/g, '').trim() : '';
  if (t) return t.slice(0, 500);
  const m = new RegExp(`^${id}\\)\\s*(.+)$`, 'm').exec(q.plain_text || '');
  return m && !m[1].includes('[figure]') ? m[1].slice(0, 500) : null;
}

export function needsVision(q) {
  const imgOnly = (html) => /<img/i.test(html || '') && !htmlToText(html).replace(/\[image:[^\]]*\]/g, '').trim();
  if (q.choices.some((c) => imgOnly(c.html))) return true;
  return /class="(fig|mathimg)"/.test(q.stem_html || '') || /<img/i.test(q.stimulus_html || '');
}

let taxonomyCache = { at: 0, map: {} };

export function taxonomy(section) {
  if (Date.now() - taxonomyCache.at > 10 * 60 * 1000) {
    const map = { rw: {}, math: {} };
    for (const r of db.prepare("SELECT section, domain, skill FROM bank_questions WHERE domain IS NOT NULL AND domain != '' AND skill IS NOT NULL AND skill != '' GROUP BY section, domain, skill").all()) {
      if (map[r.section]) map[r.section][r.skill] = r.domain;
    }
    taxonomyCache = { at: Date.now(), map };
  }
  return taxonomyCache.map[section] || {};
}

export async function solveWithJev(cfg, q, { answer = true, category = true } = {}) {
  const passage = htmlToText(q.stimulus_html);
  const stemText = htmlToText(q.stem_html).replace(/\[image:[^\]]*\]/g, '').trim();
  const stem = stemText.length > 20 ? stemText : (q.plain_text || '').split(/\nA\)/)[0].replace(/\[figure\]/g, '').trim();
  const state = {
    section: q.section === 'rw' ? 'SAT Reading and Writing' : 'SAT Math',
    passage: passage || undefined,
    question: stem,
    choices: q.choices.length ? Object.fromEntries(q.choices.map((c) => [c.id, choiceText(q, c.id) || '(shown as an image)'])) : undefined,
  };
  const questions = {};
  if (answer && q.type === 'mcq') {
    questions.answer = {
      type: 'choice',
      instructions: 'Solve this SAT question. Which answer choice is correct?',
      criteria: Object.fromEntries(q.choices.map((c) => [c.id, choiceText(q, c.id)])),
    };
  }
  const skills = taxonomy(q.section);
  if (category) {
    if (Object.keys(skills).length) {
      questions.skill = {
        type: 'choice',
        instructions: 'Which official SAT skill does this question test?',
        criteria: Object.fromEntries(Object.entries(skills).map(([skill, domain]) => [skill, `Domain: ${domain}`])),
      };
    } else {
      questions.domain = {
        type: 'choice',
        instructions: 'Which SAT content domain does this question test?',
        criteria: Object.fromEntries(DOMAINS[q.section].map((d) => [d, null])),
      };
    }
    questions.difficulty = {
      type: 'score',
      instructions: 'How hard is this question for a typical SAT student?',
      criteria: ['Easy', 'Medium', 'Hard'],
    };
  }
  if (!Object.keys(questions).length) return {};
  const res = await fetch(cfg.url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${cfg.key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: cfg.model, state, questions }),
    signal: AbortSignal.timeout(60000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`JEV returned ${res.status}: ${text.slice(0, 200)}`);
  const data = JSON.parse(text);
  const answers = data.answers || {};
  const out = { model: data.model || cfg.model };
  if (questions.answer) {
    const choice = answers.answer?.choice;
    if (choice && q.choices.some((c) => c.id === choice)) {
      out.answer = choice;
      out.confidence = answers.answer.confidence ?? null;
    }
  }
  if (category) {
    const skill = answers.skill?.choice;
    if (skill && skills[skill]) {
      out.skill = skill;
      out.domain = skills[skill];
    } else if (answers.domain?.choice && DOMAINS[q.section].includes(answers.domain.choice)) {
      out.domain = answers.domain.choice;
    }
    const level = typeof answers.difficulty?.score === 'number' ? Math.round(answers.difficulty.score) : null;
    out.difficulty = level === null ? null : ['E', 'M', 'H'][Math.max(0, Math.min(2, level))];
  }
  return out;
}
