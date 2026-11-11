import assert from 'node:assert/strict';
import test from 'node:test';
import { activationChimeSamples, CHIME_DURATION, readInterfaceSounds, saveInterfaceSounds, createVoiceAudio } from '../src/voice-audio.js';

test('the original cue is 400 ms, quiet, smooth at the edges, and rises between two notes', () => {
  const rate = 48000;
  const samples = activationChimeSamples(rate);
  assert.equal(samples.length / rate, CHIME_DURATION);
  assert.ok(Math.max(...samples.map(Math.abs)) < 0.1);
  assert.equal(samples[0], 0);
  assert.ok(Math.abs(samples.at(-1)) < 0.000001);
  const energy = (frequency, start, end) => {
    let real = 0, imaginary = 0;
    for (let index = Math.round(start * rate); index < end * rate; index += 1) {
      const angle = 2 * Math.PI * frequency * index / rate;
      real += samples[index] * Math.cos(angle); imaginary += samples[index] * Math.sin(angle);
    }
    return real * real + imaginary * imaginary;
  };
  assert.ok(energy(392, .03, .12) > energy(523.251, .03, .12) * 10);
  assert.ok(energy(523.251, .28, .38) > energy(392, .28, .38) * 10);
});

test('sound preference is durable when storage works and harmless when blocked', () => {
  const values = new Map();
  const storage = { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) };
  assert.equal(readInterfaceSounds(storage), true);
  saveInterfaceSounds(storage, false);
  assert.equal(readInterfaceSounds(storage), false);
  assert.deepEqual([...values.values()], ['off']);
  const blocked = { getItem() { throw new Error('Blocked'); }, setItem() { throw new Error('Blocked'); } };
  assert.equal(readInterfaceSounds(blocked), true);
  assert.doesNotThrow(() => saveInterfaceSounds(blocked, false));
});

test('blocked playback does not throw or schedule a cue', async () => {
  class BlockedContext { state = 'suspended'; resume() { return Promise.reject(new Error('Blocked')); } }
  const audio = createVoiceAudio({ AudioContextClass: BlockedContext });
  assert.equal(await audio.prepare(), false);
  assert.deepEqual(audio.playChime(null), { played: false, delay: 0 });
});

test('an unresolved autoplay resume times out silently instead of hanging microphone activation', async () => {
  class PendingContext { state = 'suspended'; resume() { return new Promise(() => {}); } }
  const audio = createVoiceAudio({ AudioContextClass: PendingContext, setTimer: callback => { queueMicrotask(callback); return 1; }, clearTimer() {} });
  assert.equal(await audio.prepare(), false);
  assert.deepEqual(audio.playChime(null), { played: false, delay: 0 });
});
