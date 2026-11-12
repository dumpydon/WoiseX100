// A lightweight acoustic guard alongside the browser's speech-specific events. Low energy,
// short clicks, sub-voice-frequency hum, and broad high-frequency noise do not sustain a turn.
export function createSpeechActivityDetector() {
  let candidateAt = null, lastVoiceAt = null, active = false;
  return {
    measure(samples, sampleRate, rms, noiseGate, timeMs) {
      let crossings = 0;
      for (let index = 1; index < samples.length; index += 1) if ((samples[index] >= 0) !== (samples[index - 1] >= 0)) crossings += 1;
      const frequency = crossings * sampleRate / (2 * samples.length);
      const voiced = rms > Math.max(.0025, noiseGate * 1.15) && frequency >= 70 && frequency <= 6000;
      if (voiced) {
        candidateAt ??= timeMs;
        if (timeMs - candidateAt >= 55) { active = true; lastVoiceAt = timeMs; }
      } else candidateAt = null;
      if (active && timeMs - lastVoiceAt >= 70) active = false;
      return { active, silenceForMs: lastVoiceAt === null ? Infinity : Math.max(0, timeMs - lastVoiceAt) };
    },
  };
}
