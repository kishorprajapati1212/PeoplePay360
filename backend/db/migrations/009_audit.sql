CREATE TABLE audit_logs (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type  text NOT NULL,
  entity_id    uuid NOT NULL,
  action       text NOT NULL,                 -- CREATE | UPDATE | DELETE | APPROVE | REFUSE | COMPUTE | VALIDATE | MARK_PAID | SEND | DOWNLOAD | LOGIN
  actor_user   uuid REFERENCES users(id) ON DELETE SET NULL,
  actor_type   text NOT NULL DEFAULT 'USER' CHECK (actor_type IN ('USER','WORKER','SYSTEM')),
  old_values   jsonb,
  new_values   jsonb,
  summary      text,
  ip         text,
  user_agent text,
  request_id   text,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_audit_entity ON audit_logs(entity_type, entity_id, created_at DESC);
CREATE INDEX idx_audit_actor  ON audit_logs(actor_user, created_at DESC);
