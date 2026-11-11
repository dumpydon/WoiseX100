import { bindings, defineConfig, exports } from 'cf/config';

export default defineConfig({
  worker: {
    name: 'voice100x',
    entrypoint: './src/worker.js',
    compatibilityDate: '2026-11-10',
    workersDev: true,
    previewUrls: false,
    assets: { runWorkerFirst: ['/api/*'] },
    exports: {
      SpeechQuota: exports.durableObject({ storage: 'sqlite' }),
      SpeechJob: exports.durableObject({ storage: 'sqlite' }),
    },
    env: {
      OPENAI_API_KEY: bindings.secret(),
      TTS_SESSION_SECRET: bindings.secret(),
      SPEECH_QUOTA: bindings.durableObject({ worker: 'voice100x', exportName: 'SpeechQuota' }),
      SPEECH_JOBS: bindings.durableObject({ worker: 'voice100x', exportName: 'SpeechJob' }),
      SPEECH_LIMIT: bindings.rateLimit({ namespace: '1001002', simple: { limit: 20, period: 60 } }),
      TTS_USER_DAILY_CHARACTERS: bindings.text('12000'),
      TTS_IP_DAILY_CHARACTERS: bindings.text('24000'),
      TTS_GLOBAL_DAILY_CHARACTERS: bindings.text('200000'),
      TTS_PRICE_PER_MILLION: bindings.text('15'),
      TTS_CACHE_SECONDS: bindings.text('86400'),
      INTERVIEW_PROFILE_MANIFEST: bindings.secret(),
      INTERVIEW_PROFILE_1: bindings.secret(),
      INTERVIEW_PROFILE_2: bindings.secret(),
      INTERVIEW_PROFILE_3: bindings.secret(),
      INTERVIEW_PROFILE_4: bindings.secret(),
      INTERVIEW_PROFILE_5: bindings.secret(),
      INTERVIEW_PROFILE_6: bindings.secret(),
      INTERVIEW_PROFILE_7: bindings.secret(),
      REPLY_LIMIT: bindings.rateLimit({ namespace: '1001001', simple: { limit: 8, period: 60 } }),
    },
    observability: {
      enabled: true,
      redactQueryString: true,
      traces: { enabled: true },
    },
  },
});
