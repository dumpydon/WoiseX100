import { SPEECH_MODEL, SPEECH_SHUTDOWN, speechError } from './speech-config.js';

// Replace this adapter only through an explicit reviewed model change. No automatic paid-model migration.
export const ttsOneProvider = {
  available(env, now = Date.now()) {
    return env.TTS_ENABLED !== 'false' && now < Date.parse(SPEECH_SHUTDOWN + 'T00:00:00Z');
  },
  async generate(input, env) {
    if (!this.available(env)) return speechError('TTS-1 is unavailable. You can explicitly choose Device Voice.', 'model_unavailable', 410);
    return fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: SPEECH_MODEL, voice: input.voice, input: input.text, speed: input.speed, response_format: 'mp3' }),
      signal: AbortSignal.timeout(90_000),
    });
  },
};
