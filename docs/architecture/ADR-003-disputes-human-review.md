# ADR-003: Dispute summaries, filing drafts, and human decision boundary

- **Status:** Proposed for maintainer acceptance (issue #35)
- **Date:** 2026-10-08
- **Scope:** Additional `summarize_dispute` and `draft_dispute_filing` tools planned by issues #36 and #37

## Context

The conversational agent needs to explain the status of tenant/landlord disputes and help a person prepare an accurate filing. Those are *information and drafting* tasks, not adjudication. A generated answer must not decide fault, assign liability, imply official legal standing, or advance an arbitration case by itself.

The current code already includes `get_dispute_status`, `file_dispute`, `submit_dispute_evidence`, and `accept_dispute_settlement` in `src/tools/disputes.tool.ts`. The latter three invoke write endpoints today. This ADR defines a separate, safer contract for the new tools; it does **not** claim those existing write tools are gated or changed by this document.

## Decision

1. `get_dispute_status` remains a per-user read: `ChiomaApiClient.getDisputeStatus(accessToken, propertyId?, status?)` calls **GET /api/disputes/status**, with `propertyId` optional and `status` one of `open`, `in_arbitration`, `resolved`, or `all`.
2. `summarize_dispute` (issue #36) reads that same authenticated status endpoint and summarizes one relevant dispute's *reported* facts, evidence references, key dates (when present), status, outstanding decisions, and missing records. The client currently has no verified detail-by-ID endpoint; filter the status result by `disputeId` rather than inventing one. If no matching record is visible, respond “not found or not accessible” rather than implying no dispute exists.
3. `draft_dispute_filing` (issue #37) produces a structured, editable filing **draft** from the user's supplied allegations and evidence. It makes **zero backend writes**. It never calls `fileDispute`, `submitDisputeEvidence`, `acceptDisputeSettlement`, or an on-chain transaction.
4. Neither tool determines credibility, fault, judgment, compensation entitlement, settlement terms, fraud, or legal outcome. Differentiate confirmed backend fields from user-provided claims; qualify missing/contested facts.

## Tool contracts

### `summarize_dispute` — read-only

Input: `disputeId: string` required; optional `propertyId: string` to narrow the authorized read. Output: JSON string with `disputeId`, `reportedStatus`, `reportedType`, `reportedDate?`, `evidenceReferences: string[]`, `summary`, `missingInformation: string[]`, and `source: "chioma_dispute_status"`. Populate fields from `DisputeInfo` returned by the backend; do not generate fictional timelines. The service must use `ToolContext.accessToken` for every read and must not expose other users' records.

### `draft_dispute_filing` — local drafting only

Input: `propertyId: string`, `disputeType: string`, `claimDescription: string`; optional `damagesRequested` (integer USD cents), `evidenceUrls: string[]`, and dated supporting statements. Output: JSON string with `draft` (structured allegations, chronology, evidence inventory, requested outcome), `missingInformation: string[]`, `requiresHumanReview: true`, and `submissionStatus: "not_submitted"`. Attribute assertions to the user unless a specific backend record supports them. Do not include unsupported legal conclusions or treat generated text as an official filing.

## Human review and eventual submission

```text
Authenticated user requests help
  -> read authorized dispute data and/or assemble a local draft
  -> show exact draft + evidence references + unresolved questions to user
  -> user may edit, reject, or explicitly approve an actual filing
  -> a separate authenticated application submission action presents final terms
  -> only that approved action may POST /api/disputes/file
  -> display the backend receipt; never infer success from a draft
```

The eventual application action must record approval for the specific draft, property, parties and attachments and check permissions server-side. A conversational instruction alone does not authorize payment, settlement or publication. This new draft tool must not route approval by itself.

**Current-code reconciliation:** `ChiomaApiClient.fileDispute()` already posts to `/api/disputes/file`; `submitDisputeEvidence()` posts to `/api/disputes/evidence`; `acceptDisputeSettlement()` posts to `/api/disputes/settle`. These legacy `AgentTool` registrations need a separate product decision and enforcement change before anyone can claim mandatory human review applies to *all* dispute writes. This ADR is a design decision, not a runtime security control.

## Acceptance boundary for issues #36 and #37

- #36: status lookup and readable summary, evidence/timeline attribution, inaccessible/missing-record handling, one focused mocked-client behavior check.
- #37: locally generated draft, editable output with explicit “not submitted” state, one focused test asserting **no POST/write method is invoked**.
- Neither: adjudication, automatic filing, automated acceptance/settlement, or a new undocumented backend endpoint.
- Required issue demonstration: an actual terminal or UI capture showing the status summary and unsubmitted draft from mock data, with any personal details redacted.

## Consequences and alternatives

This keeps lookup, drafting, and legal/financial actions separate. It allows future human-reviewed case submission without coupling the LLM to a filing endpoint. The trade-off is an explicit review/application step. We reject automatic `POST /api/disputes/file` from a drafting tool because a model-generated draft is not evidence of user approval. We also reject inventing dispute outcomes or a detail endpoint not present in the current client.

**Related:** [ADR-001](./ADR-001-tool-implementation.md), [ADR-002](./ADR-002-api-client.md), issues #35, #36, and #37.
