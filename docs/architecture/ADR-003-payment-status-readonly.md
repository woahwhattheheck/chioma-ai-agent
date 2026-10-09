# ADR-003: Read-only rent-payment status tool contract

- **Status:** Proposed — maintainer review required
- **Date:** 2026-10-08
- **Related:** #29 (this decision), #30 (tool implementation), ADR-001 (tool pattern), ADR-002 (API client)

## Context

The Phase 2 payments assistant needs to answer questions about balances, due dates, and past payments without initiating transfers. Chioma AI Agent is an API consumer, not the payments ledger or contract executor. Its backend access is derived from the current user's bearer token, not a shared administrative identity.

As of this ADR, the codebase already includes \`GetPaymentStatusTool\` (registered as \`get_payment_status\`), \`GetChargeBreakdownTool\`, and a **separate mutating** \`MakePaymentTool\`. This decision governs the **status-lookup capability only**, not the entire payments module. Issue #30 proposes the name \`get_rent_payment_status\`; the existing name should be reconciled with maintainers instead of registering two competing payment-status tools.

## Decision

1. **Read-only boundary.** Payment-status inquiries invoke only \`ChiomaApiClient.getPaymentStatus(accessToken, propertyId?, limit?)\`, which the current client maps to \`GET /api/payments/status\`. For a user-requested itemized charge view, the separate \`get_charge_breakdown\` capability maps \`GET /api/payments/charges/:propertyId\`. Neither may call \`makePayment\`, \`POST /api/payments/make\`, Stellar write operations, or payment-method updates. These paths reflect the *agent client contract*; verify the upstream backend's actual OpenAPI/routes before declaring integration live.
2. **Input shape.** JSON Schema arguments for the status tool: \`{ propertyId?: string, limit?: number }\`. \`propertyId\` is a scoped filter, not an authorization bypass. The registered tool currently defaults \`limit\` to 20; implementation hardening should validate a finite positive integer and enforce a bounded maximum before forwarding any value. Do not infer that current validation exists.
3. **Output shape.** Return a JSON-serialized \`PaymentStatus\`:
   \`\`\`ts
   {
     currentBalance: number;
     nextDueDate?: string;
     lastPaymentDate?: string;
     history: Array<{ date: string; amount: number; status: string }>;
   }
   \`\`\`
   Preserve provider values and missing optional dates. The client contract does **not** declare the currency or unit of \`currentBalance\`/\`amount\`: never label numbers as dollars or cents until the backend contract establishes those units. The LLM may explain status but must not invent settled/paid states.
4. **Identity and error boundary.** Use \`ToolContext.accessToken\` exclusively for each caller; the existing client injects it as an Authorization Bearer header. Do not place tokens, full API error bodies, financial account details, or raw bearer headers in logs. Propagate a bounded, user-safe error when the backend is unreachable; distinguish unavailable information from a zero balance.
5. **No payment execution via a status request.** Keep the mutating \`make_payment\` tool separate from this read-only design. It is presently registered among general agent tools, so the *overall* deployed agent is not guaranteed read-only. A later implementation/guard decision must explicitly limit exposure of mutating tools and require an authorized user confirmation before any payment operation; this ADR does not claim that enforcement has landed.

## Acceptance and traceability

| Contract | Source or follow-up |
| --- | --- |
| Status method and endpoint | \`src/integrations/chioma-api/chioma-api.client.ts#getPaymentStatus\` |
| User-facing tool and JSON Schema | \`src/tools/payments.tool.ts#GetPaymentStatusTool\` |
| Tool registration | \`src/tools/tools.module.ts\` |
| Existing payment mutation to isolate | \`src/tools/payments.tool.ts#MakePaymentTool\` |
| Implementation follow-up | #30: align accepted name, bounds, error handling, backend contract and focused regression |

**Review gate:** This ADR is proposed, not yet accepted or merged. Its merge/review is the architecture decision requested by #29; it does not claim that #30 is finished, that any user has paid, or that an upstream backend endpoint was exercised.

## Alternatives

- **Expose one all-purpose read/write payment tool:** Rejected. Status questions must never become payment instructions.
- **Query the ledger or Stellar contracts directly:** Deferred. Duplicate account-scoping and amount semantics would increase authorization and reconciliation risk.
- **Return formatted currency strings from the tool:** Rejected until the backend fixes currency, precision, and unit semantics.
