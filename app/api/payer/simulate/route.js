import { addPayerRequest } from '@/lib/store';

export const dynamic = 'force-dynamic';

// Demo helper: lets the Payer view inject an incoming CEC to watch it auto-resolve.
export async function POST() {
  const r = addPayerRequest('CEC', 'Coverage eligibility for Demo Patient (manual simulation)');
  return Response.json({ request: r });
}
