import { bookAppointment } from '@/lib/actions';

export const dynamic = 'force-dynamic';

// APR (Appointment Request) → APC (Appointment Confirmation)
export async function POST(request) {
  const { slotId } = await request.json();
  const result = bookAppointment(slotId);
  if (result.error) {
    return Response.json(result, { status: result.error === 'slot not found' ? 404 : 409 });
  }
  return Response.json(result);
}
