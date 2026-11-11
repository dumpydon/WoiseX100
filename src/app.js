import { createEffortPicker } from './effort-picker.js';
import { previewReply, questions } from './preview.js';
import { startMotion } from './motion.js';

const $ = (selector) => document.querySelector(selector);
const workspace = $('#interview');
const form = $('#composer');
const questionInput = $('#question');
const send = $('#send');
const sidebar = $('#sidebar');
const menu = $('#menu');
const scrim = $('#scrim');
const chatPanel = $('#chat-panel');
const log = $('#chat-log');
const voiceStage = $('#voice-stage');
const listen = $('#listen');
const voiceStatus = $('#voice-status');
const voiceHint = $('#voice-hint');
const effortPicker = createEffortPicker($('#effort-picker'));
const replyIndicator = $('#reply-status');
const runtimeIndicator = $('#runtime-status');
const runtimeName = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname) ? 'Local runtime' : 'Cloudflare Backend';
const replyStates = {
  live: { label: 'OpenAI live', state: 'ready' },
  sample: { label: 'Preview mode', state: 'preview' },
  limited: { label: 'Replies paused', state: 'preview' },
  unavailable: { label: 'Replies unavailable', state: 'error' },
};
const toneSelectors = [...document.querySelectorAll('[data-voice-select]')];
const smallScreen = matchMedia('(max-width: 680px)');
const Recognition = window.SpeechRecognition ?? window.webkitSpeechRecognition;
const synthesis = window.speechSynthesis;
const tones = {
  sol: { voices: /samantha|karen|susan|sara/i, pitch: 1, rate: 0.96 },
  juniper: { voices: /ava|tessa|zira|moira/i, pitch: 1.12, rate: 1.05 },
};

let tone = 'sol';
let voiceMode = false;
let recognition = null;
let speech = null;
let activeReply = null;
let history = [];

function updateRuntimeStatus(ready) {
  runtimeIndicator.dataset.state = ready ? 'ready' : 'error';
  $('#runtime-mode').textContent = ready ? runtimeName : 'Runtime unavailable';
}

function updateReplyStatus(mode) {
  const { label, state } = replyStates[mode];
  replyIndicator.dataset.state = state;
  $('#app-mode').textContent = label;
  $('#reply-mode').textContent = mode === 'sample' ? 'Sample replies' : label;
}

const connection = fetch('/api/status', { cache: 'no-store', signal: AbortSignal.timeout(6000) })
  .then(async (response) => {
    if (!response.ok) throw new Error('Status unavailable');
    const status = await response.json();
    if (typeof status.live !== 'boolean') throw new Error('Invalid status');
    $('#owner-profile-status').textContent = status.profile === 'ready'
      ? 'Connected. Answers can draw on Piyush’s background and work.'
      : status.profile === 'unavailable'
        ? 'Temporarily unavailable. The owner needs to check the profile.'
        : 'The owner has not connected a profile yet.';
    effortPicker.configure(status.live);
    const mode = status.live ? 'live' : 'sample';
    updateRuntimeStatus(true);
    updateReplyStatus(mode);
    return mode;
  })
  .catch(() => {
    $('#owner-profile-status').textContent = 'The profile status could not be checked. Refresh to reconnect.';
    updateRuntimeStatus(false);
    updateReplyStatus('unavailable');
    return 'unavailable';
  });

function icon(name) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  const use = document.createElementNS(svg.namespaceURI, 'use');
  svg.classList.add('icon');
  svg.setAttribute('aria-hidden', 'true');
  use.setAttribute('href', '#' + name);
  svg.append(use);
  return svg;
}

function setSidebar(open, restoreFocus = true) {
  const wasOpen = sidebar.classList.contains('is-open');
  sidebar.classList.toggle('is-open', open);
  scrim.hidden = !open;
  menu.setAttribute('aria-expanded', String(open));
  for (const part of document.querySelectorAll('.topbar, .workspace, .footer, .skip-link')) {
    part.inert = open;
  }
  if (open) $('#close-sidebar').focus();
  else if (wasOpen && restoreFocus && smallScreen.matches) menu.focus();
}

function addPrompt({ title, prompt }, container, chip = false) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = chip ? 'prompt-chip' : 'prompt-button';
  button.title = prompt;
  button.append(title, icon('i-up-right'));
  button.addEventListener('click', () => {
    if (submitQuestion(prompt)) setSidebar(false);
  });
  container.append(button);
}

for (const [index, question] of questions.entries()) {
  addPrompt(question, $('#side-prompts'));
  if (index < 3) addPrompt(question, $('#quick-prompts'), true);
}

function renderView() {
  const hasMessages = log.childElementCount > 0;
  workspace.dataset.view = voiceMode ? 'voice' : hasMessages ? 'chat' : 'welcome';
  voiceStage.hidden = !voiceMode;
  chatPanel.hidden = !hasMessages;
}

function updateComposer() {
  questionInput.style.height = '0px';
  questionInput.style.height = Math.min(questionInput.scrollHeight, 126) + 'px';
  send.disabled = !questionInput.value.trim() || activeReply !== null;
}

function updateVoice(state, status, hint = '') {
  voiceStage.dataset.state = state;
  voiceStatus.textContent = status;
  voiceHint.textContent = hint;
  const listening = state === 'listening' || state === 'starting';
  const label = listening ? 'Stop listening' : 'Start listening';
  listen.replaceChildren(icon(listening ? 'i-stop' : 'i-mic'));
  listen.setAttribute('aria-label', label);
  listen.title = label;
  listen.disabled = state === 'thinking';
}

function readyVoice(hint = Recognition ? 'Tap the mic to ask a question.' : 'Speech input is unavailable here. You can type below and hear the reply.') {
  updateVoice('ready', 'Ready to talk', hint);
}

function showVoice(open, restoreFocus = true) {
  voiceMode = open;
  if (open) {
    if (activeReply === null) readyVoice();
    else updateVoice('thinking', 'Preparing a reply…', 'Your question is in the transcript.');
  } else {
    cancelListening();
    stopSpeech();
  }
  renderView();
  if (open) {
    voiceStage.scrollIntoView({ block: 'nearest' });
    (listen.disabled ? $('#end-voice') : listen).focus({ preventScroll: true });
  }
  else if (restoreFocus) $('#open-voice').focus({ preventScroll: true });
}

function setReplay(button, playing) {
  if (!button) return;
  button.setAttribute('aria-pressed', String(playing));
  button.replaceChildren(icon(playing ? 'i-stop' : 'i-play'), playing ? 'Stop audio' : 'Play reply');
}

function stopSpeech() {
  if (!speech) return;
  setReplay(speech.button, false);
  speech = null;
  synthesis.cancel();
}

function speak(text, button) {
  const wasPlaying = speech && speech.button === button;
  stopSpeech();
  if (wasPlaying) {
    if (voiceMode) readyVoice();
    return;
  }
  const voices = synthesis?.getVoices().filter((voice) => voice.localService && /^en(?:-|$)/i.test(voice.lang));
  if (!voices?.length) {
    if (voiceMode) readyVoice('This device hasn’t provided an English speech voice. The reply is in the transcript.');
    else if (button) button.textContent = 'Device voice unavailable';
    return;
  }
  cancelListening();
  const preset = tones[tone];
  const utterance = new SpeechSynthesisUtterance(text);
  const defaultVoice = voices.find((voice) => voice.default) ?? voices[0];
  utterance.voice = voices.find((voice) => preset.voices.test(voice.name)) ?? defaultVoice;
  utterance.lang = utterance.voice.lang;
  utterance.rate = preset.rate;
  utterance.pitch = preset.pitch;
  speech = { utterance, button };
  setReplay(button, true);
  if (voiceMode && activeReply === null) updateVoice('speaking', 'Speaking', 'Read along in the transcript below.');
  const finish = (failed) => {
    if (speech?.utterance !== utterance) return;
    setReplay(button, false);
    speech = null;
    if (voiceMode && activeReply === null) readyVoice(failed ? 'Audio playback was interrupted. You can play the reply again.' : undefined);
  };
  utterance.onend = () => finish(false);
  utterance.onerror = () => finish(true);
  synthesis.speak(utterance);
}

function appendMessage(author, text, mode) {
  const message = document.createElement('article');
  message.className = 'message message-' + author;
  const label = document.createElement('div');
  label.className = 'message-label';
  label.textContent = author === 'user' ? 'You' : 'WoiseX100';
  const body = document.createElement('p');
  body.className = 'message-text';
  body.textContent = text;
  message.append(label, body);

  let replay;
  if (author === 'agent') {
    if (mode === 'sample') {
      const sampleLabel = document.createElement('span');
      sampleLabel.className = 'sample-label';
      sampleLabel.textContent = 'Sample reply';
      label.append(sampleLabel);
    }
    replay = document.createElement('button');
    replay.className = 'replay';
    replay.type = 'button';
    setReplay(replay, false);
    replay.addEventListener('click', () => speak(text, replay));
    message.append(replay);
  }
  log.append(message);
  return replay;
}

function submitQuestion(value) {
  const text = value.trim().slice(0, 1000);
  if (!text || activeReply !== null) return false;

  cancelListening();
  stopSpeech();
  appendMessage('user', text);
  const pending = document.createElement('p');
  pending.className = 'pending';
  pending.textContent = 'Preparing a reply…';
  const job = { text, pending, effort: effortPicker.value, controller: new AbortController() };
  activeReply = job;
  log.append(pending);
  renderView();
  log.scrollTop = log.scrollHeight;
  if (voiceMode) updateVoice('thinking', pending.textContent, 'Your question is in the transcript.');
  void completeReply(job);
  updateComposer();
  return true;
}

async function fetchReply(messages, effort, signal) {
  let response;
  try {
    response = await fetch('/api/reply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages, effort }),
      signal,
    });
  } catch {
    const error = new Error('Couldn’t reach WoiseX100. Try again.');
    error.runtimeAvailable = false;
    throw error;
  }
  const data = await response.json().catch(() => null);
  if (!response.ok || typeof data?.text !== 'string') {
    const error = new Error(data?.error ?? 'The reply couldn’t load. Try again.');
    error.runtimeAvailable = true;
    error.status = response.status;
    throw error;
  }
  return data.text;
}

async function completeReply(job) {
  let mode;
  let response;
  const user = { role: 'user', content: job.text };
  try {
    mode = await connection;
    if (activeReply !== job) return;
    if (mode === 'unavailable') throw new Error('Replies are unavailable. Refresh the page to reconnect.');
    response = mode === 'live'
      ? await fetchReply([...history, user], job.effort ?? effortPicker.value, job.controller.signal)
      : previewReply(job.text);
  } catch (error) {
    if (activeReply !== job) return;
    activeReply = null;
    if (mode === 'live') {
      updateReplyStatus(error.status === 429 ? 'limited' : 'unavailable');
      updateRuntimeStatus(error.runtimeAvailable);
    }
    job.pending.className = 'reply-error';
    job.pending.textContent = error.message;
    if (!questionInput.value) questionInput.value = job.text;
    if (voiceMode) readyVoice(error.message);
    log.scrollTop = log.scrollHeight;
    updateComposer();
    return;
  }
  if (activeReply !== job) return;
  activeReply = null;
  job.pending.remove();
  updateRuntimeStatus(true);
  updateReplyStatus(mode);
  history = [...history, user, { role: 'assistant', content: response.slice(0, 1200) }].slice(-6);
  const replay = appendMessage('agent', response, mode);
  log.scrollTop = log.scrollHeight;
  updateComposer();
  if (voiceMode) speak(response, replay);
}

function resetConversation() {
  activeReply?.controller.abort();
  activeReply = null;
  history = [];
  effortPicker.close();
  log.replaceChildren();
  questionInput.value = '';
  showVoice(false, false);
  updateComposer();
  setSidebar(false);
  window.scrollTo({ top: 0, behavior: 'instant' });
  if (!smallScreen.matches) questionInput.focus({ preventScroll: true });
}

function cancelListening() {
  if (!recognition) return;
  const current = recognition;
  recognition = null;
  current.abort();
}

function listenOnce() {
  if (recognition) {
    const current = recognition;
    current.stop();
    updateVoice('starting', 'Finishing dictation…');
    listen.disabled = true;
    return;
  }
  if (!Recognition) {
    readyVoice('Speech input is unavailable in this browser. Type below to continue.');
    return;
  }
  stopSpeech();
  const current = new Recognition();
  recognition = current;
  current.lang = 'en-US';
  current.continuous = false;
  current.interimResults = true;
  current.onstart = () => {
    if (recognition === current) updateVoice('listening', 'Listening…', 'Ask one interview question.');
  };
  current.onresult = (event) => {
    if (recognition !== current) return;
    const result = event.results[event.resultIndex];
    const text = result[0].transcript.trim();
    if (result.isFinal && text) {
      recognition = null;
      submitQuestion(text);
    } else if (text) {
      voiceHint.textContent = text;
    }
  };
  current.onerror = ({ error }) => {
    if (recognition !== current) return;
    recognition = null;
    const hints = {
      'not-allowed': 'Microphone access was denied. You can allow it in your browser settings or type below.',
      'service-not-allowed': 'Speech recognition is unavailable here. Type below to continue.',
      'audio-capture': 'No microphone is available. Type below to continue.',
      'no-speech': 'No speech was heard. Try the mic again or type below.',
      network: 'The browser speech service is unavailable. Type below to continue.',
    };
    readyVoice(hints[error] ?? 'Dictation ended. You can try again or type below.');
  };
  current.onend = () => {
    if (recognition !== current) return;
    recognition = null;
    readyVoice();
  };
  try {
    updateVoice('starting', 'Opening the microphone…', 'Allow access if your browser asks.');
    current.start();
  } catch {
    recognition = null;
    readyVoice('The microphone couldn’t start. You can type below to continue.');
  }
}

form.addEventListener('submit', (event) => {
  event.preventDefault();
  if (submitQuestion(questionInput.value)) {
    questionInput.value = '';
    updateComposer();
  }
});
questionInput.addEventListener('input', updateComposer);
questionInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    form.requestSubmit();
  }
});
$('#open-voice').addEventListener('click', () => showVoice(true));
$('#end-voice').addEventListener('click', () => showVoice(false));
listen.addEventListener('click', listenOnce);
$('#new-conversation').addEventListener('click', resetConversation);
menu.addEventListener('click', () => setSidebar(true));
$('#close-sidebar').addEventListener('click', () => setSidebar(false));
scrim.addEventListener('click', () => setSidebar(false));
smallScreen.addEventListener('change', () => setSidebar(false));
window.addEventListener('pagehide', () => {
  activeReply?.controller.abort();
  cancelListening();
  stopSpeech();
});
document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape' || document.querySelector('dialog[open]')) return;
  if (effortPicker.close(true)) return;
  if (sidebar.classList.contains('is-open')) setSidebar(false);
  else if (voiceMode) showVoice(false);
});

for (const selector of toneSelectors) {
  selector.addEventListener('change', () => {
    tone = selector.value;
    voiceStage.dataset.tone = tone;
    for (const other of toneSelectors) other.value = tone;
  });
}
for (const button of document.querySelectorAll('[data-open]')) {
  button.addEventListener('click', () => document.getElementById(button.dataset.open).showModal());
}
for (const dialog of document.querySelectorAll('dialog')) {
  dialog.querySelector('.dialog-close').addEventListener('click', () => dialog.close());
}

synthesis?.getVoices();
updateComposer();
startMotion(workspace, form);
