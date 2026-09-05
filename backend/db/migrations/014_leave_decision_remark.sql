-- 014 · the approver's note, which the API has been accepting and throwing away.
--
-- refuse_reason (005) has always existed and is what refusing requires. There was no column for a note written
-- while APPROVING, so the remark box on the decision dialog had nowhere to go and the field was dropped by the
-- body validator. decision_remark is that column. It stays separate from the employee's own `reason` so the two
-- can never overwrite each other, and a refusal keeps writing refuse_reason as well because the balance
-- screens and the API tests read that one.
alter table time_off_requests add column if not exists decision_remark text;

comment on column time_off_requests.decision_remark is 'What the approver wrote with the decision; shown to the employee next to the status.';
