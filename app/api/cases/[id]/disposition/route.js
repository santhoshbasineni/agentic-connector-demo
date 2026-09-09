import { getStore, addPatientEvent, addPayerRequest } from '@/lib/store';

export const dynamic = 'force-dynamic';

// DR (Disposition Response) — physician confirms the AI suggestion or redirects
export async function POST(request, { params }) {
  const { action } = await request.json(); // 'confirm' | 'redirect'
  if (action !== 'confirm' && action !== 'redirect') {
    return Response.json({ error: "action must be 'confirm' or 'redirect'" }, { status: 400 });
  }
  const s = getStore();
  const c = s.cases.find((x) => x.id === params.id);
  if (!c) return Response.json({ error: 'case not found' }, { status: 404 });
  if (c.status !== 'claimed') {
    return Response.json({ error: `case is ${c.status}, not claimed` }, { status: 409 });
  }

  c.status = 'resolved';
  c.disposition = action;
  c.resolvedAt = Date.now();

  // Only the live Demo Patient has a chat feed; seeded/lab cases resolve silently
  // in the queue, which is enough for the demo.
  const notifyPatient = c.patient === 'Demo Patient';

  if (action === 'confirm') {
    if (notifyPatient) {
      addPatientEvent({
        role: 'ai',
        kind: 'DR',
        text: `Disposition (DR) for case ${c.id}: the physician CONFIRMED the AI suggestion — ${c.aiSuggestion}`,
      });
    }
  } else {
    if (notifyPatient) {
      addPatientEvent({
        role: 'ai',
        kind: 'DR',
        text: `Disposition (DR) for case ${c.id}: the physician REDIRECTED you to an in-person visit. Here are available appointment slots (from the org's Availability Update, AU) — pick one below. I'm also requesting a cost estimate (CER) from your payer.`,
      });
      addPatientEvent({
        role: 'ai',
        kind: 'slots',
        data: { caseId: c.id },
      });
      addPayerRequest('CER', `Cost estimate for in-person visit (case ${c.id})`, {
        notifyPatient: true,
      });
    }
  }
  return Response.json({ transaction: 'DR', case: c });
}
