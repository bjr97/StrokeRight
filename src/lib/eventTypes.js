export const EVENT_TYPES = [
  { value: 'wm_open', label: 'WM Open' },
  { value: 'masters', label: 'The Masters' },
  { value: 'us_open', label: 'US Open' },
  { value: 'pga',     label: 'PGA Championship' },
  { value: 'open',    label: 'Open Championship' },
  { value: 'other',   label: 'Other' },
];

export const EVENT_TYPE_LABEL = Object.fromEntries(EVENT_TYPES.map((e) => [e.value, e.label]));

export function eventTypeLabel(value) {
  return EVENT_TYPE_LABEL[value] || EVENT_TYPE_LABEL.other;
}
