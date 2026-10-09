# voice-to-warehouse

Innovation Challenge Project

## Live voice transcription

The React frontend streams microphone audio to ElevenLabs Scribe v2 Realtime.
Tap the microphone or press Space (unless a field has focus), allow
microphone access, and say what arrived. A one-line caption under the
microphone shows the latest words and fades out.
Say "Done" or "Fertig" as the last word to
finish, or "Cancel", "Abbrechen" or "Abbruch" to discard the recording.
Stopping by tap or Space also finishes it. As soon as the receipt is shown,
the app listens again and the confirmation header shows turning rays with
"Say Done to book": "Done" books the receipt in the ERP and refreshes the open
positions, "Cancel" discards it, and saying the articles again replaces it.
The EN/DE toggle in the header is disabled while recording. Voice is the only
input; there is no text field.

The app is one fixed-height page without a page scroll: a header, the capture
panel "Agent" (4 of 12 columns) next to the confirmation panel (8 columns),
and "Open Positions" below, scrolling inside their own panel. Panels have no
borders on a light blue canvas; the header keeps a light bottom border. Under 960px the
capture panel sits on top of the open positions and the confirmation opens as
a bottom sheet whenever a receipt is created; "Show confirmation" reopens it.

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

## Goods receipt (Wareneingang) JSON

The app's second card turns a voice transcript (or typed text) into the goods
receipt JSON that the Byte ERP expects.

Flow: when the page loads, the app calls `GET /api/v1/goods-receipt/order`
once. The API reads purchase order `ERP_BESTELLNUMMER` from the ERP export
service (`POST {ERP_BASE_URL}/web/services/EXP020` with Basic auth) and returns
a summary of its positions. The app shows that summary and sends it back with
every `POST /api/v1/goods-receipt` request, so the ERP is not read again for
each conversion. The API gives Claude only the relevant position data (position
number, article numbers, name, ordered, booked, remaining) and the text; Claude
decides which position each spoken article belongs to and extracts quantity,
bin, batch, and expiry. Position numbers, article numbers, and prices always
come from the ERP data. Every finished recording is sent automatically unless
it was cancelled.

Set these in `apps/api/.env` (see `.env.example`): `ERP_BASE_URL`,
`ERP_USERNAME`, `ERP_PASSWORD`, `ERP_FIRMA` (default `01`), `ERP_BESTELLNUMMER`
(default `1712`), and `ERP_ALLOW_SELF_SIGNED=true` for the challenge host,
whose certificate is self-signed.

Request body (`Content-Type: application/json`). `order` is the object from
`GET /api/v1/goods-receipt/order`; without it the API reads the ERP itself.
`artikelnummerhersteller` is optional and limits matching to positions with
one of these manufacturer article numbers:

```json
{
  "text": "One pack of Ibuflam 600mg in bin M53-01-01-02, batch AB1234, expiry December 2027. Two Samsung RAM modules in bin M53-02-01-01, batch HS77.",
  "order": { "Firma": "01", "Bestellnummer": 1712, "positionen": ["…"] },
  "artikelnummerhersteller": ["55204", "55207"]
}
```

Articles can be named by name (English or German) or by article number. Each
article needs a quantity, bin (`Lagerort`), and batch (`Charge`). The expiry
date (`Verfalldatum`) is optional: when it is not said, `122026` is used and the
item carries `expiryDefaulted: true`, which the card shows as
"(default, not said)". Two batches of the same article produce one position
with two `VCS` entries and the summed `Zubuchmenge`.

The ERP books **one position per call**, so the response contains one goods
receipt per position in `bestellungen`, each with its own random
`Lieferanten_Rechnungsnummer`; both dates are fixed to `31.12.2026`. Every
`VCS` line also carries a random six-digit `Seriennummer`. Post each
entry to the ERP wrapped as `{ "bestellung": … }` (the card shows and copies
them in exactly that form). Sending the inner object without the wrapper makes
the ERP answer RTC001 (Firma missing), RTC002 (Bestellnummer missing), and
RTC004 (Rechnungsnummer missing).

```json
{
  "success": true,
  "data": {
    "complete": true,
    "items": [
      {
        "spoken": "pack of Ibuflam 600mg",
        "Positionnummer": 2,
        "Artikelnummer": "55204",
        "Artikelbezeichnung": "Ibuflam 600mg",
        "Zubuchmenge": 1,
        "Lagerort": "M53-01-01-02",
        "Charge": "AB1234",
        "Verfalldatum": "122027",
        "expiryDefaulted": false,
        "missing": []
      }
    ],
    "messages": [],
    "bestellungen": [
      {
        "Firma": "01",
        "Bestellnummer": 1712,
        "Lieferanten_Rechnungsnummer": "0815",
        "Lieferanten_Rechnungsdatum": "31.12.2026",
        "Wareneingangsdatum": "31.12.2026",
        "positionen": [
          {
            "Positionnummer": 2,
            "Artikelnummer": "55204",
            "Lagerort": "M53-01-01-02",
            "Einkaufpreis": 2.34,
            "Zubuchmenge": 1,
            "VCS": [
              {
                "Verfalldatum": "122027",
                "Charge": "AB1234",
                "Seriennummer": "112233",
                "Menge": 1
              }
            ]
          }
        ]
      }
    ]
  }
}
```

`items` is the per-article review the card shows: article, quantity, bin, and
batch, with a cross for every detail the user did not say. When any article is
incomplete or does not belong to the order, `complete` is `false`,
`bestellungen` is empty (no JSON is produced), and `messages` explains each
gap, for example `Ibuflam 600mg (position 2): bin (Lagerort) and batch (Charge)
not said.` or `"a pack of tissues" is not part of order 1712.`

`GET /api/v1/goods-receipt/order` returns the order summary. Each position
carries `Bestellmenge` (ordered), `Bereitszugebuchtemenge` (already booked),
and `Restmenge`, the remaining quantity computed as ordered minus booked (never
below 0); the card shows all three, and fully booked positions are greyed out.

Errors: 400 invalid input, 404 order or filtered positions not found, 503 ERP
or Claude not configured, 502 ERP or Claude failure (no upstream details are
forwarded), 504 timeout. Tests: `npm run test --workspace=@repo/api` mocks
both the ERP and Anthropic over HTTP.

### Confirm and book in the ERP

When the JSON is complete, the confirmation panel shows the recognised
articles (a cross marks every detail that was not said; "Add expiry date"
sets a date the worker did not say and updates the JSON) and the bookings as
a table (position,
article, bin, quantity, batch, expiry, serial, price, invoice number) with the
raw JSON available per booking under "JSON for booking n". **Confirm and book
in ERP** sends them to `POST /api/v1/goods-receipt/book`
(`{ "bestellungen": [ ... ] }`). The API books each entry with
`PUT {ERP_BASE_URL}/web/services/IMP015` and the body `{ "bestellung": ... }`,
using the same Basic auth as the order export, one call per position, in
order. The browser cannot call the ERP itself: its preflight request is
answered with 401 and no CORS headers, the certificate is self-signed, and the
credentials must stay on the server.

The ERP answers every booking with HTTP 200 and a list of return codes: RTC000
("keine fehler Aufgetreten.") on success, otherwise for example RTC001 (`Firma` missing), RTC007 (`Wareneingangsdatum` missing), RTC041
(`Menge` invalid) or RTC100 (booking not accepted). Because the codes do not
say what was booked, the API reads the order before and after and marks a
position as `booked` only when the ERP did not answer RTC100 and the position's
`Bereitszugebuchtemenge` increased by the booked quantity. The ERP's JSON can
contain trailing commas, which the API repairs before parsing. The response
contains one result per position (`booked`, `bookedBefore`, `bookedAfter`,
the ERP `return` codes, the invoice number), `allBooked`, and the order as
read after booking; the card shows the results, updates the open positions
table, disables the button once everything is booked, and offers a retry for
rejected positions only. Only `ERP_BESTELLNUMMER` of `ERP_FIRMA` can be booked;
other orders are rejected with 400.

If a booking call itself fails (network error, HTTP error, or an unexpected
answer), the API records it for that position with the return code `API` and
a message, continues with the remaining positions, and still reads the order
again, so a receipt whose answer was lost is reported as booked when the
quantity increased. Order reads are repeated once after a network error;
booking calls never are. The API opens a fresh connection to the ERP for every
call, because the ERP closes idle connections, and logs the cause of every
failed ERP call (without credentials) to the server console.
