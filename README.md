# Agentic Connector — demo

A lightweight demonstration prototype of a transaction standard for asynchronous,
AI-mediated care review across four parties — **Patient**, **Reviewing Organization**,
**Laboratory**, and **Payer** — each with an AI agent at its layer.

**This is a demo, not a production system.** No real authentication, EHR/FHIR
integration, payer APIs, LLM calls, or persistent database. State is in-memory and
resets on server restart. The "AI" is scripted logic.

## Transactions demonstrated

| Code | Transaction | Where to see it |
|------|-------------|-----------------|
| IS | Intake Submission | Patient chat: type symptoms |
| EE | Emergency Escalation | Patient chat: type e.g. "chest pain" — fires instead of ARR |
| ARR | Async Review Request | Non-emergency intake → case appears in Org queue |
| RC | Review Claim | Org view: "Claim" button |
| DR | Disposition Response | Org view: "Confirm" / "Redirect" → pushed to Patient chat |
| APR/APC | Appointment Request/Confirmation | Patient picks a slot after a redirect |
| AU | Availability Update | Org appointment slots + Lab collection slots |
| CEC | Coverage Eligibility Check | Auto-created on intake, visible in Payer view |
| CER/CES | Cost Estimate Request/Response | Auto-created on redirect; patient sees "in-network, est. $45" |
| Dual-push | Lab result → patient + review queue | Lab view: "Publish result" |

## Run locally

```bash
npm install
npm run dev
```

Open http://localhost:3000 — the home page links to the four views. Open each view
in its own browser tab; they poll shared server state every ~1.5s, so transactions
propagate live between tabs.

## Demo script

1. **Patient**: type "sore throat for three days" → ARR enters the Org queue; a CEC
   appears in the Payer view and auto-resolves in ~4s.
2. **Patient**: type "chest pain" → EE fires immediately (visibly different, no queue entry).
3. **Org**: Claim the live case → Redirect → Patient sees appointment slots and, seconds
   later, the payer cost estimate ("in-network, est. $45"). Pick a slot → APC confirmation.
4. **Lab**: Publish a result → it appears simultaneously in the Patient chat and as a new
   ARR case in the Org queue.

## PII isolation

The Patient view carries a visible note that ID/insurance document uploads go to a
separate provider portal, never through the chat channel.

## Deploy

Built as a single Next.js app so it deploys to AWS Amplify Hosting with default
Next.js settings (connect the GitHub repo in the Amplify console). Note: the
in-memory store assumes a single long-lived server process — ideal behavior is
under `npm run dev`/`npm start`; on serverless hosting, state may reset between
invocations, which is acceptable for a demo.
