// Shared state-mutating actions. The HTTP API routes (used by the four views)
// and the MCP servers (used by the patient-side LLM agent) both call these,
// so there is exactly one implementation of each transaction.

import {
  getStore,
  addPatientEvent,
  addCase,
  addPayerRequest,
  nextId,
} from '@/lib/store';

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
      text: `Disposition (DR) for case ${c.id}: the physician REDIRECTED you to an in-person visit. Here are available appointment slots (from the org's Availability Update, AU) — pick one below. I'm also requesting a cost estimate (CER) from your payer.`,
    });
    addPatientEvent({ role: 'ai', kind: 'slots', data: { caseId: c.id } });
    addPayerRequest('CER', `Cost estimate for in-person visit (case ${c.id})`, {
      notifyPatient: true,
    });
  }
  return { transaction: 'DR', case: c };
}

// APR → APC — appointment booking against the org's exposed availability (AU)
export function bookAppointment(slotId) {
  const s = getStore();
  const slot = s.apptSlots.find((x) => x.id === slotId);
  if (!slot) return { error: 'slot not found' };
  if (slot.booked) return { error: 'slot already booked' };

  slot.booked = true;
  const appt = {
    id: nextId('APT'),
    slotId: slot.id,
    when: slot.when,
    clinic: slot.clinic,
    patient: 'Demo Patient',
    bookedAt: Date.now(),
  };
  s.appointments.push(appt);
  addPatientEvent({
    role: 'ai',
    kind: 'APC',
    text: `Appointment confirmed (APR → APC): ${slot.when} at ${slot.clinic}. Confirmation ${appt.id}.`,
  });
  return { transaction: 'APC', appointment: appt };
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
