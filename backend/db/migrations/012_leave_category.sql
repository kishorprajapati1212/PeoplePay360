-- 012 · the leave-type things every HR person asks for, that the first schema left as booleans.
--
-- `category` is the family a type belongs to (Casual, Sick, Earned…). It is a label, not a rule:
-- whether a day is paid stays driven by `is_unpaid` and `payslip_code`, so adding a category cannot
-- silently change a payslip. The CHECK list is the same one the UI dropdown and the API validator use.
alter table time_off_types add column if not exists category text;
alter table time_off_types
  drop constraint if exists time_off_types_category_check,
  add constraint time_off_types_category_check check (
    category is null or category in ('CASUAL','SICK','EARNED','PRIVILEGED','COMPENSATORY','MATERNITY','PATERNITY','UNPAID','LOP','OTHER'));

-- Payroll reads a category the way it reads a code: exact text. The index is for the time-off report
-- and the "which types are paid?" filter, both of which scan every type.
create index if not exists time_off_types_category_idx on time_off_types (category nulls last);

comment on column time_off_types.category is 'Family the type belongs to (CASUAL, SICK, …). Display and grouping only — pay comes from is_unpaid / payslip_code.';
