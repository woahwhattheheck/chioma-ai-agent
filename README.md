# Chioma AI Agent

An AI agent service for **[Chioma](https://t.me/chiomagroup)** — the open-source, Stellar-based rental platform connecting landlords, house agents, and tenants.

> **Naming note:** Chioma already uses the word "agent" for a human marketplace role — a real-estate agent who lists properties and earns commissions, tracked on-chain by the `agent_registry` Soroban contract and onboarded via `frontend/lib/agent-onboarding.ts` in the main repo. **This project is a different thing.** "Chioma AI Agent" is a software agent (an LLM-driven assistant + automation layer) that serves landlords, tenants, *and* human agents — it does not replace or model the human-agent role. Keep this distinction explicit anywhere the two could be confused.

---

## Why this exists

The main `chioma` monorepo (`backend/` NestJS, `frontend/` Next.js, `contract/` Soroban) already has scattered, minimal AI touchpoints:

| Existing piece | Location in `chioma` | What it actually does |
|---|---|---|
| Listing wizard AI helpers | `backend/src/modules/properties/property-wizard.controller.ts` | Three endpoints (`pricing-suggestion`, `description-suggestion`, `completeness-score`) that each build a prompt and call OpenAI `gpt-4o` directly via `axios` in a private `callAI()` method. No abstraction, no retries, fails silently to `{ available: false }`. |
| Matching / recommendations | `backend/src/modules/ai/matching-ai.service.ts` | Deterministic rule-based scoring (not ML) over `UserPreferences` (`user_ai_preferences` table) and property data. Produces match %, reason codes, cold-start fallback. |
| Fraud scoring | `backend/src/modules/fraud/*`, `backend/ai-services/fraud/` | An offline-trained XGBoost model exported as a static JSON weights file (`fraud-model.json`), applied at runtime as a plain weighted sum — not live inference. |

There is **no existing architecture doc or service in `chioma` that unifies these into a conversational agent** — no chat interface, no tool-calling layer, no memory, no cross-domain reasoning. `chioma-agent` is that missing piece: a standalone service that talks to the `chioma` backend's REST API (and, where appropriate, Stellar/Soroban directly) to give landlords, tenants, and agents one natural-language front door across listings, payments, escrow, disputes, and trust signals.

It is a **sibling service**, not a fork — it consumes `chioma`'s backend API rather than duplicating its database or business logic.

---

## Responsibilities

### In scope

1. **Conversational interface** — a single chat/assistant surface for landlords, tenants, and house agents to ask questions and trigger actions in natural language.
2. **Property discovery & recommendations** — wraps and extends `matching-ai.service.ts` / `user_ai_preferences`: conversational search, comparison, "why was this recommended" explanations.
3. **Landlord listing assistant** — supersedes the ad-hoc `callAI()` in `property-wizard.controller.ts` with a proper agent-backed pricing/description/completeness-scoring flow (provider abstraction, retries, structured output, evaluation).
4. **Tenant assistant** — affordability estimates, move-in guidance, application/lease status lookups, comparing shortlisted properties.
5. **Payments & escrow assistant** — explains and checks status of rent payments, security-deposit escrow, and tokenized rent obligations by reading from the `payment`, `escrow`, and `rent_obligation` Soroban contracts (via the backend's `stellar` module or Horizon directly) — read/status-oriented, not a replacement for the contracts' own execution logic.
6. **Dispute resolution assistant** — helps parties and arbiters interacting with the `dispute_resolution` contract: summarizes evidence/claims, tracks timelines, drafts filings. Does not rule on disputes itself.
7. **Trust & fraud signal surfacing** — consumes (does not retrain or replace) the `fraud` module's alerts/scores to caveat recommendations or flag anomalies in conversation.
8. **Notifications & follow-ups** — proactive nudges (rent due, draft expiring in 30 days, dispute deadline approaching) by polling/subscribing to backend events.

### Explicitly out of scope

- **Human agent onboarding, verification, commissions, or reputation** — owned entirely by `agent_registry` (contract) and `frontend/lib/agent-onboarding.ts`. This project must never conflate "AI agent" with that role.
- **Fraud model training** — owned by `backend/ai-services/fraud/train_model.py`; this project only *reads* fraud signals.
- **On-chain contract logic / consensus** — owned by the Soroban contracts in `chioma/contract`; this project calls them, it doesn't reimplement them.
- **Core CRUD for listings, users, KYC, messaging** — owned by the respective `chioma` backend modules; this project is a client of those APIs.

---

## Architecture

```text
Landlord / Tenant / House Agent
            │
            ▼
   Chioma AI Agent (this repo)
            │
   ┌────────┼─────────────────────────┐
   │        │                         │
   ▼        ▼                         ▼
Conversation   Tool-Calling Layer      Memory / Session Store
  Engine       │                      (conversation state, prefs cache)
  (LLM         ├── Listings tool  ──► chioma backend: /properties, /ai/matching
  provider     ├── Wizard tool    ──► chioma backend: /property-listings/wizard/*
  abstraction) ├── Payments tool  ──► chioma backend: /payments, /rent, Stellar Horizon
               ├── Escrow tool    ──► escrow contract (via chioma backend "stellar" module)
               ├── Dispute tool   ──► chioma backend: /disputes, dispute_resolution contract
               ├── Fraud tool     ──► chioma backend: /fraud (read-only)
               └── Notify tool    ──► chioma backend: /notifications
                                              │
                                              ▼
                                    Chioma Backend API (NestJS)
                                              │
                                              ▼
                                    Stellar Network + Soroban Contracts
```

---

## Relationship to the `chioma` monorepo

```text
personal/projects/
├── chioma/           # product monorepo: backend (NestJS), frontend (Next.js), contract (Soroban/Rust)
└── chioma-ai-agent/   # this repo — standalone AI agent service, consumes chioma's backend API
```

`chioma-ai-agent` does not import `chioma` code directly. It integrates over HTTP against the backend's REST API (see `backend/openapi.json` in the main repo) and, for read-heavy status checks, may query Stellar Horizon directly using the same network config (`STELLAR_NETWORK`, `STELLAR_HORIZON_URL`) as `chioma/frontend`.

---

## Repository structure

The implemented layout mirrors the conventions used in `chioma/backend`:

```text
chioma-ai-agent/
├── src/
│   ├── main.ts                     # app bootstrap
│   ├── app.module.ts
│   ├── agent/                      # core agent runtime
│   │   ├── conversation/           # conversation engine, prompt templates, turn handling
│   │   ├── memory/                 # session/context store (Redis-backed)
│   │   └── llm/                    # provider abstraction (OpenAI, Anthropic), swappable
│   ├── tools/                      # one "tool" per external capability the agent can call
│   │   ├── listings.tool.ts        # -> chioma backend /properties, /ai/matching
│   │   ├── wizard.tool.ts          # -> chioma backend /property-listings/wizard/*
│   │   ├── payments.tool.ts        # -> chioma backend /payments, /rent
│   │   ├── escrow.tool.ts          # -> escrow contract via chioma backend / Horizon
│   │   ├── disputes.tool.ts        # -> chioma backend /disputes
│   │   ├── fraud.tool.ts           # -> chioma backend /fraud (read-only)
│   │   └── notifications.tool.ts   # -> chioma backend /notifications
│   ├── integrations/
│   │   ├── chioma-api/             # typed REST client for the chioma backend
│   │   └── stellar/                # Horizon/Soroban read helpers
│   ├── modules/
│   │   ├── chat/                   # chat/assistant HTTP + WebSocket endpoints
│   │   └── health/
│   ├── config/                     # env config, per-environment overrides
│   └── common/                     # guards, interceptors, DTOs, filters
├── test/                           # e2e specs (jest, matching chioma/backend conventions)
├── docs/
│   └── architecture/               # ADRs for this service
├── .env.example
├── Dockerfile
├── docker-compose.yml
├── nest-cli.json
├── package.json
├── pnpm-lock.yaml
├── tsconfig.json
└── README.md
```

---

## Tech stack (proposed, matching `chioma`'s conventions)

- **Runtime:** Node.js + TypeScript, NestJS (consistent with `chioma/backend`; `.gitignore` already assumes Nest)
- **LLM providers:** OpenAI (drop-in replacement for the existing `callAI()` calls) with an abstraction layer to add Anthropic/others
- **Session/memory store:** Redis
- **Package manager:** pnpm (matches both `chioma/backend` and `chioma/frontend`)
- **Blockchain:** Stellar SDK / Horizon, read access to the same Soroban contracts as `chioma/contract`

---

## Roadmap

**Phase 1 — Assistant core**
Conversational interface, listings discovery/recommendations, replace the inline `callAI()` wizard helpers with the agent's own pricing/description/completeness tools.

**Phase 2 — Financial & dispute awareness**
Payment/escrow status lookups, rent-obligation NFT explanations, dispute summarization and filing assistance.

**Phase 3 — Proactive automation**
Notifications/reminders (rent due, draft expiry, dispute deadlines), fraud-signal-aware caveats in conversation.

**Phase 4 — Multi-surface**
Embed the assistant in `chioma/frontend` (landlord, tenant, and agent dashboards) and expose it via API for third-party/developer-portal use.

---

## Getting started

```bash
git clone https://github.com/chioma-housing-protocol-I/chioma-ai-agent.git
cd chioma-ai-agent
pnpm install
cp .env.example .env   # set LLM_PROVIDER, LLM_MODEL, and the matching API key
pnpm run start:dev
```

## HTTP API documentation

Start the service with `pnpm run start:dev`, then open [Swagger UI](http://localhost:3100/api) at `http://localhost:<PORT>/api` (the default `PORT` is `3100`). The machine-readable OpenAPI JSON is at `/api-json`. The specification documents the real `POST /chat` and `DELETE /chat/:sessionId` routes, including request and response schemas, session IDs, success codes and bearer-token authentication. Use **Authorize** with the same Chioma backend access token accepted by the chat controller; the API docs do not issue tokens or bypass authentication.

For a focused regression of the documentation UI, request schemas, bearer metadata, chat response and existing CORS behavior, run `pnpm exec jest src/openapi.spec.ts --runInBand`.

Run the full check pipeline with `make check` (lint + typecheck + test) before opening a PR.

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for local setup, required checks, and PR expectations — every PR must satisfy the linked issue's Acceptance Criteria and include a screenshot or short recording of the change. Questions or want to claim an issue? Join the contributor chat: https://t.me/chiomagroup

## Security

Found a vulnerability? Please don't open a public issue — see [SECURITY.md](./SECURITY.md) for how to report it privately.

## License

MIT — see [LICENSE](LICENSE).
