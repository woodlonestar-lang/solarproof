# ADR 007 — Supabase Service Role Key Usage

**Status:** Accepted  
**Date:** 2026-06-02  
**Issue:** [#134](https://github.com/AnnabelJoe/solarproof/issues/134)

## Context

The Supabase service role key bypasses Row Level Security (RLS). Its use must be
minimised and every remaining usage justified.

## Audit Results

### Switched to anon key + RLS

| Endpoint | Reason |
|---|---|
| `GET /api/verify` | Public, no auth. Anon SELECT policy added (migration 010). |
| `GET /api/verify/[id]` | Public, no auth. Same policy. |

### Retained service role — justified uses

| Location | Reason service role is required |
|---|---|
| `POST /api/readings` | Device-submitted data, no operator JWT. Must write across cooperative boundaries. |
| `POST /api/meters` | Operator action but needs to write `api_key`; simpler to stay consistent with reads. |
| `PATCH /api/meters/[id]/revoke` | Admin action. No operator JWT in device flow. |
| `POST /api/meters/[id]/rotate-key` | Requires auth, but key rotation updates `api_key` which RLS does not expose to `anon`. |
| `POST /api/certificates/[id]/retire` | Must validate and update certificate state across cooperative scope. |
| `GET /api/certificates` | Returns paginated certs with JOIN on readings; RLS would require operator JWT which callers may not have. |
| `GET /api/readings` | Requires operator JWT (enforced by `requireAuth`), but the service client avoids double-auth round-trip. |
| `lib/audit.ts` | Audit log writes must never be gated by operator RLS. |
| `lib/queue.ts` | Background job processing — no user JWT available. |
| `lib/webhooks.ts` | Cross-cooperative webhook fan-out; no user context. |
| `lib/tracer-sim.ts` | Mint-failure diagnosis reads across tables without a user JWT. |
| `GET /api/health` | Needs cross-tenant visibility for health checks. |
| `GET /api/audit-log` | Admin compliance export; scoped by query params. |
| `GET /api/jobs/[id]` | Job status lookup; no user JWT in background context. |
| `GET /api/ready` | Startup liveness probe. |

## Decision

1. Use `createAnonClient()` (anon key, RLS enforced) for all public read-only
   endpoints that require no authentication.
2. Add explicit `to anon` RLS policies (migration 010) for the tables those
   endpoints query.
3. All remaining `createServiceClient()` calls are in trusted server-side
   contexts where either no user JWT is available or cross-cooperative access
   is deliberately required.
4. The service role key must never be exposed to the browser or returned in any
   API response.

## Consequences

- The public verifier (`/api/verify`) no longer uses the service role key.
- New public-read endpoints must use `createAnonClient()` and add an explicit RLS policy.
- Any future use of `createServiceClient()` in a new route requires a comment
  citing this ADR and a one-line justification.
