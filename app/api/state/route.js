import { getStore, resolveDuePayerRequests } from '@/lib/store';

export const dynamic = 'force-dynamic';

export async function GET() {
  resolveDuePayerRequests();
  return Response.json(getStore());
}
