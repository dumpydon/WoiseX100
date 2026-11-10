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
      REPLY_LIMIT: bindings.rateLimit({ namespace: '1001001', simple: { limit: 8, period: 60 } }),
    },
    observability: {
      enabled: true,
      redactQueryString: true,
      traces: { enabled: true },
    },
  },
});
