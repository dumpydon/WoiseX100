import assert from 'node:assert/strict';
import test from 'node:test';
import { createVoiceInput, END_OF_TURN_SILENCE_MS } from '../src/voice-input.js';

const flush = async () => { for (let index = 0; index < 8; index += 1) await Promise.resolve(); };
function track() { return { kind: 'audio', readyState: 'live', stops: 0, stop() { this.readyState = 'ended'; this.stops += 1; } }; }
function stream() { const input = track(); return { input, getTracks: () => [input], getAudioTracks: () => [input] }; }
function setup({ legacy = false, permission, prepared = true, enabled = true, metered = false, silenceMs, accepted = true } = {}) {
  const input = stream();
  const processed = track();
  const instances = [];
  const states = [], activations = [], finals = [], interim = [];
  const inputs = [input], processedTracks = [processed];
  const timers = new Map(); let time = 0, nextTimer = 0, meterOptions;
  const tick = milliseconds => {
    const until = time + milliseconds;
    for (let iteration = 0; iteration < 1000; iteration += 1) {
      const next = [...timers].filter(([, timer]) => timer.at <= until).sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) { time = until; return; }
      const [id, timer] = next; timers.delete(id); time = timer.at; timer.callback();
    }
    throw new Error('Unexpected timer loop');
  };
  let chimes = 0, meters = 0, disposed = 0, permissionCalls = 0;
  class Recognition {
    constructor() { this.calls = []; this.aborted = false; instances.push(this); }
    start(value) { this.calls.push(value); if (!legacy && value !== undefined && value.kind !== 'audio') throw new TypeError('Not a track'); }
    abort() { this.aborted = true; }
    stop() { this.stopped = true; }
  }
  const audio = {
    prepare: async () => prepared,
    attachMicrophone: (source, options) => {
      meterOptions = options;
      const output = source === input ? processed : track();
      if (output !== processed) processedTracks.push(output);
      return { track: output, hasSpeechActivity: metered, startMeter: () => { meters += 1; }, dispose: () => { disposed += 1; output.stop(); } };
    },
    playChime: () => { if (enabled) chimes += 1; return { played: enabled, delay: enabled ? 0.018 : 0 }; },
    stopChime() {},
  };
  const controller = createVoiceInput({
    Recognition,
    mediaDevices: { getUserMedia: () => {
      permissionCalls += 1;
      if (permission) return permission;
      const value = permissionCalls === 1 ? input : stream();
      if (value !== input) inputs.push(value);
      return Promise.resolve(value);
    } },
    audio,
    onState: (...state) => states.push(state), onActivation: cue => activations.push(cue),
    onFinal: text => { finals.push(text); return accepted; }, onInterim: text => interim.push(text),
    silenceMs, now: () => time,
    setTimer: (callback, delay) => { const id = ++nextTimer; timers.set(id, { callback, at: time + delay }); return id; },
    clearTimer: id => timers.delete(id),
  });
  const ready = async () => {
    controller.start(); await flush();
    instances.at(-1).onstart(); instances.at(-1).onaudiostart(); await flush();
  };
  const result = (index, text, final = true, recognizer = instances.at(-1)) => {
    recognizer.results ??= [];
    const item = [{ transcript: text }]; item.isFinal = final; recognizer.results[index] = item;
    recognizer.onresult({ resultIndex: index, results: recognizer.results.slice() });
  };
  return { controller, input, processed, inputs, processedTracks, instances, states, activations, finals, interim, ready, tick, result,
    activity: (active, silenceForMs = 0) => meterOptions.onSpeechActivity({ active, silenceForMs }),
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

test('the first words during the cue are kept; even a repeated final segment waits for three seconds', async () => {
  const fixture = setup(); await fixture.ready();
  const recognition = fixture.instances[0];
  const partial = [{ transcript: 'Hello from the first word' }]; partial.isFinal = false;
  recognition.onresult({ resultIndex: 0, results: [partial] });
  const final = [{ transcript: 'Hello from the first word' }]; final.isFinal = true;
  recognition.onresult({ resultIndex: 0, results: [final] });
  recognition.onresult({ resultIndex: 0, results: [final] });
  assert.deepEqual(fixture.interim, ['Hello from the first word']);
  assert.deepEqual(fixture.finals, []);
  assert.equal(fixture.controller.active, true);
  fixture.tick(2999);
  assert.equal(fixture.input.input.readyState, 'live');
  fixture.tick(1);
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

test('explicit finish flushes an interim phrase; an automatic end keeps the same capture and starts no chime loop', async () => {
  const fixture = setup(); await fixture.ready();
  fixture.result(0, 'Keep the complete question', false);
  fixture.controller.finish();
  assert.equal(fixture.instances[0].stopped, true);
  assert.equal(fixture.controller.phase, 'finishing');
  const final = [{ transcript: 'Keep the complete question' }]; final.isFinal = true;
  fixture.instances[0].onresult({ resultIndex: 0, results: [final] });
  assert.deepEqual(fixture.finals, ['Keep the complete question']);
  const idle = setup(); await idle.ready();
  idle.instances[0].onend();
  idle.tick(0);
  assert.equal(idle.controller.active, true);
  assert.equal(idle.input.input.readyState, 'live');
  assert.equal(idle.instances.length, 2);
  idle.instances[1].onstart(); idle.instances[1].onaudiostart();
  assert.equal(idle.chimes, 1);
  idle.controller.cancel();
});

for (const pause of [1000, 2500, 2900]) test(`a ${pause} ms pause preserves capture and joins both speech segments into one turn`, async () => {
  const fixture = setup(); await fixture.ready();
  fixture.instances[0].onspeechstart(); fixture.result(0, 'This is my'); fixture.instances[0].onspeechend();
  fixture.tick(pause);
  assert.deepEqual(fixture.finals, []);
  assert.equal(fixture.controller.phase, 'listening');
  assert.equal(fixture.input.input.readyState, 'live');
  assert.equal(fixture.processed.readyState, 'live');
  fixture.instances[0].onspeechstart(); fixture.result(1, 'complete answer.'); fixture.instances[0].onspeechend();
  fixture.tick(2999); assert.deepEqual(fixture.finals, []);
  fixture.tick(1); assert.deepEqual(fixture.finals, ['This is my complete answer.']);
  fixture.tick(10000); assert.equal(fixture.finals.length, 1);
});

test('continuous speech blocks submission; silence uses the last voiced frame rather than late transcript delivery', async () => {
  const fixture = setup({ metered: true }); await fixture.ready();
  fixture.activity(true); fixture.instances[0].onspeechstart(); fixture.result(0, 'A quiet but ongoing answer');
  fixture.tick(5000); assert.deepEqual(fixture.finals, []);
  fixture.activity(true); fixture.tick(80); fixture.activity(false, 80);
  fixture.tick(180); fixture.activity(false, 260);
  fixture.tick(2000); fixture.result(0, 'A quiet but ongoing answer.');
  fixture.tick(739); assert.deepEqual(fixture.finals, []);
  fixture.tick(1); assert.deepEqual(fixture.finals, ['A quiet but ongoing answer.']);
});

test('automatic recognition continuation reuses the stream, commits segment slots once, and ignores stale events', async () => {
  const fixture = setup(); await fixture.ready();
  const first = fixture.instances[0]; fixture.result(0, 'I build'); first.onend();
  fixture.result(0, 'I build', true, first); // A stale result must not be appended after end.
  fixture.tick(0);
  const second = fixture.instances[1]; second.onstart(); second.onaudiostart();
  assert.equal(second.calls.at(-1), fixture.processed);
  assert.equal(fixture.permissionCalls, 1); assert.equal(fixture.chimes, 1);
  fixture.tick(2900); second.onspeechstart(); fixture.result(0, 'useful voice agents'); second.onspeechend();
  fixture.tick(3000);
  assert.deepEqual(fixture.finals, ['I build useful voice agents']);
});

test('no speech stays ready; no-speech service endings continue without an empty submission', async () => {
  const fixture = setup(); await fixture.ready(); fixture.tick(10000);
  fixture.instances[0].onerror({ error: 'no-speech' }); fixture.instances[0].onend(); fixture.tick(0);
  fixture.instances[1].onstart(); fixture.instances[1].onaudiostart(); fixture.tick(5000);
  assert.equal(fixture.controller.phase, 'listening'); assert.deepEqual(fixture.finals, []);
  assert.equal(fixture.input.input.readyState, 'live'); fixture.controller.cancel();
});

test('manual pause cancels submission, preserves the whole draft and resumes only on request', async () => {
  const fixture = setup(); await fixture.ready(); fixture.result(0, 'My unsent thought'); fixture.tick(2900);
  assert.equal(fixture.controller.pause(), 'My unsent thought'); fixture.tick(20000);
  assert.deepEqual(fixture.finals, []); assert.equal(fixture.input.input.readyState, 'ended');
  assert.equal(fixture.instances.length, 1); assert.equal(fixture.controller.draft, 'My unsent thought');
  await fixture.ready(); fixture.tick(5000); assert.deepEqual(fixture.finals, []);
  fixture.instances[1].onspeechstart(); fixture.result(0, 'continues here'); fixture.instances[1].onspeechend();
  fixture.tick(3000); assert.deepEqual(fixture.finals, ['My unsent thought continues here']);
});

test('one configurable silence threshold controls the turn deadline', async () => {
  assert.equal(END_OF_TURN_SILENCE_MS, 3000);
  const fixture = setup({ silenceMs: 4100 }); await fixture.ready(); fixture.result(0, 'A configured turn');
  fixture.tick(4099); assert.deepEqual(fixture.finals, []);
  fixture.tick(1); assert.deepEqual(fixture.finals, ['A configured turn']);
});

test('a draft rejected by the submission layer remains available without an automatic retry', async () => {
  const fixture = setup({ accepted: false }); await fixture.ready();
  const text = 'An over-limit draft. '.repeat(500);
  fixture.result(0, text); fixture.tick(3000);
  assert.equal(fixture.controller.draft, text.trim());
  fixture.tick(10000); assert.equal(fixture.finals.length, 1);
  assert.equal(fixture.controller.active, false);
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

test('pausing releases raw and processed tracks and ignores late speech without restarting capture', async () => {
  const fixture = setup(); await fixture.ready();
  const recognition = fixture.instances[0];
  fixture.controller.cancel();
  assert.equal(fixture.input.input.readyState, 'ended');
  assert.equal(fixture.processed.readyState, 'ended');
  assert.equal(recognition.aborted, true);
  const result = [{ transcript: 'Do not submit speech after pausing' }]; result.isFinal = true;
  recognition.onresult({ resultIndex: 0, results: [result] });
  recognition.onend(); await flush();
  assert.equal(fixture.controller.active, false);
  assert.equal(fixture.permissionCalls, 1);
  assert.equal(fixture.instances.length, 1);
  assert.deepEqual(fixture.finals, []);
});
