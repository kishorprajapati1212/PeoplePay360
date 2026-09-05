-- Redis/BullMQ executes; this table is the durable ledger the UI and audits read.
CREATE TABLE task_queue (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_type     text NOT NULL,                 -- GENERATE_PDF | SEND_EMAIL | RECOMPUTE_PAYRUN
  entity_type   text NOT NULL,                 -- PAYSLIP | PAYRUN
  entity_id     uuid NOT NULL,
  payrun_id     uuid REFERENCES payruns(id) ON DELETE CASCADE,
  dedupe_key    text NOT NULL,
  queue_name    text NOT NULL,
  job_id        text,
  payload       jsonb NOT NULL DEFAULT '{}'::jsonb,
  status        queue_status NOT NULL DEFAULT 'PENDING',
  priority      integer NOT NULL DEFAULT 0,
  attempts      integer NOT NULL DEFAULT 0,
  max_attempts  integer NOT NULL DEFAULT 3,
  error_message text,
  scheduled_at  timestamptz NOT NULL DEFAULT now(),
  processed_at  timestamptz,
  completed_at  timestamptz,
  failed_at     timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (dedupe_key),
  CONSTRAINT ck_task_attempts CHECK (attempts <= max_attempts)
);
CREATE INDEX idx_task_pending ON task_queue(scheduled_at) WHERE status IN ('PENDING','PROCESSING');
CREATE INDEX idx_task_payrun ON task_queue(payrun_id, task_type, status);

CREATE TABLE email_deliveries (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payslip_id       uuid NOT NULL REFERENCES payslips(id) ON DELETE CASCADE,
  payrun_id        uuid REFERENCES payruns(id) ON DELETE CASCADE,
  document_version integer NOT NULL DEFAULT 1,
  recipient        text NOT NULL,
  employee_name    text,
  subject          text NOT NULL,
  status           delivery_status NOT NULL DEFAULT 'QUEUED',
  message_id       text,
  preview_url      text,
  error            text,
  attempts         integer NOT NULL DEFAULT 0,
  queued_at        timestamptz NOT NULL DEFAULT now(),
  sent_at          timestamptz,
  UNIQUE (payslip_id, document_version),
  CONSTRAINT ck_mail_sent CHECK (status <> 'SENT' OR sent_at IS NOT NULL)
);
CREATE INDEX idx_mail_payrun ON email_deliveries(payrun_id, status);
