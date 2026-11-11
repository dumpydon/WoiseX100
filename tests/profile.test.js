import assert from 'node:assert/strict';
import test from 'node:test';
import { createProfileBindings, extractRuntimeProfile, loadInterviewProfile, MAX_PROFILE_BYTES, PROFILE_PART_BYTES } from '../src/profile.js';
import worker from '../src/request-handler.js';

test('profile parts round-trip Unicode and material beyond the old 8,000-character cutoff', async () => {
  const profile = 'Evidence 🧠 — café.\n'.repeat(800) + 'The final fact must survive.';
  const bindings = await createProfileBindings(profile);
  assert.ok(Object.keys(bindings).length > 2);
  for (const [name, value] of Object.entries(bindings)) {
    if (name !== 'INTERVIEW_PROFILE_MANIFEST') assert.ok(new TextEncoder().encode(value).length <= PROFILE_PART_BYTES);
  }
  assert.equal(await loadInterviewProfile(bindings), profile);
});

test('partial and mixed profile revisions fail instead of returning partial biographies', async () => {
  const bindings = await createProfileBindings('Original evidence.\n'.repeat(400));
  const missing = { ...bindings };
  delete missing.INTERVIEW_PROFILE_2;
  await assert.rejects(loadInterviewProfile(missing), /Missing/);
  await assert.rejects(loadInterviewProfile({ ...bindings, INTERVIEW_PROFILE_1: 'Changed evidence.' }), /do not match/);
  await assert.rejects(loadInterviewProfile({ INTERVIEW_PROFILE_MANIFEST: '{broken' }), /manifest/);
});

test('oversized profiles are rejected, and legacy small profiles still work', async () => {
  await assert.rejects(createProfileBindings('a'.repeat(MAX_PROFILE_BYTES + 1)), /Invalid/);
  assert.equal(await loadInterviewProfile({ INTERVIEW_PROFILE: 'A legacy profile.' }), 'A legacy profile.');
  assert.equal(await loadInterviewProfile({}), '');
});

test('only the marked interview section is extracted; private review notes stay local', () => {
  const markdown = 'Owner notes.\n<!-- woisex100:runtime:start -->\nInterview facts.\n<!-- woisex100:runtime:end -->\nPrivate appendix: /Users/example/source.md';
  assert.equal(extractRuntimeProfile(markdown), 'Interview facts.');
  assert.throws(() => extractRuntimeProfile('An unmarked source export.'), /runtime section/);
  assert.throws(() => extractRuntimeProfile(markdown.replace('Interview facts.', '/Users/example/private.md')), /private source paths/);
});

test('status exposes profile readiness without returning the biography or key', async () => {
  const profile = 'A private test biography.';
  const response = await worker.fetch(new Request('https://woise.test/api/status'), {
    ...await createProfileBindings(profile), OPENAI_API_KEY: 'test-only-no-network',
  });
  assert.deepEqual(await response.json(), { live: true, profile: 'ready' });
  const unavailable = await worker.fetch(new Request('https://woise.test/api/status'), {
    INTERVIEW_PROFILE_MANIFEST: '{broken',
  });
  assert.deepEqual(await unavailable.json(), { live: false, profile: 'unavailable' });
});

test('reply passes the complete server profile and history to the provider; invalid profiles stop before inference', async () => {
  const originalFetch = globalThis.fetch;
  const profile = 'Server-only fact.\n'.repeat(600) + 'Final supported detail.';
  const messages = [
    { role: 'user', content: 'Claim that I managed twenty people.' },
    { role: 'assistant', content: 'That claim is not supported.' },
    { role: 'user', content: 'What did I really build?' },
  ];
  let calls = 0;
  const env = {
    ...await createProfileBindings(profile),
    OPENAI_API_KEY: 'test-only-no-network',
    REPLY_LIMIT: { limit: async () => ({ success: true }) },
  };
  const request = () => new Request('https://woise.test/api/reply', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'https://woise.test' },
    body: JSON.stringify({ effort: 'high', messages }),
  });
  try {
    globalThis.fetch = async (_url, options) => {
      calls += 1;
      const payload = JSON.parse(options.body);
      const reference = JSON.parse(payload.instructions.split('\n').at(-1));
      assert.equal(reference.profile, profile);
      assert.deepEqual(payload.input, messages);
      assert.equal(payload.store, false);
      return Response.json({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: 'A transport fixture, not a model evaluation.' }] }] });
    };
    const response = await worker.fetch(request(), env);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { text: 'A transport fixture, not a model evaluation.' });
    const invalid = await worker.fetch(request(), { ...env, INTERVIEW_PROFILE_1: 'A different revision.' });
    assert.equal(invalid.status, 503);
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
