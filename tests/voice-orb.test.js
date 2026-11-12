import assert from 'node:assert/strict';
import test from 'node:test';
import { microphoneOrbScale, smoothOrbScale } from '../src/voice-orb.js';

test('microphone response interpolates through quiet, normal and strong speech with a hard size cap', () => {
  assert.equal(microphoneOrbScale(0), 1);
  assert.equal(microphoneOrbScale(.01), 1);
  assert.equal(microphoneOrbScale(.045), 1.10);
  assert.equal(microphoneOrbScale(.30), 1.125);
  assert.equal(microphoneOrbScale(.80), 1.15);
  let previous = 1;
  for (let level = 0; level <= 1.1; level += .001) {
    const scale = microphoneOrbScale(level);
    assert.ok(scale >= previous - 1e-10 && scale <= 1.15);
    assert.ok(scale - previous < .004);
    previous = scale;
  }
});

test('sizing responds quickly, settles more slowly, and cannot overshoot even with a large pulse', () => {
  const expanded = smoothOrbScale(1, 1.15, .10);
  assert.ok(expanded > 1.135 && expanded <= 1.15);
  assert.ok(smoothOrbScale(1.15, 1, .10) > 1.06);
  assert.ok(smoothOrbScale(1.15, 1, .40) < 1.008);
  assert.equal(smoothOrbScale(1, 2, 10), 1.15);
  assert.equal(smoothOrbScale(1.15, 0, 10), 1);
});
