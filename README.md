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
3. Run `npm run dev` and open <http://127.0.0.1:5173>.

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
