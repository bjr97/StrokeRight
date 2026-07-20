export const EVENT_TYPES = [
  { value: 'wm_open', label: 'WM Open' },
  { value: 'players', label: 'The Players' },
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

// No true "green jacket" emoji exists in Unicode — 🧥 (coat) is the closest
// real stand-in and is what people commonly use for it. WM Open uses 🗑️,
// leaning into the event's own "trash can" reputation, not a real trophy.
// The Players uses 🏝️ for the famous island-green 17th at TPC Sawgrass —
// wasn't in the original spec, so flag if you'd rather use something else.
export const EVENT_TYPE_EMOJI = {
  masters: '🧥',
  us_open: '🇺🇸',
  pga: '🏌️',
  open: '🏆',
  wm_open: '🗑️',
  players: '🏝️',
};

export function eventTypeEmoji(value) {
  return EVENT_TYPE_EMOJI[value] || '';
}

// Naming template per type -- deliberately distinct from the dropdown label
// above (e.g. "Masters" here vs "The Masters" in the picker), to match the
// naming convention already used throughout the app's existing data ("2025
// Masters", "2026 Open Championship", etc).
const NAME_TEMPLATE = {
  wm_open: 'WM Open',
  players: 'The Players',
  masters: 'Masters',
  us_open: 'US Open',
  pga: 'PGA Championship',
  open: 'Open Championship',
};

// Auto-generates "{year} {template}" from an event type + any date string
// (YYYY-MM-DD or full ISO both work). Returns null for 'other' (manual entry
// applies there) or when there's no usable date yet to pull a year from.
export function autoTournamentName(eventType, dateStr) {
  if (eventType === 'other' || !dateStr) return null;
  const year = parseInt(String(dateStr).slice(0, 4), 10);
  if (!Number.isFinite(year)) return null;
  const template = NAME_TEMPLATE[eventType];
  if (!template) return null;
  return `${year} ${template}`;
}
