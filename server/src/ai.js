import fs from 'fs';
import path from 'path';
import { IMAGE_DIR } from './pdf.js';
import { chat, openRouterKey, freeModel, premiumModel } from './openrouter.js';

export function maskKey(key) {
  if (!key) return '';
  return key.length <= 12 ? '****' : `${key.slice(0, 7)}...${key.slice(-4)}`;
}

// Everyone uses the one OpenRouter key; the admin picks who gets the premium model.
export function resolveAi(user) {
  if (user.hate_ai) return null;
  const apiKey = openRouterKey();
  if (!apiKey) return null;
  return user.premium ? { apiKey, model: premiumModel(), via: 'premium' } : { apiKey, model: freeModel(), via: 'free' };
}

export function aiStatus(user) {
  if (user.hate_ai) return { enabled: false, reason: 'hate_ai' };
  const r = resolveAi(user);
  if (!r) return { enabled: false, reason: 'no_key' };
  // Users only learn whether Mr AI is on, not which model or tier they get.
  return { enabled: true };
}

async function ask(cfg, { system, messages, maxTokens = 4000, schema, think = true }) {
  const { text } = await chat({ apiKey: cfg.apiKey, model: cfg.model, system, messages, maxTokens, schema, think });
  return text;
}

export function htmlToText(html) {
  return String(html || '')
    .replace(/<math[^>]*alttext="([^"]*)"[^>]*>[\s\S]*?<\/math>/gi, ' $1 ')
    .replace(/<img[^>]*alt="([^"]*)"[^>]*>/gi, ' [image: $1] ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&rsquo;|&lsquo;/g, "'")
    .replace(/&rdquo;|&ldquo;/g, '"')
    .replace(/&mdash;/g, '-')
    .replace(/&ndash;/g, '-')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim();
}

export function imageBlocks(q) {
  const html = [q.stimulus_html, q.stem_html, ...(q.choices || []).map((c) => c.html)].join(' ');
  const blocks = [];
  const re = /<img[^>]*src="([^"]+)"/gi;
  let m;
  while ((m = re.exec(html)) && blocks.length < 8) {
    const src = m[1];
    if (src.startsWith('/images/')) {
      const file = path.join(IMAGE_DIR, path.basename(src));
      if (fs.existsSync(file)) blocks.push({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: fs.readFileSync(file).toString('base64') } });
    } else {
      const d = /^data:(image\/(png|jpeg|gif|webp));base64,(.+)$/i.exec(src);
      if (d) blocks.push({ type: 'image', source: { type: 'base64', media_type: d[1].toLowerCase(), data: d[3] } });
    }
  }
  return blocks;
}

export function questionAsText(q) {
  const parts = [];
  parts.push(`Section: ${q.section === 'rw' ? 'Reading and Writing' : 'Math'}`);
  if (q.domain) parts.push(`Category: ${q.domain}${q.skill ? ' / ' + q.skill : ''}`);
  if (q.stimulus_html) parts.push(`Passage:\n${htmlToText(q.stimulus_html)}`);
  parts.push(`Question:\n${htmlToText(q.stem_html)}`);
  if (q.type === 'mcq') parts.push('Choices:\n' + q.choices.map((c) => `${c.id}) ${htmlToText(c.html) || '[shown in image]'}`).join('\n'));
  else parts.push('This is a student-produced response question (the student types the answer).');
  return parts.join('\n\n');
}

const TUTOR_SYSTEM = `Your name is Mr AI. You are a friendly SAT tutor helping a student understand a question they got wrong.
Explain in plain, easy words, like talking to a friend. Use short sentences and short paragraphs.
Walk through the reasoning step by step, and point out why the student's answer was tempting but wrong.
You can use **bold** for key words and "-" bullet lists. Do not use headings or tables. Keep math simple and write it inline. If images are attached, they are part of the question.`;

export async function tutorChat(cfg, q, userAnswer, history) {
  const intro = [
    ...imageBlocks(q),
    {
      type: 'text',
      text: `${questionAsText(q)}\n\nCorrect answer: ${q.correct ? q.correct.join(' or ') : 'unknown'}\nStudent's answer: ${userAnswer ?? '(no answer)'}${q.rationale_html ? `\n\nOfficial explanation (for your reference):\n${htmlToText(q.rationale_html)}` : ''}\n\nPlease explain this question to me.`,
    },
  ];
  const messages = [{ role: 'user', content: intro }];
  for (const m of history.slice(-20)) {
    if (m.role !== 'user' && m.role !== 'assistant') continue;
    const text = String(m.content || '').slice(0, 4000);
    if (!text) continue;
    const last = messages[messages.length - 1];
    if (last.role === m.role) {
      if (Array.isArray(last.content)) last.content.push({ type: 'text', text });
      else last.content += '\n\n' + text;
    } else messages.push({ role: m.role, content: text });
  }
  if (messages[messages.length - 1].role !== 'user') messages.push({ role: 'user', content: 'Can you explain more?' });
  return ask(cfg, { system: TUTOR_SYSTEM, messages, maxTokens: 3000, think: false });
}

export async function studyPlan(cfg, result, wrongSamples) {
  const cats = result.categories.map((c) => `${c.section === 'rw' ? 'Reading and Writing' : 'Math'} - ${c.domain} / ${c.skill}: ${c.correct}/${c.total} correct`).join('\n');
  const samples = wrongSamples.slice(0, 12).map((s, i) => `Missed question ${i + 1} (${s.domain || 'uncategorized'}):\n${s.text.slice(0, 900)}`).join('\n\n');
  const text = `A student just finished a practice SAT.\nScores: Reading and Writing ${result.scores.rw ?? 'not taken'}, Math ${result.scores.math ?? 'not taken'}.\n\nResults by category (weakest first):\n${cats || 'No categorized results.'}\n\n${samples}\n\nWrite a short, encouraging study plan in easy words. List the 3 to 5 topics they should learn first, what exactly to practice for each, and one quick tip per topic. Use simple bullet points with "-". No headings.`;
  return ask(cfg, { system: 'Your name is Mr AI. You are a helpful, encouraging SAT coach.', messages: [{ role: 'user', content: text }], maxTokens: 3000, think: false });
}

const ANSWER_SCHEMA = {
  type: 'object',
  properties: {
    answer: { type: 'string', description: 'For multiple choice: a single letter A, B, C or D. For student-produced response: the numeric answer, e.g. 12, 3/4 or -2.5' },
    domain: { type: 'string' },
    skill: { type: 'string' },
    difficulty: { type: 'string', enum: ['E', 'M', 'H'] },
    explanation: { type: 'string' },
  },
  required: ['answer', 'domain', 'skill', 'difficulty', 'explanation'],
  additionalProperties: false,
};

const DOMAINS_TEXT = `Reading and Writing domains: Information and Ideas, Craft and Structure, Expression of Ideas, Standard English Conventions.
Math domains: Algebra, Advanced Math, Problem-Solving and Data Analysis, Geometry and Trigonometry.`;

export async function explainQuestion(cfg, q) {
  const content = [
    ...imageBlocks(q),
    {
      type: 'text',
      text: `${questionAsText(q)}\n\nCorrect answer: ${q.correct.join(' or ')}\n\nWrite the explanation a student sees after answering. Say why the correct answer is right${q.type === 'mcq' ? ' and briefly why each other choice is wrong' : ' and show the steps'}. Use easy words and short paragraphs. Plain text only, no markdown, no headings.`,
    },
  ];
  return ask(cfg, { system: 'Your name is Mr AI. You write clear, friendly SAT answer explanations.', messages: [{ role: 'user', content }], maxTokens: 3000 });
}

export async function solveQuestion(cfg, q) {
  const content = [
    ...imageBlocks(q),
    { type: 'text', text: `${questionAsText(q)}\n\nSolve this SAT question carefully. Then classify it.\n${DOMAINS_TEXT}\nUse exactly one of the domain names for its section and a short official-style skill name. Give a short explanation in easy words.` },
  ];
  const raw = await ask(cfg, { system: 'You are an expert SAT tutor who solves questions accurately.', messages: [{ role: 'user', content }], maxTokens: 6000, schema: ANSWER_SCHEMA });
  const json = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1));
  let answer = String(json.answer || '').trim();
  if (q.type === 'mcq') {
    const m = /[ABCD]/i.exec(answer);
    if (!m) throw new Error('Unparseable answer');
    answer = m[0].toUpperCase();
  }
  return { ...json, answer };
}
