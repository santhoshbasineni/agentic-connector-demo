import { claimCase } from '@/lib/actions';

export const dynamic = 'force-dynamic';

// RC (Review Claim) — a physician claims an open case from the queue
export async function POST(request, { params }) {
  const result = claimCase(params.id);
  if (result.error) {
    return Response.json(result, { status: result.error === 'case not found' ? 404 : 409 });
  }
  return Response.json(result);
}
