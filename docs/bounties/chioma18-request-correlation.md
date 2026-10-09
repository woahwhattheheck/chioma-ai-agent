# Chioma issue #18: per-request correlation

The server generates a fresh UUID for each HTTP request and exposes it through `X-Request-ID` and `req.correlationId`. Two request lifecycle logs include that ID, method, status and duration. Query parameters, raw headers, bearer tokens and request bodies are excluded. Client-supplied IDs cannot spoof the trace.

Focused regression: `pnpm exec jest correlation-id.middleware.spec.ts --runInBand`. The scoped TypeScript source smoke passed with a mocked Nest Logger; no Nest app integration test or repository-wide suite was run.