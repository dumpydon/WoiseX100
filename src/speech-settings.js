import { OPENAI_VOICES, UNAVAILABLE_VOICES, SPEECH_SPEEDS } from './speech-config.js';
const title = value => value[0].toUpperCase() + value.slice(1);

export function createSpeechSettings({ storage, synthesis, onChange = () => {} }) {
  const read = key => { try { return storage?.getItem('woisex100:' + key); } catch { return null; } };
  const save = (key, value) => { try { storage?.setItem('woisex100:' + key, value); } catch { /* Session preference remains usable. */ } };
  let provider = read('playback') === 'device' ? 'device' : 'openai';
  const savedVoice = read('openai-voice');
  let voice = [...OPENAI_VOICES, ...UNAVAILABLE_VOICES].includes(savedVoice) ? savedVoice : 'nova';
  let deviceVoice = read('device-voice') ?? '';
  let speed = SPEECH_SPEEDS.includes(Number(read('speech-speed'))) ? Number(read('speech-speed')) : 1;
  const groups = [...document.querySelectorAll('[data-speech-settings]')];
  const voices = () => synthesis?.getVoices() ?? [];

  function render() {
    const available = voices();
    if (!deviceVoice && available.length) deviceVoice = (available.find(item => item.default && /^en\b/i.test(item.lang)) ?? available.find(item => item.localService && /^en\b/i.test(item.lang)) ?? available[0]).voiceURI;
    for (const group of groups) {
      group.querySelector('[data-playback-provider]').value = provider;
      const select = group.querySelector('[data-speech-voice]');
      select.replaceChildren();
      if (provider === 'openai') {
        for (const value of [...OPENAI_VOICES, ...UNAVAILABLE_VOICES]) {
          const option = new Option(title(value) + (['echo', 'ash', 'onyx'].includes(value) ? ' (male)' : '') + (UNAVAILABLE_VOICES.includes(value) ? ' — Unavailable with TTS-1' : ''), value);
          option.disabled = UNAVAILABLE_VOICES.includes(value); select.append(option);
        }
        select.value = voice;
      } else {
        for (const item of available) select.append(new Option(`${item.name} (${item.lang})`, item.voiceURI));
        if (!available.some(item => item.voiceURI === deviceVoice)) {
          const option = new Option(deviceVoice ? 'Saved device voice unavailable' : 'Device voices are loading…', deviceVoice);
          option.disabled = true; select.append(option);
        }
        select.value = deviceVoice;
      }
      group.querySelector('[data-speech-speed]').value = String(speed);
      group.querySelector('[data-speech-helper]').textContent = provider === 'device'
        ? 'Uses your device’s voices; sound quality and speed vary by device.'
        : UNAVAILABLE_VOICES.includes(voice) ? 'Unavailable with TTS-1. Choose an enabled voice.' : 'Preview a voice to choose your preferred sound.';
      group.querySelector('[data-voice-preview]').disabled = provider === 'openai' && !OPENAI_VOICES.includes(voice);
    }
  }
  const changed = () => { render(); onChange(); };
  for (const group of groups) {
    group.querySelector('[data-playback-provider]').addEventListener('change', event => { provider = event.target.value; save('playback', provider); changed(); });
    group.querySelector('[data-speech-voice]').addEventListener('change', event => {
      if (provider === 'openai') { voice = event.target.value; save('openai-voice', voice); }
      else { deviceVoice = event.target.value; save('device-voice', deviceVoice); }
      changed();
    });
    group.querySelector('[data-speech-speed]').addEventListener('change', event => { speed = Number(event.target.value); save('speech-speed', String(speed)); changed(); });
  }
  synthesis?.addEventListener('voiceschanged', render);
  render();
  return {
    get value() { return { provider, voice, deviceVoice, speed }; },
    useDevice() { provider = 'device'; save('playback', provider); changed(); },
  };
}
