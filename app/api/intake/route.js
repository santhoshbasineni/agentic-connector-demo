import {
  getStore,
  matchEmergency,
  addPatientEvent,
  addCase,
  addPayerRequest,
  detectIntent,
  appointmentStatusSummary,
  claimsStatusSummary,
  labStatusSummary,
  resolveDuePayerRequests,
} from '@/lib/store';

export const dynamic = 'force-dynamic';

// IS (Intake Submission) → EE (Emergency Escalation) or ARR (Async Review Request)
export async function POST(request) {
  const { text } = await request.json();
  if (!text || !String(text).trim()) {
    return Response.json({ error: 'text required' }, { status: 400 });
  }

  resolveDuePayerRequests(); // status answers must reflect live payer state
  addPatientEvent({ role: 'patient', kind: 'text', text });

  const keyword = matchEmergency(text);
  if (keyword) {
    const s = getStore();
    s.eeAlerts.push({ id: `ee-${Date.now()}`, keyword, text, ts: Date.now() });
    addPatientEvent({
      role: 'ai',
      kind: 'EE',
      text: `🚨 EMERGENCY ESCALATION (EE) — red-flag symptom detected ("${keyword}"). This bypasses the async review queue entirely. Please call 911 or go to the nearest emergency department now. Your care team has been notified.`,
    });
    return Response.json({ transaction: 'EE', keyword });
  }

  // Non-emergency: route booking/status intents before treating it as symptoms
  const intent = detectIntent(text);
  if (intent === 'book') {
    const s = getStore();
    const free = s.apptSlots.filter((x) => !x.booked);
    addPatientEvent({
      role: 'ai',
      kind: 'text',
      text:
        free.length === 0
          ? 'All exposed appointment slots are currently booked. Check back after the org publishes a new Availability Update (AU).'
          : `Sure — here is the current exposed availability (AU) from the reviewing org (the lab also exposes collection slots: ${s.labSlots.join(', ')}). Pick a slot below to book (APR → APC):`,
    });
    if (free.length > 0) {
      addPatientEvent({ role: 'ai', kind: 'slots', data: { direct: true } });
    }
    return Response.json({ transaction: 'AU', openSlots: free.length });
  }
  if (intent === 'appointment-status' || intent === 'claims-status' || intent === 'lab-status') {
    const summary =
      intent === 'appointment-status'
        ? appointmentStatusSummary()
        : intent === 'claims-status'
          ? claimsStatusSummary()
          : labStatusSummary();
    addPatientEvent({ role: 'ai', kind: 'text', text: summary });
    return Response.json({ transaction: 'STATUS', intent, summary });
  }

  const c = addCase({
    source: 'patient',
    patient: 'Demo Patient',
    summary: text,
    aiSuggestion:
      'AI-suggested disposition: low-acuity presentation. Recommend self-care guidance with 48-hour check-in; escalate to in-person visit only if symptoms worsen. (Physician confirmation required.)',
  });
  addPayerRequest('CEC', `Coverage eligibility for Demo Patient (case ${c.id})`);
  addPatientEvent({
    role: 'ai',
    kind: 'ARR',
    text: `Thanks — no red-flag symptoms detected. I've submitted an Async Review Request (ARR): case ${c.id} is now in the physician review queue. A coverage eligibility check (CEC) was sent to your payer in parallel. You'll hear back here once a physician reviews it.`,
  });
  return Response.json({ transaction: 'ARR', caseId: c.id });
}
