import assert from 'node:assert/strict';
import test from 'node:test';
import { createVoiceInput } from '../src/voice-input.js';

const flush = async () => { for (let index = 0; index < 8; index += 1) await Promise.resolve(); };
function track() { return { kind: 'audio', readyState: 'live', stops: 0, stop() { this.readyState = 'ended'; this.stops += 1; } }; }
function stream() { const input = track(); return { input, getTracks: () => [input], getAudioTracks: () => [input] }; }
function setup({ legacy = false, permission, prepared = true, enabled = true } = {}) {
  const input = stream();
  const processed = track();
  const instances = [];
  const states = [], activations = [], finals = [], interim = [];
  let chimes = 0, meters = 0, disposed = 0, permissionCalls = 0;
  class Recognition {
    constructor() { this.calls = []; this.aborted = false; instances.push(this); }
    start(value) { this.calls.push(value); if (!legacy && value !== undefined && value.kind !== 'audio') throw new TypeError('Not a track'); }
    abort() { this.aborted = true; }
    stop() { this.stopped = true; }
  }
  const audio = {
    prepare: async () => prepared,
    attachMicrophone: () => ({ track: processed, startMeter: () => { meters += 1; }, dispose: () => { disposed += 1; processed.stop(); } }),
    playChime: () => { if (enabled) chimes += 1; return { played: enabled, delay: enabled ? 0.018 : 0 }; },
    stopChime() {},
  };
  const controller = createVoiceInput({
    Recognition,
    mediaDevices: { getUserMedia: () => { permissionCalls += 1; return permission ?? Promise.resolve(input); } },
    audio,
    onState: (...state) => states.push(state), onActivation: cue => activations.push(cue),
    onFinal: text => finals.push(text), onInterim: text => interim.push(text),
    setTimer: () => 1, clearTimer() {},
  });
  const ready = async () => {
    controller.start(); await flush();
    instances[0].onstart(); instances[0].onaudiostart(); await flush();
  };
  return { controller, input, processed, instances, states, activations, finals, interim, ready,
    get chimes() { return chimes; }, get meters() { return meters; }, get disposed() { return disposed; }, get permissionCalls() { return permissionCalls; } };
}

test('opening starts capture directly; the ready cue waits for service and audio, and fires once', async () => {
  const fixture = setup();
  assert.equal(fixture.controller.start(), true);
  assert.equal(fixture.controller.start(), false);
  assert.equal(fixture.chimes, 0);
  await flush();
  assert.equal(fixture.permissionCalls, 1);
  assert.equal(fixture.instances[0].calls.at(-1), fixture.processed);
  fixture.instances[0].onstart();
  assert.equal(fixture.chimes, 0);
  fixture.instances[0].onaudiostart();
  fixture.instances[0].onaudiostart();
  fixture.instances[0].onstart();
  assert.equal(fixture.chimes, 1);
  assert.equal(fixture.activations.length, 1);
  assert.equal(fixture.controller.phase, 'listening');
  fixture.controller.cancel();
});

test('reverse ready-event order also produces one activation', async () => {
  const fixture = setup();
  fixture.controller.start(); await flush();
  fixture.instances[0].onaudiostart();
  assert.equal(fixture.chimes, 0);
  fixture.instances[0].onstart();
  assert.equal(fixture.chimes, 1);
  fixture.controller.cancel();
});

test('permission denial and service activation failure never play a chime', async () => {
  const denied = setup({ permission: Promise.reject(Object.assign(new Error('Denied'), { name: 'NotAllowedError' })) });
  denied.controller.start(); await flush();
  assert.equal(denied.chimes, 0);
  assert.equal(denied.controller.active, false);
  assert.match(denied.states.at(-1)[2], /denied/);
  const failure = setup();
  failure.controller.start(); await flush();
  failure.instances[0].onerror({ error: 'network' });
  failure.instances[0].onstart(); failure.instances[0].onaudiostart();
  assert.equal(failure.chimes, 0);
  assert.equal(failure.activations.length, 0);
  assert.equal(failure.input.input.readyState, 'ended');
  assert.equal(failure.processed.readyState, 'ended');
});

test('closing during a permission request releases a late stream without activating', async () => {
  let resolve;
  const permission = new Promise(done => { resolve = done; });
  const fixture = setup({ permission });
  fixture.controller.start(); fixture.controller.cancel();
  resolve(fixture.input); await flush();
  assert.equal(fixture.input.input.readyState, 'ended');
  assert.equal(fixture.instances[0].calls.length, 1);
  assert.equal(fixture.activations.length, 0);
});

test('muting interface sounds preserves the visual ready cue and listening', async () => {
  const fixture = setup({ enabled: false }); await fixture.ready();
  assert.equal(fixture.chimes, 0);
  assert.equal(fixture.activations.length, 1);
  assert.equal(fixture.activations[0].played, false);
  assert.equal(fixture.controller.phase, 'listening');
  fixture.controller.cancel();
});

test('the first words during the cue are preserved and submitted only once', async () => {
  const fixture = setup(); await fixture.ready();
  const recognition = fixture.instances[0];
  const partial = [{ transcript: 'Hello from the first word' }]; partial.isFinal = false;
  recognition.onresult({ resultIndex: 0, results: [partial] });
  const final = [{ transcript: 'Hello from the first word' }]; final.isFinal = true;
  recognition.onresult({ resultIndex: 0, results: [final] });
  recognition.onresult({ resultIndex: 0, results: [final] });
  assert.deepEqual(fixture.interim, ['Hello from the first word']);
  assert.deepEqual(fixture.finals, ['Hello from the first word']);
  assert.equal(fixture.controller.active, false);
  assert.equal(fixture.input.input.readyState, 'ended');
});

test('a legacy mic session works silently without playing the cue into uncontrolled input', async () => {
  const fixture = setup({ legacy: true }); await fixture.ready();
  assert.equal(fixture.chimes, 0);
  assert.equal(fixture.activations[0].played, false);
  assert.equal(fixture.instances[0].calls.length, 1);
  assert.equal(fixture.meters, 1);
  fixture.controller.cancel();
});

test('blocked Web Audio resumes native listening without queuing a late sound', async () => {
  const fixture = setup({ prepared: false }); await fixture.ready();
  assert.equal(fixture.instances[0].calls.at(-1), undefined);
  assert.equal(fixture.chimes, 0);
  assert.equal(fixture.activations[0].played, false);
  fixture.controller.cancel();
});

test('finish flushes the final phrase, while an idle end does not start a chime loop', async () => {
  const fixture = setup(); await fixture.ready();
  fixture.controller.finish();
  assert.equal(fixture.instances[0].stopped, true);
  assert.equal(fixture.controller.phase, 'finishing');
  const final = [{ transcript: 'Keep the complete question' }]; final.isFinal = true;
  fixture.instances[0].onresult({ resultIndex: 0, results: [final] });
  assert.deepEqual(fixture.finals, ['Keep the complete question']);
  const idle = setup(); await idle.ready();
  idle.instances[0].onend();
  assert.equal(idle.controller.active, false);
  assert.equal(idle.instances.length, 1);
  assert.equal(idle.chimes, 1);
});

test('a microphone track ending before readiness does not produce a ready cue', async () => {
  const fixture = setup(); fixture.controller.start(); await flush();
  fixture.input.input.stop();
  fixture.instances[0].onstart(); fixture.instances[0].onaudiostart();
  assert.equal(fixture.chimes, 0);
  assert.equal(fixture.activations.length, 0);
  assert.equal(fixture.controller.active, false);
});

test('an exposed but unavailable recognition constructor becomes a recoverable state', () => {
  const states = [];
  class Unavailable { constructor() { throw new TypeError('Unavailable'); } }
  const controller = createVoiceInput({ Recognition: Unavailable, audio: {}, onState: (...state) => states.push(state) });
  assert.equal(controller.start(), false);
  assert.equal(controller.active, false);
  assert.equal(states.at(-1)[0], 'error');
});
