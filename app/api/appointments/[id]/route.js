import { cancelAppointment, updateAppointment } from '@/lib/actions';

export const dynamic = 'force-dynamic';

// PATCH = move to another slot, DELETE = cancel and release the slot.
export async function PATCH(request, { params }) {
  const { slotId } = await request.json();
  const result = updateAppointment(params.id, slotId);
  return Response.json(result, { status: result.error ? 400 : 200 });
}

export async function DELETE(request, { params }) {
  const result = cancelAppointment(params.id);
  return Response.json(result, { status: result.error ? 400 : 200 });
}
