import { getStore, addPatientEvent, nextId } from '@/lib/store';

export const dynamic = 'force-dynamic';

// APR (Appointment Request) → APC (Appointment Confirmation)
export async function POST(request) {
  const { slotId } = await request.json();
  const s = getStore();
  const slot = s.apptSlots.find((x) => x.id === slotId);
  if (!slot) return Response.json({ error: 'slot not found' }, { status: 404 });
  if (slot.booked) return Response.json({ error: 'slot already booked' }, { status: 409 });

  slot.booked = true;
  const appt = {
    id: nextId('APT'),
    slotId: slot.id,
    when: slot.when,
    clinic: slot.clinic,
    patient: 'Demo Patient',
    bookedAt: Date.now(),
  };
  s.appointments.push(appt);
  addPatientEvent({
    role: 'ai',
    kind: 'APC',
    text: `Appointment confirmed (APR → APC): ${slot.when} at ${slot.clinic}. Confirmation ${appt.id}.`,
  });
  return Response.json({ transaction: 'APC', appointment: appt });
}
