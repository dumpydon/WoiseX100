# WoiseX100

A voice and text interview app for the 100x AI Agent assessment. Visitors can try five assessment questions, type their own, and open voice mode to dictate a question and hear the reply. The transcript stays in tab memory and clears on refresh or **New conversation**.

[Open the hosted preview](https://voice100x.dumpydon.workers.dev/)

## Run locally

Use the Node version in `.node-version`.

```sh
npm ci
npm run dev
```

Open [the local preview](http://127.0.0.1:4173). Run `npm run check` for JavaScript syntax checks and `npm run deploy -- --dry-run` to validate the Cloudflare build locally.

## Cloudflare deployment

The `voice100x` Worker serves the site and routes live questions through the OpenAI Responses API. Workers Builds uses the root of this repo, with `npm run check && npm test` as the build command and `npm run deploy` as the deploy command. The production branch is `main`. For a manual deployment, authenticate the Cloudflare CLI for the same account, then run `npm run deploy`.

## Live interview

Set `OPENAI_API_KEY` as an encrypted secret on the Worker to enable live replies. It is declared in `cloudflare.config.ts`; local development can read it from the process environment or a private environment file. The page shows five thinking-effort labels, and the Worker controls which options are available and routes each one. With no key, the app displays an interface-preview notice without inventing personal answers. Speech defaults to **Natural — OpenAI Voice**, using only `tts-1` with Nova initially selected. **Fast — Device Voice** is an explicit alternative listing the device's actual voices. Dictation uses the browser's speech recognition service when available.

Opening Voice mode requests the microphone immediately. Once recognition and audio capture are ready, a single original 400 ms rising chime accompanies the orb's activation pulse, followed by microphone-level animation. Interface sounds can be switched off and that preference is stored locally. Supported browsers receive an echo-cancelled, temporarily note-filtered microphone track; the input is never muted or time-gated around the cue. Browsers that cannot accept the protected track listen silently with the visual cue. Permission/service errors stop capture without automatic retry loops. Closing voice mode releases tracks, and hands-free listening resumes after a spoken answer unless the user pauses it.

The coral-and-cream orb uses independently flowing colour regions and a smooth, restrained contour. `src/voice-orb.js` connects opening/idle, listening, processing, speaking, and mic-off states. Listening uses real microphone levels with a fast attack, slower release, and a noise floor. OpenAI playback supplies actual output levels through Web Audio when available; device speech uses a subtle state animation, explicitly marked `state-animation` rather than claimed voice synchronization. Reduced-motion mode keeps a static gradient and state glow. Rendering pauses when hidden or closed; microphone tracks and analysis are released by the existing voice lifecycle.

The whole orb and its microphone badge form one native button. Click, Enter, or Space pauses capture immediately and disables hands-free restart until an explicit resume. The separate mic button follows the same state. Pausing preserves the transcript, pending answer, and current audio playback. Resuming during a reply waits for playback to finish before opening the microphone; opening, permission failures, and an intentional pause have distinct indicators. Tooltips describe the next action, and a live region announces state changes without reporting fluctuating levels.

Microphone RMS measurements drive a continuous 100–115% scale response, passing approximately 110% for quiet speech and 112.5% for normal speech. The scale envelope expands in about 100 ms and settles over roughly 400 ms; activation and breathing share the same capped transform. Low ambient levels are excluded by an adaptive noise gate. Without analysable microphone audio, the listening indicator still works but does not invent volume levels. Paused fluid motion decelerates, the halo softens, and a single outward ripple accompanies the slashed-mic badge. Reduced motion keeps a static orb with state icons. `tests/voice-browser.html` supplies synthetic mic levels, delayed permissions, and a held reply for local interaction checks without recording the room.

Spoken turns use the single `END_OF_TURN_SILENCE_MS = 3000` setting in `src/voice-input.js` (overridable through `silenceMs`). Recognition runs continuously, and the owned microphone stream stays live across shorter pauses and normal recognition-session endings. Speech events and the existing audio graph's gated activity measurements cancel or restart the silence timer; generic sound events do not. The last voiced frame anchors the deadline so delayed transcription results do not extend it. No countdown appears in the UI: the orb stays listening and settles toward base size during silence.

Final transcript segments replace indexed slots instead of sending a question. Normal recognizer endings freeze those slots and reconnect using the same processed track, with no new permission request or chime; stale events from an earlier recognizer are ignored. At the silence deadline, complete final segments submit once. If only an interim remains, the service gets a bounded final-result flush after the full pause allowance. This flush does not substitute for live capture during the three seconds. Manual pause cancels the timer and releases capture immediately, retaining the unsent turn in the composer; explicit resume can continue that draft. Healthy empty listening sessions do not submit or time out merely because the user has not spoken. Browser speech-service failures retain the draft and show a retry action.

Questions now have a shared 8,000-character limit in `src/message-limits.js`; the previous 1,000-character client truncation is removed so combined spoken segments are not silently cut. An over-limit draft stays available for editing. The backend accepts the same question limit and bounded UTF-8 request bodies. [Web Speech continuous recognition](https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition/continuous) and [cumulative recognition results](https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognitionEvent/results) describe the browser behavior this controller handles.

## Speech playback

The [speech implementation guide](docs/speech-playback.md) covers settings, caching, character budgets, and deployment. Provision a random `TTS_SESSION_SECRET` as an encrypted Worker secret in addition to the existing API key. Two SQLite-backed Durable Object exports maintain persistent character accounting and cache generated audio; deployment provisions their bindings. Local serving can load the signing secret from the ignored `.private/tts-session-secret.txt` file.

**TTS-1 is scheduled to shut down on January 6, 2027.** The adapter refuses generation from that date and never migrates to another paid model automatically. The developer must explicitly review a replacement or retain Device Voice.

A legacy `INTERVIEW_PROFILE` secret can supply a small profile. For the complete profile, keep one local master Markdown file in `.private/woisex100-profile.md`, with interview material between `<!-- woisex100:runtime:start -->` and `<!-- woisex100:runtime:end -->`. Place source paths, conflicts, and private review notes outside that section. Run `npm run profile:prepare` to create private runtime material and a bindings file, then restart the local dev server to load a changed profile. The script does not contact remote services or copy an API key.

The runtime profile is bounded to 64 KiB and split into UTF-8-safe parts of at most 4,500 bytes, below Cloudflare's documented 5 KB per-variable limit. `INTERVIEW_PROFILE_MANIFEST` records the part count and SHA-256 digest; `INTERVIEW_PROFILE_1` and subsequent numbered bindings contain the data. The Worker rejects incomplete or mixed revisions instead of silently truncating the profile. For a later production release, provision the generated values as encrypted Worker secrets; keep all values out of version control. The existing GitHub-triggered build can preserve runtime secrets, but a Git push alone does not publish a changed local profile.

The current deployment declares the manifest and seven profile parts as required secrets. If a later profile changes the number of parts, update those declarations together with the encrypted profile revision. The legacy reader remains available for older installations; this deployment uses the multipart profile.

Vite loads `.private/profile-bindings.json` only for local serving, never for production builds, and blocks HTTP access to `.private` files. The entire directory is ignored by Git. Conversation state stays in tab memory. Live replies send the server-owned interview reference, the current question, and up to six recent messages to OpenAI, with response storage disabled on the API request. `/api/status` exposes only readiness, not profile contents.

The interview behavior in `src/interview-instructions.js` generates natural answers and grounded interpretations from the approved profile. New technical questions and hypothetical scenarios can use general knowledge. Missing personal facts remain unknown, and visitor messages cannot rewrite the biography. Difficult questions should receive a direct, confident answer supported by a relevant example. This configures the existing models through instructions and context; it does not run a training or fine-tuning job.

Personal-answer instructions reserve at least 60% for the candidate and cap supporting examples/justification at 40%, with a much shorter optional example to leave headroom. Project names receive a brief parenthetical introduction on their first mention in each response. Project-focused technical questions can still receive the detail requested. The profile examples and response evaluations follow the same presentation rules.

Run `npm test` for profile assembly, privacy-boundary, and reply transport checks. The synthetic scenarios in [the interview behavior checks](docs/interview-behavior-checks.md) provide a separate review rubric for actual model answers. A successful JavaScript check, transport fixture, or build does not establish that the model passes those scenarios.

The [hosted verification record](docs/hosted-verification.md) documents production endpoint, browser, and model-response coverage. `scripts/evaluate-interview.mjs` supports a local or hosted target through `WOISE_EVAL_URL`, saves a checkpoint after every response, and keeps raw reports private.

## Design references

- [DayPilot](https://github.com/dumpydon/daypilot) for the workspace and animated signal rails.
- [Limit X Pixel Curtain Bundle](https://github.com/dumpydon/useful-things-elements/blob/main/LIMITX_PIXEL_CURTAIN_BUNDLE.md) for the fixed canvas reveal. The curtain uses DayPilot’s cell geometry, Simplex field, and timing. Times New Roman reproduces the serif lettering in the DayPilot reference capture.
- [100x](https://www.linkedin.com/company/100xinc/) for the coral, black, and white palette. The site logo and favicon use the original glowing W/X artwork.
- [Geist](https://github.com/vercel/geist-font), licensed under the [SIL Open Font License](public/fonts/OFL.txt).
