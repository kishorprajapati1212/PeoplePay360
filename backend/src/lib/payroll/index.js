/**
 * The payroll library, in six small files. Reading them in this order is reading a payslip being made:
 *
 *   settings.js    the company's decisions, once, as a plain object (day basis, PF ceiling, OT multiplier…)
 *   context.js     what a rule's formula is allowed to see (days worked, hours, inputs, earlier slips)
 *   engine.js      rules in → lines out → totals added from those lines
 *   resolvers.js   the statutory lines (PF, ESI, PT, OT), because those are rules the state wrote for us
 *   halfmonth.js   a month split in two: the factor for each half and the true-up at the end
 *   validation.js  the warnings a payrun shows, without ever blocking a run
 *
 * docs/13-how-a-payslip-is-computed.md walks through a month with numbers and points at each of these.
 */
export * from './settings.js';
export * from './context.js';
export * from './engine.js';
export * from './halfmonth.js';
export * from './validation.js';
export * from './resolvers.js';
