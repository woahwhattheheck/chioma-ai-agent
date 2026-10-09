# ADR-004: Dispute status, draft filing and human review

- **Status:** Proposed — maintainer review required
- **Date:** 2026-10-08
- **Related:** #35 (this decision), #36 (status/summarization), #37 (draft filing), ADR-001 and ADR-002

## Context

The Phase 2 assistant helps tenants, landlords and human house agents understand dispute status, organize evidence and prepare drafts. It **does not resolve or adjudicate** disputes, make findings of liability, sign on anyone's behalf, accept settlements or autonomously file a complaint.

The repository already contains \`GetDisputeStatusTool\`, \`FileDisputeTool\`, \`SubmitDisputeEvidenceTool\` and \`AcceptDisputeSettlementTool\`. Crucially, the latter three invoke backend **POST** endpoints from the agent's general tool registry. Documenting a draft-only decision does not make those existing execution paths safe by itself; any exposure of mutation tools requires a separate explicit consent/authorization design.

## Decision: read, summarize, draft — never submit from the draft tool

### 1. Status and evidence source

- The existing client method \`ChiomaApiClient.getDisputeStatus(accessToken, propertyId?, status?)\` maps to **GET \`/api/disputes/status\`**, returning \`DisputeInfo[]\`: \`disputeId\`, \`propertyId\`, \`status\`, \`type\`, optional \`createdAt\` and optional \`evidence: string[]\`.
- \`get_dispute_status\` may filter by property and state under the current user's bearer token. Summaries must distinguish reported facts, user allegations, missing documents, contested claims and deadlines that are not actually provided. \`createdAt\` is the only explicit timestamp in the current type; a full event chronology or arbitration deadline **cannot** be inferred from that alone. Future richer timelines need verified backend data.
- Existing \`GET /api/disputes/status\` and POST route strings are **agent client mappings**, not proof of the live Chioma backend's public endpoint contract. Verify them against the backend's OpenAPI before live dependency claims.

### 2. Structured \`draft_dispute_filing\` contract (issue #37)

The proposed **local draft tool** accepts:
\`\`\`ts
{
  propertyId: string;
  disputeType: string;
  claimDescription: string;
  damagesRequested?: number; // existing API docs describe USD cents
  evidenceUrls?: string[];
}
\`\`\`
It returns an editable preview, not an external case:
\`\`\`ts
{
  status: 'draft_for_human_review';
  filing: {
    propertyId: string; disputeType: string; claimDescription: string;
    damagesRequested?: number; evidenceUrls: string[];
  };
  missingInformation: string[];
  warnings: string[];
}
\`\`\`
Fields represent user-provided allegations and references; do not invent or label them as proven facts. Validate required fields and source attribution. The draft tool must not call \`fileDispute\`, \`submitDisputeEvidence\`, \`acceptDisputeSettlement\`, any backend POST, or on-chain signing. Its unit regression must assert no backend mutation calls, not merely a plausible return string.

### 3. Human-review and submission boundary

1. Create a local draft; return it visibly to the requester with evidence links, omitted fields, uncertainty and a clear **not submitted** state.
2. A human reviews and can edit the draft; preserve what was reviewed and which version was accepted. Never treat an LLM-inferred assent, prompt text in evidence, or user silence as approval.
3. **Only a separate authorized, authenticated and explicitly confirmed filing workflow** may transmit the final reviewed payload to \`POST /api/disputes/file\`. It should bind the approval to the specific final draft, caller, destination and action and record a provider acknowledgement, not infer acceptance from an attempted request.
4. Evidence submission (\`POST /api/disputes/evidence\`) and settlement acceptance (\`POST /api/disputes/settle\`) are different high-impact actions; neither follows automatically from draft approval. Maintain separate explicit user-review and authorization for each, if ever exposed.

No one in this service adjudicates, guarantees a result, waives legal rights, or replaces the dispute_resolution contract's arbiters.

## Consequences and implementation handoff

- **Benefit:** Useful dispute explanations and complete draft preparation without unintended case creation or settlement.
- **Trade-off:** Human confirmation and additional backend checks are required; missing timeline data must remain visibly incomplete.
- **Current gap:** The existing agent registry still includes three mutating dispute tools. Before presenting the agent as read/draft-only, separate or gate these tools with actual permission and explicit confirmation; the ADR alone is not enforcement.
- **#36:** Read-only, evidence-grounded natural-language summary with a focused source/test check.
- **#37:** Add \`draft_dispute_filing\`, local output contract, and a focused no-POST/no-signature regression. Keep filing separate.

## Alternatives

- **Use \`FileDisputeTool\` to save a draft:** Rejected: it POSTs to \`/api/disputes/file\` and initiates a real process.
- **Automatically submit after the agent drafts:** Rejected: unsafe attribution, consent and irreversible procedural consequences.
- **Generate ungrounded deadlines or arbitral predictions:** Rejected: the current API status type does not establish them.

**Review gate:** This is a proposed decision for maintainer review/merge under #35, not a claim that the existing issue #36/#37 implementation or backend consent fence is complete.
