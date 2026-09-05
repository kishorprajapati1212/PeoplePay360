/**
 * The Indian state / union-territory list, kept here because three screens ask for it (an employee's address,
 * the company's registered state, and the state Professional Tax is charged in) and a payroll app that spells
 * a state two ways gets two PT rules.
 *
 * Ordered the way the Census lists them, then the union territories — a dropdown should read like the map,
 * not like a hash map.
 */
export const INDIAN_STATES = [
  'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chhattisgarh', 'Goa', 'Gujarat', 'Haryana', 'Himachal Pradesh',
  'Jharkhand', 'Karnataka', 'Kerala', 'Madhya Pradesh', 'Maharashtra', 'Odisha', 'Punjab', 'Rajasthan',
  'Sikkim', 'Tamil Nadu', 'Telangana', 'Tripura', 'Uttar Pradesh', 'Uttarakhand', 'West Bengal',
  'Meghalaya', 'Manipur', 'Mizoram', 'Nagaland',
  'Chandigarh', 'Delhi', 'Jammu and Kashmir', 'Ladakh', 'Puducherry', 'Andaman and Nicobar Islands',
  'Dadra and Nagar Haveli and Daman and Diu', 'Lakshadweep',
];

/** The states with a Professional Tax of their own — the list a payroll person actually filters on. */
export const PT_STATES = ['Maharashtra', 'Karnataka', 'Telangana', 'Gujarat', 'Tamil Nadu', 'West Bengal', 'Bihar', 'Jharkhand', 'Odisha', 'Assam', 'Kerala', 'Madhya Pradesh'];

export const isIndianState = (name) => INDIAN_STATES.includes(String(name || '').trim());
export const stateOptions = () => INDIAN_STATES.map((s) => ({ value: s, label: s, hint: PT_STATES.includes(s) ? 'Professional Tax applies' : '' }));
