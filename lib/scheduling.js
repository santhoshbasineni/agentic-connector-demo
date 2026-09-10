// Org-side scheduling: practitioners, recurring weekly availability patterns,
// and deterministic expansion of those patterns into individual bookable slots.
//
// Slot ids are derived from (patternId, date, time), so regenerating a pattern
// is idempotent — re-expanding never duplicates a slot that already exists.

export const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const DEFAULT_LOOKAHEAD_WEEKS = 3;

export function isoDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate()
  ).padStart(2, '0')}`;
}

export function todayISO() {
  return isoDate(new Date());
}

function parseHHMM(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

function fmtTime(minutes) {
  const h24 = Math.floor(minutes / 60);
  const m = minutes % 60;
  const ampm = h24 >= 12 ? 'PM' : 'AM';
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
}

// "Mon Sep 14, 9:00 AM"
export function formatWhen(dateISO, minutes) {
  const [y, mo, d] = dateISO.split('-').map(Number);
  const dt = new Date(y, mo - 1, d);
  const month = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][
    dt.getMonth()
  ];
  return `${DAY_NAMES[dt.getDay()]} ${month} ${dt.getDate()}, ${fmtTime(minutes)}`;
}

export function describePattern(pattern) {
  const days = pattern.days.map((d) => DAY_NAMES[d]).join('/');
  return `${days}, ${fmtTime(parseHHMM(pattern.start))}–${fmtTime(parseHHMM(pattern.end))} (${
    pattern.slotMinutes
  } min slots)`;
}

// Expand one recurring pattern into concrete slot objects across the
// look-ahead window, skipping dates blocked for that practitioner.
export function expandPattern(pattern, practitioner, { weeks, blockedDates = [] }) {
  const lookahead = weeks || pattern.weeks || DEFAULT_LOOKAHEAD_WEEKS;
  const startMin = parseHHMM(pattern.start);
  const endMin = parseHHMM(pattern.end);
  const step = pattern.slotMinutes || 60;
  const blocked = new Set(
    blockedDates.filter((b) => b.practitionerId === pattern.practitionerId).map((b) => b.date)
  );

  const slots = [];
  const base = new Date();
  base.setHours(0, 0, 0, 0);
  for (let i = 0; i < lookahead * 7; i++) {
    const d = new Date(base);
    d.setDate(base.getDate() + i);
    if (!pattern.days.includes(d.getDay())) continue;
    const dateISO = isoDate(d);
    if (blocked.has(dateISO)) continue;
    for (let m = startMin; m + step <= endMin; m += step) {
      slots.push({
        id: `slot-${pattern.id}-${dateISO}-${String(m).padStart(4, '0')}`,
        patternId: pattern.id,
        practitionerId: practitioner.id,
        practitioner: practitioner.name,
        specialty: practitioner.specialty,
        clinic: practitioner.clinic,
        date: dateISO,
        minutes: m,
        when: formatWhen(dateISO, m),
        booked: false,
      });
    }
  }
  return slots;
}

export function sortSlots(slots) {
  return [...slots].sort((a, b) =>
    a.date === b.date ? a.minutes - b.minutes : a.date < b.date ? -1 : 1
  );
}

// Regenerate slots for one pattern in place: drop that pattern's future
// unbooked slots, keep booked ones and anything in the past, then add back
// only the slot ids that are missing. Idempotent by construction.
export function regeneratePatternSlots(store, patternId) {
  const pattern = store.availabilityPatterns.find((p) => p.id === patternId);
  const today = todayISO();
  if (!pattern) {
    store.apptSlots = store.apptSlots.filter(
      (s) => s.patternId !== patternId || s.booked || s.date < today
    );
    return { added: 0, removed: 0 };
  }
  const practitioner = store.practitioners.find((p) => p.id === pattern.practitionerId);
  if (!practitioner) return { added: 0, removed: 0 };

  const before = store.apptSlots.length;
  store.apptSlots = store.apptSlots.filter(
    (s) => s.patternId !== patternId || s.booked || s.date < today
  );
  const removed = before - store.apptSlots.length;

  const existing = new Set(store.apptSlots.map((s) => s.id));
  const fresh = expandPattern(pattern, practitioner, {
    weeks: pattern.weeks,
    blockedDates: store.blockedDates || [],
  }).filter((s) => !existing.has(s.id));

  store.apptSlots = sortSlots([...store.apptSlots, ...fresh]);
  return { added: fresh.length, removed };
}

export function regenerateAllSlots(store) {
  let added = 0;
  for (const p of store.availabilityPatterns) added += regeneratePatternSlots(store, p.id).added;
  return added;
}

// Open slots, soonest first, optionally filtered by specialty (case-insensitive
// substring so "orthopedic" matches "Orthopedics").
export function openSlots(store, { specialty, limit } = {}) {
  const today = todayISO();
  let slots = sortSlots(store.apptSlots.filter((s) => !s.booked && s.date >= today));
  if (specialty) {
    const q = String(specialty).toLowerCase();
    const matched = slots.filter(
      (s) =>
        s.specialty.toLowerCase().includes(q) ||
        q.includes(s.specialty.toLowerCase().split(' ')[0])
    );
    if (matched.length) slots = matched;
  }
  return limit ? slots.slice(0, limit) : slots;
}
