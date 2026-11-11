export const SPEECH_MODEL = 'tts-1';
export const SPEECH_SHUTDOWN = '2027-01-06';
export const OPENAI_VOICES = ['nova', 'alloy', 'coral', 'fable', 'sage', 'shimmer', 'echo', 'ash', 'onyx'];
export const UNAVAILABLE_VOICES = ['ballad', 'verse', 'marin', 'cedar'];
export const SPEECH_SPEEDS = [.9, 1, 1.1];
export const MAX_SPEECH_CHARACTERS = 4000;
export const MAX_AUDIO_BYTES = 8 * 1024 * 1024;
export const PREVIEW_TEXT = "Hello, I'm WoiseX100. You can ask me a question.";
export const characterCount = text => Array.from(text).length;

export function speechLimits(env) {
  const integer = (name, fallback, maximum) => {
    const value = Number(env[name]);
    return Number.isInteger(value) && value >= 0 && value <= maximum ? value : fallback;
  };
  const rate = Number(env.TTS_PRICE_PER_MILLION ?? 15);
  return {
    user: integer('TTS_USER_DAILY_CHARACTERS', 12000, 1000000),
    ip: integer('TTS_IP_DAILY_CHARACTERS', 24000, 2000000),
    global: integer('TTS_GLOBAL_DAILY_CHARACTERS', 200000, 10000000),
    price: Number.isFinite(rate) && rate >= 0 ? rate : 15,
    cacheSeconds: Math.max(60, integer('TTS_CACHE_SECONDS', 86400, 604800)),
  };
}

export function validateSpeechInput(input) {
  if (!input || typeof input !== 'object' || Object.keys(input).some(key => !['text', 'voice', 'speed'].includes(key))) return null;
  if (typeof input.text !== 'string' || !OPENAI_VOICES.includes(input.voice) || !SPEECH_SPEEDS.includes(input.speed)) return null;
  const text = input.text.replace(/\r\n?/g, '\n').trim();
  if (!text || characterCount(text) > MAX_SPEECH_CHARACTERS) return null;
  return { text, voice: input.voice, speed: input.speed };
}

export function splitSpeechText(text, maximum = MAX_SPEECH_CHARACTERS) {
  const characters = Array.from(text.trim());
  const chunks = [];
  while (characters.length) {
    let length = Math.min(maximum, characters.length);
    if (length < characters.length) {
      for (let index = length - 1; index >= Math.floor(length * .6); index -= 1) {
        if (/\s/.test(characters[index])) { length = index + 1; break; }
      }
    }
    chunks.push(characters.splice(0, length).join(''));
  }
  return chunks;
}

export async function speechHash(input) {
  const bytes = new TextEncoder().encode(JSON.stringify([SPEECH_MODEL, input.voice, input.speed, input.text]));
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(value => value.toString(16).padStart(2, '0')).join('');
}

export function speechError(message, code, status = 503, headers = {}) {
  return Response.json({ error: message, code }, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers } });
}
