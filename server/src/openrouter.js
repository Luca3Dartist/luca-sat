import { getSetting } from './db.js';

export const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
export const DEFAULT_MODEL = 'anthropic/claude-opus-5.5';
export const JEV_DEFAULT_MODEL = 'typesafe/jev-router';

export function openRouterKey() {
  return getSetting('openrouter_api_key', '');
}

// Old Anthropic-style ids like claude-opus-5-5 become anthropic/claude-opus-5.5.
export function toOpenRouterModel(model) {
  const m = String(model || '').trim();
  if (!m || m.includes('/')) return m;
  if (/^claude-/.test(m)) return `anthropic/${m.replace(/-(\d+)-(\d+)$/, '-$1.$2')}`;
  return m;
}

// Converts Anthropic-style content blocks ({type:'image', source:{...}}) to OpenAI-style parts.
function toParts(content) {
  if (!Array.isArray(content)) return content;
  return content.map((b) => {
    if (b.type === 'image' && b.source?.type === 'base64') return { type: 'image_url', image_url: { url: `data:${b.source.media_type};base64,${b.source.data}` } };
    if (b.type === 'text') return { type: 'text', text: b.text };
    return b;
  });
}

export async function chat({ apiKey, model, system, messages, maxTokens = 4000, effort, schema, schemaName = 'result', timeoutMs = 180000 }) {
  const body = {
    model,
    max_tokens: maxTokens,
    messages: [...(system ? [{ role: 'system', content: system }] : []), ...messages.map((m) => ({ role: m.role, content: toParts(m.content) }))],
  };
  if (effort) body.reasoning = { effort };
  if (schema) body.response_format = { type: 'json_schema', json_schema: { name: schemaName, strict: true, schema } };
  let res;
  try {
    res = await fetch(OPENROUTER_URL, {
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
  if (res.status === 401) throw new Error('The OpenRouter key is not valid. Check the key in Settings or ask an admin.');
  if (res.status === 402) throw new Error('The OpenRouter account is out of credits.');
  if (res.status === 403) throw new Error(`OpenRouter refused the request: ${errMsg}`);
  if (res.status === 404) throw new Error(`The model ${model} was not found on OpenRouter. An admin can change it.`);
  if (res.status === 429) throw new Error('Mr AI is busy right now. Try again in a minute.');
  if (!res.ok || !data) throw new Error(`OpenRouter returned ${res.status}: ${errMsg}`);
  if (data.error) throw new Error(`OpenRouter error: ${data.error.message || 'unknown'}`);
  const choice = data.choices?.[0];
  if (!choice) throw new Error('OpenRouter returned no answer.');
  if (choice.finish_reason === 'content_filter' || choice.native_finish_reason === 'refusal') throw new Error('Mr AI declined to answer this request.');
  const content = choice.message?.content;
  const out = Array.isArray(content) ? content.filter((p) => p.type === 'text').map((p) => p.text).join('\n') : String(content || '');
  return { text: out.trim(), model: data.model || model };
}
