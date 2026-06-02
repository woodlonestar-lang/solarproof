-- Migration 009: meter API keys
-- Each meter device authenticates with an API key (in addition to Ed25519 sig).
-- The key_hash stores a SHA-256 hash of the raw key so the plaintext is never stored.

create table meter_api_keys (
  id uuid primary key default gen_random_uuid(),
  meter_id uuid not null references meters(id) on delete cascade,
  key_hash text not null unique,            -- SHA-256 hex of the raw API key
  hint text not null,                       -- last 4 chars of raw key for display
  active boolean not null default true,
  created_at timestamptz not null default now(),
  rotated_at timestamptz,
  revoked_at timestamptz
);

create index on meter_api_keys(meter_id);

alter table meter_api_keys enable row level security;

-- Operators may only see keys for their own meters
create policy "operators: own meter api keys"
  on meter_api_keys for all
  using (
    auth.is_admin()
    or exists (
      select 1 from meters m
      where m.id = meter_api_keys.meter_id
        and m.cooperative_id = auth.cooperative_id()
    )
  );
