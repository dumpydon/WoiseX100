import { bindings, defineConfig } from 'cf/config';

export default defineConfig({
  worker: {
    name: 'voice100x',
    entrypoint: './src/worker.js',
    compatibilityDate: '2026-11-10',
    workersDev: true,
    previewUrls: false,
    assets: { runWorkerFirst: ['/api/*'] },
    env: {
      OPENAI_API_KEY: bindings.secret(),
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
