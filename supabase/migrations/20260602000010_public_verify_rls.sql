-- Migration 010: allow anon (public) read access to certificates and readings
-- so the public verifier (/verify) does not require the service role key.
--
-- Certificates are already public knowledge (posted on-chain); the reading proof
-- contains only the Ed25519 signature and hash — no PII.

create policy "public: read certificates"
  on certificates for select
  to anon
  using (true);

create policy "public: read readings"
  on readings for select
  to anon
  using (true);
