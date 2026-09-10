// Shared state-mutating actions. The HTTP API routes (used by the four views)
// and the MCP servers (used by the patient-side LLM agent) both call these,
// so there is exactly one implementation of each transaction.

import {
  getStore,
  addPatientEvent,
  addCase,
  addPayerRequest,
  nextId,
  activeAppointments,
} from '@/lib/store';
import { openSlots, regeneratePatternSlots, regenerateAllSlots } from '@/lib/scheduling';

// EE — Emergency Escalation (deterministic path, never LLM tool-routed)
export function fireEE(text, reason) {
  const s = getStore();
  s.eeAlerts.push({ id: `ee-${Date.now()}`, keyword: reason, text, ts: Date.now() });
  addPatientEvent({
    role: 'ai',
    kind: 'EE',
    text: `🚨 EMERGENCY ESCALATION (EE) — red-flag symptoms detected (${reason}). This bypasses the async review queue entirely. Please call 911 or go to the nearest emergency department now. Your care team has been notified.`,
  });
  return { transaction: 'EE', reason };
}

// ARR — Async Review Request (+ automatic CEC)
export function submitARR(summary, { notifyPatient = true } = {}) {
  const c = addCase({
    source: 'patient',
    patient: 'Demo Patient',
    summary,
    aiSuggestion:
      'AI-suggested disposition: low-acuity presentation. Recommend self-care guidance with 48-hour check-in; escalate to in-person visit only if symptoms worsen. (Physician confirmation required.)',
  });
  addPayerRequest('CEC', `Coverage eligibility for Demo Patient (case ${c.id})`);
  if (notifyPatient) {
    addPatientEvent({
      role: 'ai',
      kind: 'ARR',
      text: `Thanks — no red-flag symptoms detected. I've submitted an Async Review Request (ARR): case ${c.id} is now in the physician review queue. A coverage eligibility check (CEC) was sent to your payer in parallel. You'll hear back here once a physician reviews it.`,
    });
  }
  return c;
}

// RC — Review Claim
export function claimCase(caseId) {
  const s = getStore();
  const c = s.cases.find((x) => x.id === caseId);
  if (!c) return { error: 'case not found' };
  if (c.status !== 'open') return { error: `case is ${c.status}, not open` };
  c.status = 'claimed';
  c.claimedBy = 'Dr. Demo';
  c.claimedAt = Date.now();
  return { transaction: 'RC', case: c };
}

// Cost/fit comparison over data already in the system: the payer's mock
// CES pricing + the org's exposed availability (AU). Used when presenting
// booking options so slots are never listed bare. When a specialty is known
// (e.g. from a redirect reason), matching practitioners are preferred.
export function bookingComparison(specialty) {
  const s = getStore();
  const free = openSlots(s, { specialty });
  if (free.length === 0) return 'No open slots are exposed right now.';
  const earliest = free[0];
  const inNet = PAYER_OUTCOME.options.find((o) => o.provider.includes('in-network'));
  const outNet = PAYER_OUTCOME.options.find((o) => o.provider.includes('out-of-network'));
  const lines = [
    `• Best cost: City Clinic — in-network, est. ${inNet.estimate} (vs ${outNet.provider}, est. ${outNet.estimate}).`,
    `• Soonest: ${earliest.when} with ${earliest.practitioner} (${earliest.specialty}) at ${earliest.clinic}.`,
  ];
  if (specialty) {
    lines.push(`• Specialty match: prioritizing ${specialty} availability for this referral.`);
  }
  return lines.join('\n');
}

// A redirect's specialty is inferred from the case text using the specialties
// actually configured in the practitioner directory.
export function inferSpecialty(text) {
  const s = getStore();
  const t = String(text || '').toLowerCase();
  const hints = {
    Orthopedics: ['back', 'knee', 'joint', 'shoulder', 'fracture', 'sprain', 'ankle', 'lifting', 'orthoped'],
    'Family Medicine': ['fever', 'cough', 'cold', 'sore throat', 'rash', 'flu'],
    'Internal Medicine': ['blood pressure', 'diabetes', 'cholesterol', 'fatigue', 'lipid', 'anemia'],
  };
  for (const p of s.practitioners) {
    if (t.includes(p.specialty.toLowerCase())) return p.specialty;
  }
  for (const [specialty, words] of Object.entries(hints)) {
    if (!s.practitioners.some((p) => p.specialty === specialty)) continue;
    if (words.some((w) => t.includes(w))) return specialty;
  }
  return null;
}

// DR — Disposition Response
export function setDisposition(caseId, action) {
  if (action !== 'confirm' && action !== 'redirect') {
    return { error: "action must be 'confirm' or 'redirect'" };
  }
  const s = getStore();
  const c = s.cases.find((x) => x.id === caseId);
  if (!c) return { error: 'case not found' };
  if (c.status !== 'claimed') return { error: `case is ${c.status}, not claimed` };

  c.status = 'resolved';
  c.disposition = action;
  c.resolvedAt = Date.now();

  const notifyPatient = c.patient === 'Demo Patient';
  const specialty = inferSpecialty(c.summary);
  if (specialty) c.redirectSpecialty = specialty;
  if (action === 'confirm') {
    if (notifyPatient) {
      addPatientEvent({
        role: 'ai',
        kind: 'DR',
        text: `Disposition (DR) for case ${c.id}: the physician CONFIRMED the AI suggestion — ${c.aiSuggestion}`,
      });
    }
  } else if (notifyPatient) {
    addPatientEvent({
      role: 'ai',
      kind: 'DR',
      text: `Disposition (DR) for case ${c.id}: the physician REDIRECTED you to an in-person visit. Comparing your options (org AU + payer CES):\n${bookingComparison(specialty)}\nPick a slot below — I'm also requesting a formal cost estimate (CER) from your payer.`,
    });
    addPatientEvent({ role: 'ai', kind: 'slots', data: { caseId: c.id, specialty } });
    addPayerRequest('CER', `Cost estimate for in-person visit (case ${c.id})`, {
      notifyPatient: true,
    });
  }
  return { transaction: 'DR', case: c };
}

// APR → APC — appointment booking against the org's exposed availability (AU).
// Slots now carry real practitioner identity, so confirmations name the actual
// doctor and specialty from the org's config — never an invented name.
export function bookAppointment(slotId, { notifyPatient = true } = {}) {
  const s = getStore();
  const slot = s.apptSlots.find((x) => x.id === slotId);
  if (!slot) return { error: 'slot not found' };
  if (slot.booked) return { error: 'slot already booked' };

  slot.booked = true;
  const appt = {
    id: nextId('APT'),
    facility: 'org',
    status: 'confirmed',
    slotId: slot.id,
    when: slot.when,
    clinic: slot.clinic,
    practitioner: slot.practitioner,
    specialty: slot.specialty,
    patient: 'Demo Patient',
    bookedAt: Date.now(),
  };
  s.appointments.push(appt);
  if (notifyPatient) {
    addPatientEvent({
      role: 'ai',
      kind: 'APC',
      text: `Appointment confirmed (APR → APC): ${slot.when} with ${slot.practitioner} (${slot.specialty}) at ${slot.clinic}. Confirmation ${appt.id}.`,
    });
  }
  return { transaction: 'APC', appointment: appt };
}

// Lab specimen-collection booking — the lab keeps its simple slot-string list,
// but its bookings now live in the same appointment ledger so update/cancel
// work identically across facilities.
export function bookLabSlot(slotLabel) {
  const s = getStore();
  const i = s.labSlots.indexOf(slotLabel);
  if (i === -1) return { error: 'slot not found', available: s.labSlots };
  s.labSlots.splice(i, 1);
  const appt = {
    id: nextId('APT'),
    facility: 'lab',
    status: 'confirmed',
    slotId: slotLabel,
    when: slotLabel,
    clinic: 'Central Laboratory',
    patient: 'Demo Patient',
    bookedAt: Date.now(),
  };
  s.appointments.push(appt);
  return { transaction: 'APC', appointment: appt };
}

function releaseSlot(appt) {
  const s = getStore();
  if (appt.facility === 'lab') {
    if (!s.labSlots.includes(appt.slotId)) s.labSlots.push(appt.slotId);
    return;
  }
  const slot = s.apptSlots.find((x) => x.id === appt.slotId);
  if (slot) slot.booked = false;
}

function findActiveAppointment(appointmentId, facility) {
  const active = activeAppointments().filter((a) => !facility || a.facility === facility);
  if (appointmentId) {
    const exact = active.find((a) => a.id === appointmentId);
    if (exact) return exact;
    const known = getStore().appointments.find((a) => a.id === appointmentId);
    return known ? { error: `appointment ${appointmentId} is already ${known.status}` } : { error: `appointment ${appointmentId} not found` };
  }
  if (active.length === 1) return active[0];
  if (active.length === 0) {
    return { error: `no active ${facility || ''} appointment to modify`.replace('  ', ' ') };
  }
  return {
    error: 'multiple active appointments — specify appointment_id',
    appointments: active.map((a) => ({ id: a.id, when: a.when, facility: a.facility })),
  };
}

// Cancel: releases the slot back into that facility's availability.
export function cancelAppointment(appointmentId, { facility } = {}) {
  const appt = findActiveAppointment(appointmentId, facility);
  if (appt.error) return appt;
  appt.status = 'cancelled';
  appt.cancelledAt = Date.now();
  releaseSlot(appt);
  return {
    transaction: 'APC-CANCEL',
    cancelled: { id: appt.id, when: appt.when, facility: appt.facility },
    note: 'Slot released back into availability.',
  };
}

// Update: move an existing confirmed appointment to a different slot.
export function updateAppointment(appointmentId, newSlotId, { facility } = {}) {
  const s = getStore();
  const appt = findActiveAppointment(appointmentId, facility);
  if (appt.error) return appt;
  if (!newSlotId) return { error: 'new_slot_id is required' };

  if (appt.facility === 'lab') {
    const i = s.labSlots.indexOf(newSlotId);
    if (i === -1) return { error: 'new slot not found', available: s.labSlots };
    const previous = appt.when;
    s.labSlots.splice(i, 1);
    releaseSlot(appt);
    appt.slotId = newSlotId;
    appt.when = newSlotId;
    appt.updatedAt = Date.now();
    return { transaction: 'APC-UPDATE', previous, appointment: appt };
  }

  const slot = s.apptSlots.find((x) => x.id === newSlotId);
  if (!slot) return { error: 'new slot not found' };
  if (slot.booked) return { error: 'new slot already booked' };
  const previous = appt.when;
  releaseSlot(appt);
  slot.booked = true;
  appt.slotId = slot.id;
  appt.when = slot.when;
  appt.clinic = slot.clinic;
  appt.practitioner = slot.practitioner;
  appt.specialty = slot.specialty;
  appt.updatedAt = Date.now();
  return { transaction: 'APC-UPDATE', previous, appointment: appt };
}

// --- Org config: practitioners + recurring availability --------------------

export function upsertPractitioner({ id, name, specialty, clinic }) {
  const s = getStore();
  if (!name || !specialty) return { error: 'name and specialty are required' };
  if (id) {
    const p = s.practitioners.find((x) => x.id === id);
    if (!p) return { error: 'practitioner not found' };
    Object.assign(p, { name, specialty, clinic: clinic || p.clinic });
    regenerateAllSlots(s); // names/specialties are denormalized onto slots
    return { practitioner: p };
  }
  const p = { id: nextId('prac'), name, specialty, clinic: clinic || 'City Clinic' };
  s.practitioners.push(p);
  return { practitioner: p };
}

export function removePractitioner(id) {
  const s = getStore();
  const p = s.practitioners.find((x) => x.id === id);
  if (!p) return { error: 'practitioner not found' };
  s.practitioners = s.practitioners.filter((x) => x.id !== id);
  for (const pat of s.availabilityPatterns.filter((x) => x.practitionerId === id)) {
    s.availabilityPatterns = s.availabilityPatterns.filter((x) => x.id !== pat.id);
    regeneratePatternSlots(s, pat.id);
  }
  return { removed: id };
}

export function upsertPattern({ id, practitionerId, days, start, end, slotMinutes, weeks }) {
  const s = getStore();
  if (!Array.isArray(days) || days.length === 0) return { error: 'at least one day is required' };
  if (!start || !end || start >= end) return { error: 'start must be before end' };
  const target = id
    ? s.availabilityPatterns.find((x) => x.id === id)
    : { id: nextId('pat'), practitionerId };
  if (!target) return { error: 'pattern not found' };
  if (!s.practitioners.some((p) => p.id === (practitionerId || target.practitionerId))) {
    return { error: 'practitioner not found' };
  }
  Object.assign(target, {
    practitionerId: practitionerId || target.practitionerId,
    days: days.map(Number).sort(),
    start,
    end,
    slotMinutes: Number(slotMinutes) || 60,
    weeks: Number(weeks) || 3,
  });
  if (!id) s.availabilityPatterns.push(target);
  const { added, removed } = regeneratePatternSlots(s, target.id);
  return { pattern: target, slotsAdded: added, slotsRemoved: removed };
}

export function removePattern(id) {
  const s = getStore();
  if (!s.availabilityPatterns.some((x) => x.id === id)) return { error: 'pattern not found' };
  s.availabilityPatterns = s.availabilityPatterns.filter((x) => x.id !== id);
  const { removed } = regeneratePatternSlots(s, id);
  return { removed: id, slotsRemoved: removed };
}

// One-off exception: block a single date for a practitioner without touching
// the recurring pattern.
export function blockDate(practitionerId, date, reason) {
  const s = getStore();
  if (!s.practitioners.some((p) => p.id === practitionerId)) {
    return { error: 'practitioner not found' };
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || ''))) return { error: 'date must be YYYY-MM-DD' };
  if (!s.blockedDates.some((b) => b.practitionerId === practitionerId && b.date === date)) {
    s.blockedDates.push({ practitionerId, date, reason: reason || 'unavailable' });
  }
  regenerateAllSlots(s);
  return { blocked: { practitionerId, date } };
}

export function unblockDate(practitionerId, date) {
  const s = getStore();
  s.blockedDates = s.blockedDates.filter(
    (b) => !(b.practitionerId === practitionerId && b.date === date)
  );
  regenerateAllSlots(s);
  return { unblocked: { practitionerId, date } };
}

const CANNED_RESULTS = {
  'CBC panel': 'Mild anemia flagged (Hgb 10.9 g/dL, low). All other lines within normal limits.',
  'Lipid panel': 'LDL 162 mg/dL (elevated). HDL and triglycerides within normal limits.',
};

// Dual-push — lab result to the patient AND back into the org queue
export function publishLabResult(orderId) {
  const s = getStore();
  const order = s.labOrders.find((x) => x.id === orderId);
  if (!order) return { error: 'order not found' };
  if (order.status === 'resulted') return { error: 'already resulted' };

  order.status = 'resulted';
  order.resultText = CANNED_RESULTS[order.test] || `${order.test}: results available, see report.`;
  order.resultedAt = Date.now();

  addPatientEvent({
    role: 'ai',
    kind: 'lab-result',
    text: `🧪 Lab result published (${order.id}, ${order.test}): ${order.resultText} This result was simultaneously sent to your care team's review queue.`,
  });
  const c = addCase({
    source: 'lab',
    patient: order.patient,
    summary: `Lab result requiring review — ${order.test} (${order.id}): ${order.resultText}`,
    aiSuggestion:
      'AI-suggested disposition: abnormal result, non-urgent. Recommend physician review of trend, repeat testing in 4–6 weeks, and patient notification with guidance.',
  });
  order.reviewCaseId = c.id;
  return { transaction: 'dual-push', order, reviewCase: c };
}

// The payer's automated processing always resolves to this outcome, so tools
// can return it synchronously while the pending→resolved animation still plays
// in the Payer view.
export const PAYER_OUTCOME = {
  coverage: 'Active — plan BlueDemo PPO',
  network: 'in-network',
  options: [
    { provider: 'City Clinic (in-network)', estimate: '$45' },
    { provider: 'Urgent Care Express (out-of-network)', estimate: '$180' },
  ],
};

export function requestCoverageCheck(subject, { notifyPatient = false } = {}) {
  const r = addPayerRequest('CEC', subject, { notifyPatient });
  return { request: r, outcome: PAYER_OUTCOME };
}

export function requestCostEstimate(subject, { notifyPatient = false } = {}) {
  const r = addPayerRequest('CER', subject, { notifyPatient });
  return { request: r, outcome: PAYER_OUTCOME };
}
