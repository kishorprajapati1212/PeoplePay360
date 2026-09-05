-- How long an account-invitation link stays usable, held in the product instead of in a file.
--
-- 10 minutes is the default on purpose: the link travels through somebody's inbox, and a short window is what
-- makes that safe. It is also one-use (invitations.accepted_at), so a link that has set a password is dead even
-- inside the window. `INVITE_TTL_MINUTES` in backend/.env overrides this for a whole deployment; the row wins.
alter table company_settings add column if not exists mail_invite_ttl_minutes integer not null default 10;

comment on column company_settings.mail_invite_ttl_minutes is
  'Minutes an account-invitation (set-password) link stays valid. It also works only once.';
