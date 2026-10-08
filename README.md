# voice-to-warehouse

Innovation Challenge Project

## Live voice transcription

The React frontend streams microphone audio to ElevenLabs Scribe v2 Realtime.
Choose English or German, press the microphone, and allow microphone access.
Live subtitles appear below the microphone, with the full transcript underneath.
Stop recording before changing language. Each new recording starts a fresh
transcript; stopping retains the current text. Lighter text is an interim result.

### Local setup

1. Run `npm install` (Node 24+, npm 11+).
2. Copy `apps/api/.env.example` to `apps/api/.env` and set
   `ELEVENLABS_API_KEY` to an ElevenLabs key with realtime speech-to-text access.
   Keep this key on the server; never use a `VITE_` environment variable for it.
3. Run `npm run dev` and open <http://127.0.0.1:3000>. The backend runs on
   <http://127.0.0.1:3001>.

The frontend requests a single-use token from
`POST /api/v1/transcription/token` and connects directly to ElevenLabs. The API
key is never returned to the browser. Development and preview proxy `/api` to
the Express server. Microphone capture requires localhost or HTTPS.

The token route assumes the existing local, single-user app. Before exposing
the API publicly, protect it with your application's authentication and usage
limits. Production hosting should proxy `/api` on the same origin.

Audio is sent to ElevenLabs during recording; transcripts are kept in browser
memory only. Stop allows a short silence window to finalize the last words, then
releases the microphone and connection. Permission, network, and provider errors
are shown inline, and any text already received remains visible.

## Claude structured JSON demo

The backend uses the Vercel AI SDK (`ai`) and its direct Anthropic provider
(`@ai-sdk/anthropic`) with `generateText` and `Output.object`. No Vercel account
or deployment is required. Set `ANTHROPIC_API_KEY` in `apps/api/.env`, then restart
the API. `ANTHROPIC_MODEL` defaults to `claude-sonnet-5-5` and can be changed to a
Claude model available to your account. Never put the key in a `VITE_` variable.

Below the microphone panel, enter text and click **Generate JSON**, or stop a
recording and select **Use transcript** first. Only explicit submission sends
the text to Claude. Results are interpreted data, not executed warehouse actions.

`POST /api/v1/structured-output` accepts `Content-Type: application/json`:

```json
{ "text": "Urgently move 3 boxes of screws from aisle A to warehouse 5." }
```

Example response (values depend on the input):

```json
{
  "success": true,
  "data": {
    "summary": "Move 3 boxes of screws from aisle A to warehouse 5 urgently.",
    "language": "en",
    "itemCount": 1,
    "isUrgent": true,
    "tags": ["move", "screws"],
    "items": [{ "name": "boxes of screws", "quantity": 3 }],
    "location": { "source": "aisle A", "destination": "warehouse 5" },
    "notes": null
  }
}
```

The shared Zod schema and inferred `StructuredOutput` type live in
`packages/contracts/src/structured-output.ts`. Edit that schema to replace the
demo with your real object format. Both the SDK and frontend validate the output.
Inputs are limited to 8,000 characters; generation has a 30-second timeout.
Missing keys return 503, invalid input returns 400, and provider or output-format
failures return 502 without exposing provider internals. Protect this endpoint
with authentication and usage limits before exposing the local demo publicly.

Validation: `npm run test --workspace=@repo/api` and
`npm run test --workspace=@repo/web`. The Claude tests mock Anthropic's HTTP
response while exercising the actual SDK, provider adapter, and schema validation;
they require no paid API calls.
