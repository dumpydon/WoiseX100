import { buildInterviewInstructions } from './interview-instructions.js';
import { loadInterviewProfile } from './profile.js';
import { speechGateway } from './speech-gateway.js';
import { MAX_QUESTION_CHARACTERS } from './message-limits.js';

const lunaModel = 'gpt-6-luna';
const solModel = 'gpt-6.1-sol';
const presets = {
  low: { model: lunaModel, effort: 'high', maxTokens: 2048 },
  medium: { model: lunaModel, effort: 'max', maxTokens: 4096 },
  high: { model: solModel, effort: 'medium', maxTokens: 2048 },
  'extra-high': { model: solModel, effort: 'xhigh', maxTokens: 4096 },
  max: { model: solModel, effort: 'max', maxTokens: 8192 },
};
const availableEfforts = Object.keys(presets);
const maxBodyBytes = 128 * 1024;
const maxMessages = 7;
const maxMessageLength = 1200;

function json(body, status = 200, headers = {}) {
  return Response.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers },
  });
}

async function readBody(request) {
  const reader = request.body?.getReader();
  if (!reader) return null;

  const decoder = new TextDecoder();
  let bytes = 0;
  let text = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBodyBytes) {
        await reader.cancel();
        return null;
      }
      text += decoder.decode(value, { stream: true });
    }
    return JSON.parse(text + decoder.decode());
  } catch {
    return null;
  } finally {
    reader.releaseLock();
  }
}

function validMessages(messages) {
  return Array.isArray(messages)
    && messages.length > 0
    && messages.length <= maxMessages
    && messages.length % 2 === 1
    && messages.every((message, index) => message?.role === (index % 2 === 0 ? 'user' : 'assistant')
      && typeof message.content === 'string'
      && message.content.length <= (message.role === 'user' ? MAX_QUESTION_CHARACTERS : maxMessageLength)
      && message.content.trim());
}

async function answer(request, url, env) {
  if (request.method !== 'POST') return json({ error: 'Use POST to send a question.' }, 405, { Allow: 'POST' });
  const origin = request.headers.get('Origin');
  if (origin && origin !== url.origin) return json({ error: 'Open WoiseX100 to send a question.' }, 403);
  if (request.headers.get('Content-Type')?.split(';')[0].trim() !== 'application/json') {
    return json({ error: 'Send the question as JSON.' }, 415);
  }
  if (!env.OPENAI_API_KEY) return json({ error: 'Live replies are unavailable in this preview.' }, 503);

  const input = await readBody(request);
  if (!input || !availableEfforts.includes(input.effort) || !validMessages(input.messages)) {
    return json({ error: 'Choose an available effort and send a shorter question.' }, 400);
  }
  const rate = await env.REPLY_LIMIT.limit({ key: request.headers.get('CF-Connecting-IP') || 'local' });
  if (!rate.success) return json({ error: 'Too many questions. Try again in a minute.' }, 429, { 'Retry-After': '60' });

  const preset = presets[input.effort];
  let profile;
  try {
    profile = await loadInterviewProfile(env);
  } catch {
    return json({ error: 'The interview profile is temporarily unavailable. Try again shortly.' }, 503);
  }
  const messages = input.messages.map(({ role, content }) => ({ role, content }));
  try {
    const upstream = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: preset.model,
        reasoning: { effort: preset.effort },
        instructions: buildInterviewInstructions(profile),
        input: messages,
        text: { verbosity: 'low' },
        max_output_tokens: preset.maxTokens,
        store: false,
      }),
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(90_000)]),
    });
    const result = await upstream.json();
    if (!upstream.ok) {
      console.warn(JSON.stringify({ event: 'reply_failed', status: upstream.status, code: result.error?.code }));
      return json({ error: 'Live replies are temporarily unavailable. Try again shortly.' }, 502);
    }
    const text = result.output?.filter((item) => item.type === 'message' && item.phase !== 'commentary')
      .flatMap((item) => item.content ?? [])
      .map((item) => item.type === 'output_text' ? item.text : item.type === 'refusal' ? item.refusal : '')
      .filter(Boolean).join('\n').trim();
    if (!text || result.status === 'incomplete') {
      return json({ error: 'The reply didn’t finish. Try a shorter question or choose a lower effort.' }, 502);
    }
    return json({ text });
  } catch (error) {
    if (error.name === 'TimeoutError') return json({ error: 'That reply took too long. Try a lower effort.' }, 504);
    return json({ error: 'The reply couldn’t load. Try again.' }, 502);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/speech' || url.pathname === '/api/speech/config' || url.pathname.startsWith('/api/speech/audio/')) return speechGateway(request, env, readBody);
    if (url.pathname === '/api/status') {
      if (request.method !== 'GET') return json({ error: 'Use GET to check status.' }, 405, { Allow: 'GET' });
      let profile = 'missing';
      try {
        if (await loadInterviewProfile(env)) profile = 'ready';
      } catch {
        profile = 'unavailable';
      }
      return json({ live: Boolean(env.OPENAI_API_KEY), profile });
    }
    if (url.pathname === '/api/reply') return answer(request, url, env);
    return new Response('Not found', { status: 404 });
  },
};
