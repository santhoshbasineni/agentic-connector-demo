import { getStore, addPatientEvent, addCase } from '@/lib/store';

export const dynamic = 'force-dynamic';

const CANNED_RESULTS = {
  'CBC panel': 'Mild anemia flagged (Hgb 10.9 g/dL, low). All other lines within normal limits.',
  'Lipid panel': 'LDL 162 mg/dL (elevated). HDL and triglycerides within normal limits.',
};

// Dual-push: a completed lab result publishes to the patient AND re-enters the
// org review queue as a new ARR, simultaneously.
export async function POST(request, { params }) {
  const s = getStore();
  const order = s.labOrders.find((x) => x.id === params.id);
  if (!order) return Response.json({ error: 'order not found' }, { status: 404 });
  if (order.status === 'resulted') {
    return Response.json({ error: 'already resulted' }, { status: 409 });
  }

  order.status = 'resulted';
  order.resultText = CANNED_RESULTS[order.test] || `${order.test}: results available, see report.`;
  order.resultedAt = Date.now();

  // Push 1 of 2: patient view
  addPatientEvent({
    role: 'ai',
    kind: 'lab-result',
    text: `🧪 Lab result published (${order.id}, ${order.test}): ${order.resultText} This result was simultaneously sent to your care team's review queue.`,
  });
  // Push 2 of 2: org review queue, as a new ARR
  const c = addCase({
    source: 'lab',
    patient: order.patient,
    summary: `Lab result requiring review — ${order.test} (${order.id}): ${order.resultText}`,
    aiSuggestion:
      'AI-suggested disposition: abnormal result, non-urgent. Recommend physician review of trend, repeat testing in 4–6 weeks, and patient notification with guidance.',
  });
  order.reviewCaseId = c.id;

  return Response.json({ transaction: 'dual-push', order, reviewCase: c });
}
