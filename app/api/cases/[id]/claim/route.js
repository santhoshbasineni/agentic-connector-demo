import { getStore } from '@/lib/store';

export const dynamic = 'force-dynamic';

// RC (Review Claim) — a physician claims an open case from the queue
export async function POST(request, { params }) {
  const s = getStore();
  const c = s.cases.find((x) => x.id === params.id);
  if (!c) return Response.json({ error: 'case not found' }, { status: 404 });
  if (c.status !== 'open') {
    return Response.json({ error: `case is ${c.status}, not open` }, { status: 409 });
  }
  c.status = 'claimed';
  c.claimedBy = 'Dr. Demo';
  c.claimedAt = Date.now();
  return Response.json({ transaction: 'RC', case: c });
}
