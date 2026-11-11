# Hosted verification — 11 November 2026

Target: https://voice100x.dumpydon.workers.dev/

The interview app and encrypted profile were released through the existing GitHub push trigger. The trigger now runs `npm run check && npm test` before `npm run deploy`. Private source exports, profile values, and raw evaluation responses are excluded from the repository.

## Recorded production checks

- Nineteen interview scenarios returned successful, nonempty replies through the production `/api/reply` endpoint. Coverage includes the five assessment questions, professional/project follow-ups, attribution, unresolved measurement details, company/remote-work motivation, general facts, and attempts to invent background or extract hidden instructions.
- All five effort settings were exercised. The deeper Max example took about 51 seconds; ordinary High examples in this run were generally around four to seven seconds. These are individual observations, not latency guarantees.
- Responses were manually reviewed for factual grounding and useful framing. The checks kept proposed improvements separate from existing features, distinguished non-AI work correctly, preserved unknown personal/measurement details, and corrected a fabricated earlier assistant statement.
- Eight malformed/misused API requests received their expected 400, 403, 405, or 415 responses. Five private/source resource paths returned 404. The status endpoint returned only readiness fields with `Cache-Control: no-store`.
- The normal eight-per-minute per-IP rate limit was encountered during rapid evaluation. The test runner waited and resumed successfully. It now saves each response immediately and retries transient network failures, so a connection interruption does not discard completed results.

## Browser checks

- The hosted page reports OpenAI live, Cloudflare Backend, and a connected interview profile.
- The default effort is High after refresh. Radio-keyboard selection and mouse dragging work, including the grabbing cursor and cleanup after release.
- Layouts were inspected at phone and desktop widths, with no horizontal document overflow. Sidebar navigation, profile status, footer links/icons, and modal closure were checked.
- A three-question conversation through the actual web UI retained the referent in “the second one” and produced the appropriate project follow-up. User questions and responses appeared in the shared transcript.
- Voice mode, both tone selections, actual device speech playback, the speaking state, and Stop audio were checked. Browser speech APIs and local English voices were available. Live microphone audio was not captured automatically; visitor microphone permission and the browser speech service remain part of real dictation use.
- Starting New conversation during a pending response cleared the conversation and canceled the active request in the UI. The state was checked again before the next interaction.

## Reproduce

```sh
WOISE_EVAL_URL=https://voice100x.dumpydon.workers.dev node scripts/evaluate-interview.mjs
```

This sends real questions through the deployed AI backend and can incur API usage. The normal rate limit applies. Private response reports are written under `.private/evaluations/`; inspect their contents rather than treating HTTP success alone as answer-quality validation. Optional trailing scenario IDs select a smaller affected subset.

These observations describe the tested version and inputs. They do not establish exhaustive model reliability, newly verified career claims, cross-browser microphone compatibility, or subjective audio quality.
