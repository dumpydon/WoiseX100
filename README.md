# WoiseX100

A voice and text interview preview for the 100x AI Agent assessment. Visitors can try five assessment questions, type their own, and open voice mode to dictate a question and hear a sample reply. The transcript stays in tab memory and clears on refresh or **New conversation**.

[Open the hosted preview](https://voice100x.dumpydon.workers.dev/)

## Run locally

Use the Node version in `.node-version`.

```sh
npm ci
npm run dev
```

Open [the local preview](http://127.0.0.1:4173). Run `npm run check` for JavaScript syntax checks and `npm run deploy -- --dry-run` to validate the Cloudflare build locally.

## Cloudflare deployment

The `voice100x` Worker serves static assets. Workers Builds uses the root of this repo, with `npm run check` as the build command and `npm run deploy` as the deploy command. The production branch is `main`. For a manual deployment, authenticate the Cloudflare CLI for the same account, then run `npm run deploy`.

## Live interview

The current replies are illustrative samples. Sol style and Juniper style are preview presets that use available English device voices. Speech input uses the browser's recognition API when available, which may use the browser's speech service. Text remains available in any browser.

For the live interview, the same Worker can serve text, transcription, and speech endpoints with an `OPENAI_API_KEY` Worker secret. Both modes can share the answer generator. Start with a short, approved interview profile and use retrieval over approved Markdown if the source material grows. Keep the owner editor authenticated and keep conversation state in tab memory.

## Design references

- [DayPilot](https://github.com/dumpydon/daypilot) for the workspace and animated signal rails.
- [Limit X Pixel Curtain Bundle](https://github.com/dumpydon/useful-things-elements/blob/main/LIMITX_PIXEL_CURTAIN_BUNDLE.md) for the fixed canvas reveal. WoiseX100 adapts DayPilot’s Simplex field for the illuminated glyphs.
- [100x](https://www.linkedin.com/company/100xinc/) for the coral, black, and white palette. The WoiseX100 mark is an original W/X waveform drawn from an ImageGen concept.
- [Geist](https://github.com/vercel/geist-font), licensed under the [SIL Open Font License](public/fonts/OFL.txt).
