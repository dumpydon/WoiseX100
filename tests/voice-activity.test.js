import test from 'node:test';
import assert from 'node:assert/strict';
import { createSpeechActivityDetector } from '../src/voice-activity.js';

const rate = 48000;
const wave = (frequency, gain) => Float32Array.from({ length: 512 }, (_, index) => Math.sin(index * 2 * Math.PI * frequency / rate) * gain);
const rms = data => Math.sqrt(data.reduce((sum, value) => sum + value * value, 0) / data.length);

test('quiet speech activity registers; silence reports time since the last voiced frame', () => {
  const detector = createSpeechActivityDetector();
  const quiet = wave(190, .008);
  assert.equal(detector.measure(quiet, rate, rms(quiet), .0035, 0).active, false);
  assert.equal(detector.measure(quiet, rate, rms(quiet), .0035, 60).active, true);
  assert.equal(detector.measure(quiet, rate, rms(quiet), .0035, 100).active, true);
  const silence = new Float32Array(512);
  const end = detector.measure(silence, rate, 0, .0035, 180);
  assert.equal(end.active, false); assert.equal(end.silenceForMs, 80);
  assert.equal(detector.measure(silence, rate, 0, .0035, 3000).silenceForMs, 2900);
});

test('low ambient sound, low-frequency hum, broad noise and short clicks do not sustain speech activity', () => {
  for (const data of [wave(190, .002), wave(45, .03), Float32Array.from({ length: 512 }, (_, i) => i % 2 ? .02 : -.02)]) {
    const detector = createSpeechActivityDetector();
    for (let time = 0; time < 4000; time += 20) assert.equal(detector.measure(data, rate, rms(data), .0035, time).active, false);
  }
  const detector = createSpeechActivityDetector();
  const click = wave(300, .03);
  for (const time of [0, 20, 40]) assert.equal(detector.measure(click, rate, rms(click), .0035, time).active, false);
  assert.equal(detector.measure(new Float32Array(512), rate, 0, .0035, 60).active, false);
});
