/**
 * One place that says what a leave request does to pay.
 *
 * The rules live on the leave type (its category, and whether it is paid or unpaid) and are set under
 * Time-off types; this file only puts them into a sentence. Both the employee's request dialog and the
 * approver's decision dialog call it, so the two screens cannot disagree about what a day of LWP costs.
 */
export function payoffOf(type) {
  if (!type) return null;
  const cat = String(type.category || 'OTHER').replace(/_/g, ' ').toLowerCase();
  if (type.is_unpaid || type.pay_treatment === 'UNPAID') {
    return { tone: 'warn', text: 'Unpaid — these days go to Loss of Pay on the next payslip.' };
  }
  if (type.requires_allocation) {
    return { tone: 'good', text: 'Paid from the ' + cat + ' balance — no payslip line, the days come off what is granted.' };
  }
  return { tone: 'good', text: 'Paid leave (' + cat + ') — not counted against a balance.' };
}

/** The same sentence from a request row, which carries the type's flags rather than the type itself. */
export function payoffOfRow(row) {
  if (!row) return null;
  return payoffOf({ is_unpaid: row.is_unpaid, requires_allocation: row.requires_allocation, category: row.category });
}

/** A short label for a chip: Casual, Sick, Privilege… */
export function categoryLabel(value) {
  const text = String(value || '').toLowerCase().replace(/_/g, ' ');
  return text ? text.replace(/\b\w/g, (c) => c.toUpperCase()) : 'Other';
}
