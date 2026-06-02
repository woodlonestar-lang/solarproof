# Supabase Service Role Key — Audit & Justification

The service role key bypasses Row Level Security (RLS). Every use must be
in a **trusted server context** and documented here.

## Replaced with anon key + RLS

| Route | Reason |
|---|---|
| `GET /api/verify` | Public read-only; anon RLS policy added (migration 010) |
| `GET /api/verify/[id]` | Public read-only; anon RLS policy added (migration 010) |

## Justified service role uses

| File | Justification |
|---|---|
| `readings/route.ts` POST | No user JWT in meter device requests; inserts across `readings`, `certificates` tables on behalf of meter device |
| `readings/route.ts` GET | Operator-scoped list behind `requireAuth`; service role used for cross-cooperative admin queries |
| `readings/batch/route.ts` | Bulk insert path for batch meter submissions; no user JWT context |
| `meters/route.ts` | Operator CRUD behind `requireAuth`; service role needed to check duplicate pubkey across all cooperatives |
| `meter-api-keys.ts` | API key management — must validate keys without a user JWT (called from meter device requests) |
| `certificates/route.ts` | Operator list behind `requireAuth` |
| `certificates/[id]/retire/route.ts` | Retirement is wallet-authenticated; no Supabase user JWT available |
| `audit.ts` | Audit log writes must never be blocked by RLS — requires service role to guarantee delivery |
| `webhooks.ts` | Background webhook delivery; no user session context |
| `tracer-sim.ts` | Post-mint background diagnosis; stores result on reading record |
| `queue.ts` | Background job processing; runs outside request context |
| `health/route.ts` | Liveness probe — must be able to reach DB regardless of auth state |
| `ready/route.ts` | Readiness probe — same as health |
| `audit-log/route.ts` | Operator audit log queries behind `requireAuth` |
| `jobs/[id]/route.ts` | Internal job status queries behind `requireAuth` |
| `meters/[id]/revoke/route.ts` | Admin action behind `requireAuth` |
| `meters/[id]/keys/route.ts` | API key management behind `requireAuth` |

## RLS coverage

All tables have RLS enabled. The `auth.cooperative_id()` helper scopes
operator queries. Public read policies were added in migration 010 for
`certificates` and `readings` (audit trail data; no PII).

The service role key must **never** be exposed to the browser. It is
server-side only, validated by `env.ts` schema, and must be rotated via
the Supabase dashboard if compromised.
