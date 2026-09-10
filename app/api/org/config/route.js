import {
  upsertPractitioner,
  removePractitioner,
  upsertPattern,
  removePattern,
  blockDate,
  unblockDate,
} from '@/lib/actions';

export const dynamic = 'force-dynamic';

// Org staff config: practitioners, recurring availability patterns, and
// one-off blocked dates. One endpoint, action-dispatched — this is a demo
// config panel, not a REST surface for external consumers.
const HANDLERS = {
  'practitioner.save': (p) => upsertPractitioner(p),
  'practitioner.remove': (p) => removePractitioner(p.id),
  'pattern.save': (p) => upsertPattern(p),
  'pattern.remove': (p) => removePattern(p.id),
  'date.block': (p) => blockDate(p.practitionerId, p.date, p.reason),
  'date.unblock': (p) => unblockDate(p.practitionerId, p.date),
};

export async function POST(request) {
  const { action, ...payload } = await request.json();
  const handler = HANDLERS[action];
  if (!handler) {
    return Response.json(
      { error: `unknown action '${action}'`, actions: Object.keys(HANDLERS) },
      { status: 400 }
    );
  }
  const result = handler(payload);
  return Response.json(result, { status: result?.error ? 400 : 200 });
}
