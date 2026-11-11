export const PROFILE_PART_BYTES = 4500;
export const MAX_PROFILE_PARTS = 16;
export const MAX_PROFILE_BYTES = 64 * 1024;
const encoder = new TextEncoder();
const startMarker = '<!-- woisex100:runtime:start -->';
const endMarker = '<!-- woisex100:runtime:end -->';

function checkProfile(text) {
  if (typeof text !== 'string' || !text.trim() || encoder.encode(text).length > MAX_PROFILE_BYTES) {
    throw new Error('Invalid interview profile.');
  }
  return text;
}

async function digest(text) {
  const hash = await crypto.subtle.digest('SHA-256', encoder.encode(text));
  return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function extractRuntimeProfile(markdown) {
  const sections = markdown.split(startMarker);
  if (sections.length !== 2) throw new Error('The master profile needs one runtime section.');
  const tail = sections[1].split(endMarker);
  if (tail.length !== 2 || sections[0].includes(endMarker)) throw new Error('Invalid runtime section boundary.');
  const profile = checkProfile(tail[0].trim());
  if (/\/Users\/|sources\/codex\/|sources\/manual\//.test(profile)) {
    throw new Error('Keep private source paths outside the runtime section.');
  }
  return profile;
}

export async function createProfileBindings(profile) {
  checkProfile(profile);
  const chunks = [];
  let chunk = '';
  let bytes = 0;
  for (const character of profile) {
    const size = encoder.encode(character).length;
    if (bytes + size > PROFILE_PART_BYTES) {
      chunks.push(chunk);
      chunk = '';
      bytes = 0;
    }
    chunk += character;
    bytes += size;
  }
  if (chunk) chunks.push(chunk);
  if (chunks.length > MAX_PROFILE_PARTS) throw new Error('The interview profile has too many parts.');
  return {
    INTERVIEW_PROFILE_MANIFEST: JSON.stringify({ version: 1, parts: chunks.length, sha256: await digest(profile) }),
    ...Object.fromEntries(chunks.map((value, index) => [`INTERVIEW_PROFILE_${index + 1}`, value])),
  };
}

export async function loadInterviewProfile(env) {
  if (env.INTERVIEW_PROFILE_MANIFEST === undefined) {
    if (env.INTERVIEW_PROFILE === undefined || env.INTERVIEW_PROFILE === '') return '';
    return checkProfile(env.INTERVIEW_PROFILE);
  }
  let manifest;
  try {
    manifest = JSON.parse(env.INTERVIEW_PROFILE_MANIFEST);
  } catch {
    throw new Error('Invalid interview profile manifest.');
  }
  if (manifest?.version !== 1 || !Number.isInteger(manifest.parts) || manifest.parts < 1
    || manifest.parts > MAX_PROFILE_PARTS || !/^[a-f0-9]{64}$/.test(manifest.sha256)) {
    throw new Error('Invalid interview profile manifest.');
  }
  const chunks = Array.from({ length: manifest.parts }, (_, index) => env[`INTERVIEW_PROFILE_${index + 1}`]);
  if (chunks.some((chunk) => typeof chunk !== 'string' || !chunk.length
    || encoder.encode(chunk).length > PROFILE_PART_BYTES)) {
    throw new Error('Missing or oversized interview profile part.');
  }
  const profile = checkProfile(chunks.join(''));
  if (await digest(profile) !== manifest.sha256) throw new Error('Interview profile parts do not match.');
  return profile;
}
