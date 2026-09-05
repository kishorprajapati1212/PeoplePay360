/**
 * The words a time-off request can carry, kept in one place.
 *
 * The database enum is `('DRAFT','TO_APPROVE','APPROVED','REFUSED','CANCELLED')` — see
 * `backend/db/migrations/001_enums.sql`, `request_status`. There is no `PENDING` in it. Four screens compared
 * `status` against the string `'PENDING'`, which can never be true, and each one read to the user as a missing
 * feature: the Approve/Refuse buttons on the requests list, the "Pending" option in its filter, the Cancel button
 * an employee has on their own request, and the waiting list on the time-off overview. Anything that asks "is this
 * waiting for somebody" now asks here, so the fifth screen that needs it cannot get it wrong again.
 */
export const REQUEST_STATUS = {
  DRAFT: 'DRAFT',
  WAITING: 'TO_APPROVE',
  APPROVED: 'APPROVED',
  REFUSED: 'REFUSED',
  CANCELLED: 'CANCELLED',
};

/** What the row is called in the database, in the words a person would use. */
export const STATUS_LABEL = {
  DRAFT: 'Draft',
  TO_APPROVE: 'Waiting for approval',
  APPROVED: 'Approved',
  REFUSED: 'Refused',
  CANCELLED: 'Cancelled',
};

/** The `Select` options for a status filter: value from the enum, label from the sentence above. */
export const STATUS_OPTIONS = Object.values(REQUEST_STATUS).map((value) => ({ value, label: STATUS_LABEL[value] }));

/** Waiting, in either spelling a caller might hand us — old code paths used 'PENDING'. */
export const isWaiting = (row) => row?.status === REQUEST_STATUS.WAITING;

/** Only a request nobody has answered can be pulled back by the person who raised it. */
export const isCancellable = (row) => isWaiting(row) || row?.status === REQUEST_STATUS.DRAFT;
