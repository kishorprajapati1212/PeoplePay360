-- Multi-session punching (bug fix: "check-in/out toggle + worked hours").
-- The kiosk state machine used to be one IN and one OUT per employee-day; a third punch was refused
-- with ALREADY_CLOCKED_OUT. Real people go to lunch and come back, so the clock endpoint now keeps
-- a session list here while check_in/check_out stay the first-in / last-out the payroll engine reads.
-- worked_hours remains the sum of the sessions, not the span, so payroll never pays a lunch break twice.
ALTER TABLE attendance ADD COLUMN IF NOT EXISTS punches jsonb NOT NULL DEFAULT '[]'::jsonb;

-- Backfill: any row punched the old way becomes a single session, so the UI can read one shape.
UPDATE attendance
   SET punches = jsonb_build_array(jsonb_build_object('in', check_in, 'out', check_out))
 WHERE punches = '[]'::jsonb
   AND check_in IS NOT NULL;
