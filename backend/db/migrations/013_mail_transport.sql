-- 013 · mail transport that can be configured from inside the product.
--
-- mail_from and mail_daily_limit have lived on this row since the first schema, but the credentials were
-- env-only, which is why a demo could never actually send an invitation: somebody had to edit backend/.env and
-- restart the API. These columns let Settings → Company hold the SMTP login, with mail_enabled as the one
-- switch that decides whether anything leaves the machine at all (off = the .eml preview, exactly the old
-- behaviour, and still what happens when no credentials exist).
--
-- smtp_password is write-only on purpose: the repository never selects it out, so no endpoint can echo it and
-- the screen shows "a password is stored" instead. A company that would rather keep the secret out of the
-- database leaves these NULL and keeps using EMAIL_NAME / EMAIL_PASSWORD from the environment — env stays the
-- fallback, the database only wins where a value is actually set.
alter table company_settings add column if not exists mail_enabled  boolean not null default true;
alter table company_settings add column if not exists smtp_host     text;
alter table company_settings add column if not exists smtp_port     integer not null default 587;
alter table company_settings add column if not exists smtp_secure   boolean not null default false;
alter table company_settings add column if not exists smtp_user     text;
alter table company_settings add column if not exists smtp_password text;

comment on column company_settings.mail_enabled is 'Real sending on/off. Off writes .eml files into backend/storage/mail and never opens a socket.';
comment on column company_settings.smtp_password is 'Write-only: read by the mailer when it sends, never returned by an endpoint.';
