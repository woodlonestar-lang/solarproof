-- Migration 010: Public read access for the certificate verifier (#134)
--
-- The public /api/verify endpoint allows anyone (no auth) to look up a
-- certificate by ID, reading_hash, or mint_tx_hash. Since we are switching
-- that endpoint from the service-role key to the anon key, we need explicit
-- RLS policies granting anonymous SELECT on the relevant tables.
--
-- Only SELECT is allowed; INSERT/UPDATE/DELETE remain operator-only.

create policy "public: read certificates for verify"
  on certificates for select
  to anon
  using (true);

create policy "public: read readings for verify"
  on readings for select
  to anon
  using (true);
