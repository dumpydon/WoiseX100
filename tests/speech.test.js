import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { SpeechLedger } from '../src/speech-ledger.js';
import { validateSpeechInput, splitSpeechText, characterCount, speechHash } from '../src/speech-config.js';
import { speechSession, speechPlaybackUrl, validSpeechPlaybackUrl } from '../src/speech-session.js';
import { ttsOneProvider } from '../src/tts-one-provider.js';

test('character reservations enforce concurrent budgets, survive reconstruction, and reset daily', () => {
  const db = new DatabaseSync(':memory:');
  const sql = { exec(query, ...args) {
    const statement = db.prepare(query);
    const rows = /^SELECT\b/i.test(query) ? statement.all(...args) : (statement.run(...args), []);
    return { one: () => rows[0], toArray: () => rows };
  } };
  let now = Date.parse('2026-11-11T12:00:00Z');
  let ledger = new SpeechLedger(sql, () => now);
  assert.equal(ledger.reserve('first', 60, 100).ok, true);
  assert.equal(ledger.reserve('second', 50, 100).ok, false);
  ledger.commit('first');
  ledger = new SpeechLedger(sql, () => now);
  assert.equal(ledger.summary(100, 15).submittedCharacters, 60);
  assert.equal(ledger.summary(100, 15).estimatedCostUsd, .0009);
  assert.equal(ledger.reserve('rejected', 40, 100).ok, true);
  ledger.release('rejected');
  assert.equal(ledger.summary(100, 15).remainingCharacters, 40);
  assert.equal(ledger.reserve('expired', 40, 100).ok, true);
  now += 120001;
  assert.equal(ledger.summary(100, 15).reservedCharacters, 0);
  now += 86400000;
  assert.equal(ledger.summary(100, 15).remainingCharacters, 100);
  assert.equal(ledger.reserve('disabled', 1, 0).ok, false);
  db.close();
});

test('speech input rejects other models and unavailable voices; Unicode chunks preserve the reply', async () => {
  const input = { text: 'Hello\r\nworld', voice: 'coral', speed: 1 };
  assert.equal(validateSpeechInput(input).text, 'Hello\nworld');
  assert.equal(validateSpeechInput({ ...input, model: 'tts-1-hd' }), null);
  assert.equal(validateSpeechInput({ ...input, voice: 'marin' }), null);
  assert.equal(validateSpeechInput({ ...input, speed: 2 }), null);
  assert.equal(validateSpeechInput({ ...input, text: 'a'.repeat(4001) }), null);
  const text = 'One 🙂 sentence. '.repeat(500).trim();
  const chunks = splitSpeechText(text);
  assert.equal(chunks.join(''), text);
  assert.ok(chunks.every(chunk => characterCount(chunk) <= 4000));
  assert.notEqual(await speechHash(input), await speechHash({ ...input, voice: 'echo' }));
});

test('anonymous speech cookies are signed and tampering creates a fresh visitor', async () => {
  const env = { TTS_SESSION_SECRET: 'test-only-session-signing-value' };
  const first = await speechSession(new Request('https://example.com/api/speech/config'), env);
  assert.match(first.cookie, /HttpOnly; SameSite=Lax; Max-Age=2592000; Secure$/);
  const cookie = first.cookie.split(';')[0];
  const same = await speechSession(new Request('https://example.com/api/speech', { headers: { Cookie: cookie } }), env);
  assert.equal(same.id, first.id);
  assert.equal(same.cookie, undefined);
  const forged = cookie.replace(/=[^.]+/, '=' + '0'.repeat(32));
  const changed = await speechSession(new Request('https://example.com/api/speech', { headers: { Cookie: forged } }), env);
  assert.notEqual(changed.id, first.id);
  const hash = 'a'.repeat(64);
  const playback = new Request(new URL(await speechPlaybackUrl(env, first.id, hash, 60), 'https://example.com'));
  assert.equal(await validSpeechPlaybackUrl(playback, env, first.id, hash), true);
  assert.equal(await validSpeechPlaybackUrl(playback, env, changed.id, hash), false);
  assert.equal(await validSpeechPlaybackUrl(playback, env, first.id, 'b'.repeat(64)), false);
  const expired = new URL(playback.url); expired.searchParams.set('expires', '1000000000');
  assert.equal(await validSpeechPlaybackUrl(new Request(expired), env, first.id, hash), false);
});

test('TTS-1 retirement stops generation without migrating to another model', () => {
  assert.equal(ttsOneProvider.available({}, Date.parse('2027-01-05T23:59:59Z')), true);
  assert.equal(ttsOneProvider.available({}, Date.parse('2027-01-06T00:00:00Z')), false);
  assert.equal(ttsOneProvider.available({ TTS_ENABLED: 'false' }, Date.parse('2026-11-11')), false);
});
