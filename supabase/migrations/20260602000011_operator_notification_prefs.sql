-- Migration 011: operator email notification preferences
-- One row per cooperative. Stores the notification email, which events are
-- enabled, and a per-cooperative unsubscribe token.

create table operator_notification_prefs (
  id uuid primary key default gen_random_uuid(),
  cooperative_id uuid not null unique references cooperatives(id) on delete cascade,
  email text not null,
  notify_minted boolean not null default true,
  notify_retired boolean not null default true,
  notify_mint_failed boolean not null default true,
  unsubscribe_token text not null default encode(gen_random_bytes(24), 'hex'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table operator_notification_prefs enable row level security;

create policy "operators: own notification prefs"
  on operator_notification_prefs for all
  using (cooperative_id = auth.cooperative_id() or auth.is_admin());
