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

Set `OPENAI_API_KEY` as an encrypted secret on the Worker to enable live replies. It is declared in `cloudflare.config.ts`; local development can read it from the process environment or a private environment file. The page shows five thinking-effort labels, and the Worker controls which options are available and routes each one. With no key, the app displays an interface-preview notice without inventing personal answers. Sol style and Juniper style use available English device voices. Dictation uses the browser's speech recognition service when available.

Opening Voice mode requests the microphone immediately. Once recognition and audio capture are ready, a single original 400 ms rising chime accompanies the orb's activation pulse, followed by microphone-level animation. Interface sounds can be switched off and that preference is stored locally. Supported browsers receive an echo-cancelled, temporarily note-filtered microphone track; the input is never muted or time-gated around the cue. Browsers that cannot accept the protected track listen silently with the visual cue. Permission/service errors stop capture without automatic retry loops. Closing voice mode releases tracks, and hands-free listening resumes after a spoken answer unless the user pauses it.

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
