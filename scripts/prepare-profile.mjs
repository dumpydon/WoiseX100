import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createProfileBindings, extractRuntimeProfile } from '../src/profile.js';

const privateDirectory = new URL('../.private/', import.meta.url);
const input = process.argv[2] ?? fileURLToPath(new URL('woisex100-profile.md', privateDirectory));
const profile = extractRuntimeProfile(await readFile(input, 'utf8'));
const bindings = await createProfileBindings(profile);
await mkdir(privateDirectory, { recursive: true, mode: 0o700 });
await chmod(privateDirectory, 0o700);
await writeFile(new URL('woisex100-profile.runtime.md', privateDirectory), profile + '\n', { mode: 0o600 });
await writeFile(new URL('profile-bindings.json', privateDirectory), JSON.stringify(bindings, null, 2) + '\n', { mode: 0o600 });
console.log(`Prepared ${new TextEncoder().encode(profile).length} bytes in ${Object.keys(bindings).length - 1} private profile parts. No sources, API keys, or remote services were changed.`);
