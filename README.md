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

The `voice100x` Worker serves the site and routes live questions through the OpenAI Responses API. Workers Builds uses the root of this repo, with `npm run check` as the build command and `npm run deploy` as the deploy command. The production branch is `main`. For a manual deployment, authenticate the Cloudflare CLI for the same account, then run `npm run deploy`.

## Live interview

Set `OPENAI_API_KEY` as an encrypted secret on the Worker to enable live replies. The page shows five thinking-effort labels, and the Worker controls which options are available and routes each one. With no key, the app uses illustrative sample replies. Sol style and Juniper style use available English device voices. Dictation uses the browser's speech recognition service when available.

An optional `INTERVIEW_PROFILE` secret can supply a short, approved Markdown profile. Conversation state stays in tab memory. Live replies send the current question and up to six recent messages to OpenAI, with response storage disabled on the API request.

## Design references

- [DayPilot](https://github.com/dumpydon/daypilot) for the workspace and animated signal rails.
- [Limit X Pixel Curtain Bundle](https://github.com/dumpydon/useful-things-elements/blob/main/LIMITX_PIXEL_CURTAIN_BUNDLE.md) for the fixed canvas reveal. The curtain uses DayPilot’s cell geometry, Simplex field, and timing. Times New Roman reproduces the serif lettering in the DayPilot reference capture.
- [100x](https://www.linkedin.com/company/100xinc/) for the coral, black, and white palette. The site logo and favicon use the original glowing W/X artwork.
- [Geist](https://github.com/vercel/geist-font), licensed under the [SIL Open Font License](public/fonts/OFL.txt).
