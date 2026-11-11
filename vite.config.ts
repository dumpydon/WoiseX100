import { cloudflare } from '@cloudflare/vite-plugin';
import { bindings } from 'cf/config';
import { existsSync, readFileSync } from 'node:fs';
import { defineConfig } from 'vite';

export default defineConfig(({ command }) => {
  const profilePath = new URL('./.private/profile-bindings.json', import.meta.url);
  const localProfile = command === 'serve' && existsSync(profilePath)
    ? JSON.parse(readFileSync(profilePath, 'utf8')) as Record<string, string>
    : {};
  return {
    server: { fs: { deny: ['**/.private/**'] } },
    plugins: [cloudflare({
      config(config) {
        if (!config.worker) return config;
        return {
          ...config,
          worker: {
            ...config.worker,
            env: {
              ...config.worker.env,
              ...Object.fromEntries(Object.entries(localProfile).map(([name, value]) => [name, bindings.text(value)])),
            },
          },
        };
      },
    })],
  };
});
