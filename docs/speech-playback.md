# Speech playback

## User behavior

The default provider is **Natural — OpenAI Voice**, using `tts-1` and initially Coral. Alloy, Ash, Coral, Echo, Fable, Onyx, Nova, Sage, and Shimmer are enabled. Ballad, Verse, Marin, and Cedar are visible but disabled with “Unavailable with TTS-1.” Sol and Juniper are not represented as API voices.

The provider, OpenAI voice, device voice, and conservative speed preference (0.9×, 1.0×, or 1.1×) are stored separately on the device. **Fast — Device Voice** lists actual browser voices. A missing saved voice produces a recoverable error instead of silently changing the voice. Previews use the same routing and accounting as assistant replies. All playback is labeled AI-generated.

Voice mode still activates browser dictation directly and retains the original activation chime. Audio playback pauses recognition to prevent the reply from being transcribed. The orb enters its speaking state when audio actually plays and reads the audio element's output through Web Audio when available. Device speech, or a browser that cannot provide analysable output, uses the documented subtle speaking-state animation.

An OpenAI error offers **Retry audio** and **Use Device Voice**. The provider changes only when the visitor explicitly chooses it. Stop cancels playback and its analysis immediately. An already accepted generation may finish filling the cache; stopping playback cannot undo or refund an upstream request.

## Backend and caching

- `GET /api/speech/config` establishes a signed, HttpOnly, SameSite visitor cookie and returns availability, supported choices, and the visitor's daily character usage.
- `POST /api/speech` accepts only text, an enabled voice, and a supported speed. The backend alone calls OpenAI with `model: "tts-1"` and MP3 output. It sends no unsupported style instructions and uses no other speech model.
- Long replies are split at word boundaries into at most 4,000 Unicode characters per request. Identical normalized text, model, voice, and speed share one content hash and one generation job.
- `SpeechJob` is a SQLite Durable Object per content hash. It deduplicates in-flight generation, streams audio to the caller, and keeps bounded audio chunks for 24 hours by default. A persisted generation lease prevents an immediate duplicate after an actor restart.
- `SpeechQuota` is a small SQLite Durable Object per visitor, hashed IP, or global budget. Reservations prevent concurrent requests from overspending. It does not handle audio.
- The browser uses MediaSource MP3 streaming where supported and buffered Blob playback elsewhere. Its bounded in-memory cache supports replay without another generation. Server cache hits also do not incur a new TTS charge. Both caches remain private to the application; there is no public audio-object URL or raw-text log.

## Usage limits and cost estimates

`cloudflare.config.ts` configures the following defaults. Limits reset at midnight UTC.

| Binding | Default | Purpose |
| --- | ---: | --- |
| `TTS_USER_DAILY_CHARACTERS` | 12,000 | Per signed visitor |
| `TTS_IP_DAILY_CHARACTERS` | 24,000 | IP backstop |
| `TTS_GLOBAL_DAILY_CHARACTERS` | 200,000 | Total daily generation ceiling |
| `TTS_PRICE_PER_MILLION` | 15 | Internal USD estimate per million characters |
| `TTS_CACHE_SECONDS` | 86,400 | Generated audio retention |

There is also a 20-request-per-minute speech limit per hashed IP and an 8 MiB limit per generated clip. Setting a daily character limit to zero prevents new generation under that budget; existing cached audio remains playable.

The visitor is anonymous, not a verified account. Clearing cookies creates a new identity, so IP and global budgets provide additional spend protection. IP addresses are HMAC-hashed using `TTS_SESSION_SECRET`; raw IPs are not stored in the ledger. An API key alone is insufficient to enable this endpoint: the signing secret and both Durable Object bindings must also exist.

The ledger counts Unicode input characters submitted for generation once, including previews. Explicit upstream 4xx rejections release the reservation. Ambiguous network errors, 5xx responses, and interrupted streams retain a conservative submitted estimate because the provider may have accepted the work. The estimate is not an invoice reconciliation. At the configured $15 rate, 12,000 characters estimates $0.18, and 200,000 estimates $3.00; Cloudflare usage is separate.

## Deployment and replacement deadline

Before deploying, provision `TTS_SESSION_SECRET` with a cryptographically random value as an encrypted Worker secret. Preserve the existing `OPENAI_API_KEY` and interview-profile secrets. Do not commit either secret or the private interview profile. Local development reads its signing secret from the ignored `.private` file; production builds do not embed it. The `SpeechQuota` and `SpeechJob` exports and bindings are declared in `cloudflare.config.ts`.

**OpenAI lists January 6, 2027 as the TTS-1 shutdown date.** `src/tts-one-provider.js` is the explicit replacement boundary. It stops new generation from that date (or when `TTS_ENABLED` is `"false"`) and returns a clear unavailability error. Do not automatically switch to another paid model. Review the replacement's supported voices, price, controls, and disclosure before changing the adapter. Device Voice remains an explicit user choice.

Primary references: [text-to-speech guide](https://developers.openai.com/api/docs/guides/text-to-speech), [speech endpoint](https://developers.openai.com/api/reference/resources/audio/subresources/speech/methods/create), [TTS-1 model and pricing](https://developers.openai.com/api/docs/models/tts-1), and [deprecations](https://developers.openai.com/api/docs/deprecations).
