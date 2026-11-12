import { getSetting } from './db.js';

const BASE = 'https://openrouter.ai/api';
export const FREE_DEFAULT_MODEL = 'nvidia/nemotron-3-ultra-550b-a55b:free';
export const PREMIUM_DEFAULT_MODEL = 'openai/gpt-6.1-terra';
export const JEV_DEFAULT_MODEL = 'typesafe/jev-1.14';

export function openRouterKey() {
  return getSetting('openrouter_api_key', '');
}

export function freeModel() {
  return getSetting('free_model', '') || FREE_DEFAULT_MODEL;
}

export function premiumModel() {
  return getSetting('premium_model', '') || PREMIUM_DEFAULT_MODEL;
}

export function jevModel() {
  return getSetting('jev_model', '') || JEV_DEFAULT_MODEL;
}

// What each model can take (images, JSON schema), from OpenRouter's public model list.
let modelCache = { at: 0, map: null };

async function modelInfo(model) {
  if (!modelCache.map || Date.now() - modelCache.at > 60 * 60 * 1000) {
    try {
      const res = await fetch(`${BASE}/v1/models`, { signal: AbortSignal.timeout(15000) });
      const data = await res.json();
      modelCache = { at: Date.now(), map: Object.fromEntries(data.data.map((m) => [m.id, m])) };
    } catch {
      if (!modelCache.map) return null;
    }
  }
  const m = modelCache.map[model];
  if (!m) return null;
  const params = m.supported_parameters || [];
  return {
    vision: (m.architecture?.input_modalities || []).includes('image'),
    schema: params.includes('response_format') || params.includes('structured_outputs'),
    reasoning: params.includes('reasoning'),
  };
}

// Anthropic-style image blocks ({type:'image', source:{...}}) to OpenAI-style image parts.
export function imagePart(b) {
  return { type: 'image_url', image_url: { url: `data:${b.source.media_type};base64,${b.source.data}` } };
}

function toParts(content, vision) {
  if (!Array.isArray(content)) return content;
  const parts = [];
  let dropped = 0;
  for (const b of content) {
    if (b.type === 'image') {
      if (vision) parts.push(imagePart(b));
      else dropped++;
    } else parts.push(b);
  }
  if (dropped) parts.push({ type: 'text', text: `(${dropped} picture${dropped > 1 ? 's are' : ' is'} part of this question but could not be shown to you. Use the image descriptions in the text.)` });
  return parts;
}

async function post(path, apiKey, body, timeoutMs) {
  let res;
  try {
    res = await fetch(`${BASE}${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'X-Title': 'SAT Practice' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    throw new Error('Could not reach OpenRouter. Check the internet connection.');
  }
  const text = await res.text();
  let data = null;
  try {
    data = JSON.parse(text);
  } catch {}
  const errMsg = data?.error?.message || text.slice(0, 200);
  if (res.status === 401) throw new Error('The OpenRouter key is not valid. An admin can change it.');
  if (res.status === 402) throw new Error('The OpenRouter account is out of credits.');
  if (res.status === 403) throw new Error(`OpenRouter refused the request: ${errMsg}`);
  if (res.status === 404) throw new Error(`The model ${body.model} was not found on OpenRouter. An admin can change it.`);
  if (res.status === 429) throw new Error('Mr AI is busy right now. Try again in a minute.');
  if (!res.ok || !data) throw new Error(`OpenRouter returned ${res.status}: ${errMsg}`);
  if (data.error) throw new Error(`OpenRouter error: ${data.error.message || 'unknown'}`);
  return data;
}

// think: false asks the model to answer straight away, without a reasoning step first.
export async function chat({ apiKey, model, system, messages, maxTokens = 4000, schema, schemaName = 'result', timeoutMs = 180000, think = true }) {
  const info = (await modelInfo(model)) || { vision: true, schema: true, reasoning: true };
  let sys = system || '';
  const body = { model, max_tokens: maxTokens };
  if (info.reasoning) body.reasoning = { enabled: !!think };
  if (schema) {
    if (info.schema) body.response_format = { type: 'json_schema', json_schema: { name: schemaName, strict: true, schema } };
    else sys += `\n\nReply with only one JSON object, no other text, matching this JSON schema:\n${JSON.stringify(schema)}`;
  }
  body.messages = [...(sys ? [{ role: 'system', content: sys }] : []), ...messages.map((m) => ({ role: m.role, content: toParts(m.content, info.vision) }))];
  let data;
  try {
    data = await post('/v1/chat/completions', apiKey, body, timeoutMs);
  } catch (e) {
    // Some models always reason and reject turning it off; ask again with their default.
    if (think || !body.reasoning || !/reason/i.test(e.message)) throw e;
    delete body.reasoning;
    data = await post('/v1/chat/completions', apiKey, body, timeoutMs);
  }
  const choice = data.choices?.[0];
  if (!choice) throw new Error('OpenRouter returned no answer.');
  if (choice.finish_reason === 'content_filter' || choice.native_finish_reason === 'refusal') throw new Error('Mr AI declined to answer this request.');
  const content = choice.message?.content;
  const out = Array.isArray(content) ? content.filter((p) => p.type === 'text').map((p) => p.text).join('\n') : String(content || '');
  if (!out.trim()) throw new Error('Mr AI gave an empty answer. Try again.');
  return { text: out.trim(), model: data.model || model };
}

// OpenRouter decisions API (used by JEV).
export async function decide({ apiKey, model, state, questions, timeoutMs = 90000 }) {
  return post('/alpha/decisions', apiKey, { model, state, questions }, timeoutMs);
}
