-- Migration 009: API keys for meter device authentication (#131)
--
-- Each meter is issued a unique random API key on registration.
-- The key is validated by the readings endpoint before Ed25519 signature check.
-- Keys can be rotated (new key generated) without changing the Ed25519 keypair.
-- Revoking a key (setting it NULL) immediately rejects submissions from that meter.

alter table meters
  add column api_key text unique;

-- Backfill existing meters with generated keys
update meters
  set api_key = 'mk_' || encode(gen_random_bytes(32), 'hex')
  where api_key is null;

-- Enforce NOT NULL going forward
alter table meters
  alter column api_key set not null;

comment on column meters.api_key is
  'API key issued to the meter device. Validated before Ed25519 signature check. Rotate via PATCH /api/meters/{id}/rotate-key. Set to empty string to revoke.';
