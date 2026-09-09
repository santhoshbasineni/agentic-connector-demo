import {
  getStore,
  addPatientEvent,
  detectIntent,
  appointmentStatusSummary,
  claimsStatusSummary,
  labStatusSummary,
  resolveDuePayerRequests,
} from '@/lib/store';
import { fireEE, submitARR } from '@/lib/actions';
import { triage } from '@/lib/triage';
import { runPatientAgent } from '@/lib/agent';

export const dynamic = 'force-dynamic';
export const maxDuration = 120; // real LLM turns can take a while

// IS (Intake Submission). With ANTHROPIC_API_KEY set: real Claude triage
// (conservative, structured) decides EE deterministically, then the
// MCP-connected agent handles everything else. Without a key: the original
// keyword triage + intent routing, unchanged, as a graceful fallback.
export async function POST(request) {
  const { text } = await request.json();
  if (!text || !String(text).trim()) {
    return Response.json({ error: 'text required' }, { status: 400 });
  }

  resolveDuePayerRequests(); // status answers must reflect live payer state
  addPatientEvent({ role: 'patient', kind: 'text', text });

  // 1) Emergency judgment — a dedicated triage call (or keyword fallback),
  //    never LLM tool selection. EE stays a deterministic code path.
  const verdict = await triage(text);
  if (verdict.emergency) {
    fireEE(text, verdict.reason);
    return Response.json({ transaction: 'EE', reason: verdict.reason, triageVia: verdict.via });
  }

  // 2) Non-emergency, LLM available → MCP-connected conversational agent
  if (process.env.ANTHROPIC_API_KEY) {
    const result = await runPatientAgent(text);
    if (result.text) {
      addPatientEvent({ role: 'ai', kind: 'text', text: result.text });
      return Response.json({
        transaction: 'AGENT',
        mode: result.mode,
        toolCalls: result.toolCalls,
      });
    }
    // Agent hard-failed — fall through to the legacy path so the demo keeps working
    console.error('[intake] agent unavailable, using legacy routing:', result.error);
  }

  // 3) Legacy fallback: keyword intents (booking / status), else ARR
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

  const c = submitARR(text);
  return Response.json({ transaction: 'ARR', caseId: c.id });
}
