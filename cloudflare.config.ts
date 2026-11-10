import { defineConfig } from 'cf/config';

export default defineConfig({
  worker: {
    name: 'voice100x',
    compatibilityDate: '2026-11-10',
    workersDev: true,
    previewUrls: false,
    observability: {
      enabled: true,
      redactQueryString: true,
      traces: { enabled: true },
    },
  },
});
