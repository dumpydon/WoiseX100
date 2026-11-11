import { OPENAI_VOICES, UNAVAILABLE_VOICES, SPEECH_SPEEDS, SPEECH_SHUTDOWN, validateSpeechInput, speechLimits, speechHash, speechError } from './speech-config.js';
import { speechSession, speechPlaybackUrl, validSpeechPlaybackUrl } from './speech-session.js';
import { ttsOneProvider } from './tts-one-provider.js';

export async function speechGateway(request, env, readBody) {
  const url = new URL(request.url);
  const configuration = url.pathname === '/api/speech/config';
  const audio = url.pathname.startsWith('/api/speech/audio/');
  if (request.method !== (configuration || audio ? 'GET' : 'POST')) return speechError('Use the supported speech request method.', 'method_not_allowed', 405, { Allow: configuration || audio ? 'GET' : 'POST' });
  if (request.headers.get('Origin') && request.headers.get('Origin') !== url.origin) return speechError('Open WoiseX100 to use speech.', 'origin_not_allowed', 403);
  if (!configuration && !audio && request.headers.get('Content-Type')?.split(';')[0].trim() !== 'application/json') return speechError('Send speech text as JSON.', 'invalid_input', 415);
  const input = configuration || audio ? null : validateSpeechInput(await readBody(request));
  if (!configuration && !audio && !input) return speechError('Choose a supported TTS-1 voice, speed, and up to 4,000 characters.', 'invalid_input', 400);
  if (!env.TTS_SESSION_SECRET || !env.SPEECH_QUOTA || !env.SPEECH_JOBS) return speechError('OpenAI voice is not configured yet. You can choose Device Voice.', 'speech_unavailable');
  const session = await speechSession(request, env);
  const limits = speechLimits(env);
  let response;
  try {
    if (audio) {
      const hash = url.pathname.slice('/api/speech/audio/'.length);
      if (!await validSpeechPlaybackUrl(request, env, session.id, hash)) response = speechError('This audio link is invalid or expired. Retry audio to prepare a fresh link.', 'audio_link_expired', 403);
      else response = await env.SPEECH_JOBS.getByName(hash).cachedAudio();
    } else if (configuration) {
      const usage = await env.SPEECH_QUOTA.getByName('user:' + session.id).summary(limits.user, limits.price);
      response = Response.json({ available: Boolean(env.OPENAI_API_KEY) && ttsOneProvider.available(env), voices: OPENAI_VOICES, unavailableVoices: UNAVAILABLE_VOICES, speeds: SPEECH_SPEEDS, shutdownDate: SPEECH_SHUTDOWN, usage }, { headers: { 'Cache-Control': 'no-store' } });
    } else if (!ttsOneProvider.available(env)) {
      response = speechError('TTS-1 has reached its scheduled shutdown or was disabled. Choose Device Voice to continue.', 'model_unavailable', 410);
    } else if (!env.OPENAI_API_KEY) {
      response = speechError('OpenAI voice is temporarily unavailable. Retry or choose Device Voice.', 'speech_unavailable');
    } else {
      const rate = await env.SPEECH_LIMIT.limit({ key: session.ipId });
      if (!rate.success) response = speechError('Too many speech requests. Retry in a minute or choose Device Voice.', 'rate_limited', 429, { 'Retry-After': '60' });
      else {
        const hash = await speechHash(input);
        response = await env.SPEECH_JOBS.getByName(hash).synthesize({ ...input, hash, userId: session.id, ipId: session.ipId });
        if (response.ok) {
          const headers = new Headers(response.headers);
          headers.set('X-Speech-Playback', await speechPlaybackUrl(env, session.id, hash, limits.cacheSeconds));
          response = new Response(response.body, { status: response.status, headers });
        }
      }
    }
  } catch {
    response = speechError('OpenAI voice could not connect. Retry or choose Device Voice.', 'speech_unavailable');
  }
  const headers = new Headers(response.headers);
  headers.set('Cache-Control', 'no-store');
  headers.set('X-Content-Type-Options', 'nosniff');
  if (session.cookie) headers.append('Set-Cookie', session.cookie);
  return new Response(response.body, { status: response.status, headers });
}
