-- ── updated_at ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION fn_touch_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
           WHERE n.nspname='public' AND c.relkind='r'
             AND EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid=c.oid AND a.attname='updated_at')
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_touch_%1$s ON %1$I', t);
    EXECUTE format('CREATE TRIGGER trg_touch_%1$s BEFORE UPDATE ON %1$I FOR EACH ROW EXECUTE FUNCTION fn_touch_updated_at()', t);
  END LOOP;
END $$;

-- ── time math that survives night shifts (fixes the 22:00→06:00 = -16h bug) ──
CREATE OR REPLACE FUNCTION day_hours(p_start time, p_end time, p_break integer)
RETURNS numeric LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN p_start IS NULL OR p_end IS NULL THEN 0
         ELSE GREATEST(0,
                (EXTRACT(EPOCH FROM (p_end - p_start))
                 + CASE WHEN p_end <= p_start THEN 86400 ELSE 0 END) / 3600.0
                - COALESCE(p_break, 0) / 60.0)
  END
$$;

-- schedule totals derived from the day rows (never typed by hand)
CREATE OR REPLACE FUNCTION fn_schedule_totals() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE working_schedules w
     SET total_weekly_hours = COALESCE((SELECT SUM(day_hours(d.start_time, d.end_time, d.break_minutes))
                                        FROM working_schedule_days d
                                        WHERE d.schedule_id = w.id AND NOT d.is_rest_day), 0),
         days_per_week      = COALESCE((SELECT COUNT(DISTINCT d.day_of_week)
                                        FROM working_schedule_days d
                                        WHERE d.schedule_id = w.id AND NOT d.is_rest_day
                                          AND day_hours(d.start_time, d.end_time, d.break_minutes) > 0), 0)
   WHERE w.id = COALESCE(NEW.schedule_id, OLD.schedule_id);
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS trg_schedule_days_totals ON working_schedule_days;
CREATE TRIGGER trg_schedule_days_totals
AFTER INSERT OR UPDATE OR DELETE ON working_schedule_days
FOR EACH ROW EXECUTE FUNCTION fn_schedule_totals();

-- ── contract resolution: DATE-based, so retro / half-month / past periods work ──
CREATE OR REPLACE FUNCTION contract_for_period(p_employee uuid, p_from date, p_to date)
RETURNS contracts LANGUAGE sql STABLE AS $$
  SELECT c.* FROM contracts c
  WHERE c.employee_id = p_employee
    AND c.status <> 'DRAFT'
    AND c.start_date <= p_to
    AND (c.end_date IS NULL OR c.end_date >= p_from)
  ORDER BY c.is_primary DESC NULLS LAST, c.start_date DESC, c.id DESC
  LIMIT 1;
$$;

-- Expected working days for a person inside a range: schedule pattern − holidays, clamped to
-- joining/exit dates. Single source of truth for proration, coverage and LOP.
CREATE OR REPLACE FUNCTION expected_days(p_employee uuid, p_from date, p_to date)
RETURNS integer LANGUAGE sql STABLE AS $$
  WITH base AS (
    SELECT e.id,
           greatest(p_from, e.date_of_joining) AS f,
           least(p_to, COALESCE(e.date_of_exit, p_to)) AS t,
           COALESCE((SELECT c.working_schedule_id FROM contracts c
                      WHERE c.employee_id = e.id
                        AND c.start_date <= p_to AND (c.end_date IS NULL OR c.end_date >= p_from)
                      ORDER BY c.is_primary DESC NULLS LAST, c.start_date DESC LIMIT 1),
                    e.working_schedule_id) AS sid
    FROM employees e WHERE e.id = p_employee
  ), days AS (
    SELECT b.sid, d::date AS day, EXTRACT(ISODOW FROM d)::smallint AS dow
    FROM base b, generate_series(b.f, b.t, interval '1 day') d
  )
  SELECT COUNT(*)::int FROM days dd
  WHERE dd.day <= (SELECT t FROM base) AND dd.day >= (SELECT f FROM base)
    AND (dd.sid IS NULL
         OR EXISTS (SELECT 1 FROM working_schedule_days wsd
                     WHERE wsd.schedule_id = dd.sid AND wsd.day_of_week = dd.dow AND NOT wsd.is_rest_day
                       AND day_hours(wsd.start_time, wsd.end_time, wsd.break_minutes) > 0))
    AND NOT EXISTS (SELECT 1 FROM holidays h WHERE h.day = dd.day)
$$;

-- ── totals: derived from lines so a manual line edit can never desync the payslip ──
CREATE OR REPLACE FUNCTION recalc_payslip_totals(p_payslip uuid) RETURNS void LANGUAGE sql AS $$
  -- the SET list may not read the update target's alias, so every reference goes through p_payslip
  UPDATE payslips SET
    gross_amount     = COALESCE((SELECT SUM(l.amount) FROM payslip_lines l
                                 WHERE l.payslip_id = p_payslip AND l.line_kind = 'EARNING'), 0),
    total_deductions = COALESCE((SELECT SUM(l.amount) FROM payslip_lines l
                                 WHERE l.payslip_id = p_payslip AND l.line_kind = 'DEDUCTION'), 0),
    total_adjustments= COALESCE((SELECT SUM(l.amount) FROM payslip_lines l
                                 WHERE l.payslip_id = p_payslip AND l.line_kind = 'ADJUSTMENT'), 0),
    net_amount       = COALESCE((SELECT SUM(CASE l.line_kind WHEN 'DEDUCTION' THEN -l.amount ELSE l.amount END)
                                 FROM payslip_lines l
                                 WHERE l.payslip_id = p_payslip AND l.line_kind <> 'REPORT'), 0)
  WHERE id = p_payslip;
$$;

CREATE OR REPLACE FUNCTION fn_payslip_lines_changed() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM recalc_payslip_totals(COALESCE(NEW.payslip_id, OLD.payslip_id));
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS trg_payslip_lines_totals ON payslip_lines;
CREATE TRIGGER trg_payslip_lines_changed
AFTER INSERT OR UPDATE OR DELETE ON payslip_lines
FOR EACH ROW EXECUTE FUNCTION fn_payslip_lines_changed();

-- PAID is immutable: corrections go through an ARREAR payslip, never by editing history.
CREATE OR REPLACE FUNCTION fn_payslip_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_status payslip_status;
BEGIN
  IF OLD.status = 'PAID' AND NEW.status = 'PAID'
     AND (NEW.gross_amount, NEW.total_deductions, NEW.net_amount)
         IS DISTINCT FROM (OLD.gross_amount, OLD.total_deductions, OLD.net_amount) THEN
    RAISE EXCEPTION 'Payslip is PAID and locked; raise an arrear instead of editing it';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_payslip_immutable ON payslips;
CREATE TRIGGER trg_payslip_immutable BEFORE UPDATE ON payslips
FOR EACH ROW EXECUTE FUNCTION fn_payslip_immutable();

CREATE OR REPLACE FUNCTION fn_payslip_lines_locked() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_status payslip_status;
BEGIN
  SELECT status INTO v_status FROM payslips WHERE id = COALESCE(NEW.payslip_id, OLD.payslip_id);
  IF v_status = 'PAID' THEN
    RAISE EXCEPTION 'Cannot modify lines of a PAID payslip';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;
DROP TRIGGER IF EXISTS trg_payslip_lines_locked ON payslip_lines;
CREATE TRIGGER trg_payslip_lines_locked
BEFORE INSERT OR UPDATE OR DELETE ON payslip_lines
FOR EACH ROW EXECUTE FUNCTION fn_payslip_lines_locked();

CREATE OR REPLACE FUNCTION recalc_payrun_totals(p_payrun uuid) RETURNS void LANGUAGE sql AS $$
  UPDATE payruns SET
    total_gross      = COALESCE((SELECT SUM(p.gross_amount)      FROM payslips p WHERE p.payrun_id = p_payrun AND p.status <> 'VOID'), 0),
    total_deductions = COALESCE((SELECT SUM(p.total_deductions)  FROM payslips p WHERE p.payrun_id = p_payrun AND p.status <> 'VOID'), 0),
    total_net        = COALESCE((SELECT SUM(p.net_amount)        FROM payslips p WHERE p.payrun_id = p_payrun AND p.status <> 'VOID'), 0),
    employer_cost    = COALESCE((SELECT SUM(p.employer_cost)     FROM payslips p WHERE p.payrun_id = p_payrun AND p.status <> 'VOID'), 0),
    payslip_count    = COALESCE((SELECT COUNT(*)                 FROM payslips p WHERE p.payrun_id = p_payrun AND p.status <> 'VOID'), 0),
    employee_count   = COALESCE((SELECT COUNT(*)                 FROM payrun_employees pe WHERE pe.payrun_id = p_payrun AND pe.is_selected), 0)
  WHERE id = p_payrun;
$$;

-- leave overlap guard (a second request may not reuse the same dates)
CREATE OR REPLACE FUNCTION fn_timeoff_no_overlap() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM time_off_requests x
             WHERE x.employee_id = NEW.employee_id AND x.id <> NEW.id
               AND x.status IN ('DRAFT','TO_APPROVE','APPROVED')
               AND daterange(x.start_date, x.end_date, '[]') && daterange(NEW.start_date, NEW.end_date, '[]')) THEN
    RAISE EXCEPTION 'Overlapping time off request for these dates';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_timeoff_overlap ON time_off_requests;
CREATE TRIGGER trg_timeoff_overlap BEFORE INSERT OR UPDATE OF start_date, end_date ON time_off_requests
FOR EACH ROW EXECUTE FUNCTION fn_timeoff_no_overlap();

-- payslip period overlap guard (prevents paying the same days twice across payruns)
CREATE OR REPLACE FUNCTION fn_payslip_no_overlap() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM payslips x
             WHERE x.employee_id = NEW.employee_id AND x.id IS DISTINCT FROM NEW.id
               AND x.status <> 'VOID'
               AND daterange(x.period_start, x.period_end, '[]') && daterange(NEW.period_start, NEW.period_end, '[]')) THEN
    RAISE EXCEPTION 'DUPLICATE_PERIOD: a payslip already exists for overlapping dates (%)',
                    (SELECT period_key FROM payslips x
                      WHERE x.employee_id = NEW.employee_id AND x.id IS DISTINCT FROM NEW.id AND x.status <> 'VOID'
                        AND daterange(x.period_start, x.period_end, '[]') && daterange(NEW.period_start, NEW.period_end, '[]')
                      LIMIT 1);
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_payslip_overlap ON payslips;
CREATE TRIGGER trg_payslip_overlap BEFORE INSERT OR UPDATE OF period_start, period_end ON payslips
FOR EACH ROW EXECUTE FUNCTION fn_payslip_no_overlap();
