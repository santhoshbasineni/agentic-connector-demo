import { publishLabResult } from '@/lib/actions';

export const dynamic = 'force-dynamic';

// Dual-push: a completed lab result publishes to the patient AND re-enters the
// review queue as a new ARR simultaneously.
export async function POST(request, { params }) {
  const result = publishLabResult(params.id);
  if (result.error) {
    return Response.json(result, { status: result.error === 'order not found' ? 404 : 409 });
  }
  return Response.json(result);
}
