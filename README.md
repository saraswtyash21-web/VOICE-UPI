# VoiceGuide UPI

An accessible, voice-assisted payment-flow prototype for older adults and people who prefer spoken guidance. The frontend is React; the local Express API persists sample contacts and simulated transaction records in SQLite.

> **Simulation only:** this application is not connected to UPI or a bank and never moves real money. Never enter a UPI PIN here. A real payment integration requires an authorized provider and its secure authorization flow.

The sign-up screen creates a local app access PIN record in this browser using a salted PBKDF2 hash. This is a classroom prototype, not real account security: it has no server-side identity, recovery, or multi-device login. The app access PIN only unlocks the local interface; it never authorizes a payment and is not a UPI PIN.

## Requirements

- Node.js 18 or newer
- npm

## Run locally

```sh
npm install
cp .env.example .env
npm run dev
```

Open the Vite URL printed by the command (usually `http://localhost:5173`). The API runs on `http://localhost:3001`. The app creates `data/voiceguide.sqlite` and seeds three clearly fictitious demo recipients on its first run.

For a production-style local build, run `npm run build` then `npm start`; the API remains available at port 3001. The Vite development server proxies `/api` requests to the API.

## Configuration

`.env.example` lists the available settings:

- `PORT`: API port (default `3001`)
- `DATABASE_PATH`: SQLite file path (default `./data/voiceguide.sqlite`)
- `PAYMENT_PROVIDER`: must remain `simulated`; no live provider is implemented

The app supports English, Hindi, and Hinglish UI copy. Browser speech recognition availability depends on the browser and microphone permission; typing and selecting a saved contact remain available as fallbacks. Speech recognition is only used to fill in the recipient/amount; a separate review and explicit confirmation are required.

## Try the demo

1. Create an account on this browser and choose an app access PIN, then select Anita Sharma, Rajesh Kumar, or Meena Devi.
2. Enter an amount or use a quick amount button.
3. Review the recipient, UPI ID, amount, and optional note.
4. Choose **Confirm simulated payment** and acknowledge the browser confirmation.
5. See the simulated result and transaction reference in recent activity. The status says simulated because the app does not transfer funds.

You can also add a demo recipient with a fictitious UPI ID, such as `demo.person@demo`. Do not enter real banking credentials.

## API

- `GET /api/health`
- `GET, POST /api/recipients`
- `PATCH, DELETE /api/recipients/:id`
- `POST /api/payment-intents`
- `POST /api/transactions/:id/confirm` (requires `{ "confirmed": true }`)
- `POST /api/transactions/:id/cancel`
- `GET /api/transactions`, `GET /api/transactions/:id`

The provider interface is in `server/provider.js`. The only implementation provided returns a simulated success. Server validation, JSON size limits, Helmet security headers, and API rate limiting are enabled. Logs do not include request bodies or payment data.

## Tests

```sh
npm test
```
