'use client';

import { useEffect, useRef, useState } from 'react';
import { usePolledState, post } from '@/lib/usePolledState';

function SlotPicker({ state, specialty }) {
  const [busy, setBusy] = useState(false);
  let free = state.apptSlots.filter((s) => !s.booked);
  if (specialty) {
    const matched = free.filter((s) =>
      s.specialty.toLowerCase().includes(String(specialty).toLowerCase())
    );
    if (matched.length) free = matched;
  }
  if (free.length === 0) return <div className="muted">No slots remaining.</div>;
  const shown = free.slice(0, 6);
  return (
    <>
      <div className="slotgrid">
        {shown.map((s) => (
          <button
            key={s.id}
            className="slotbtn"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              await post('/api/appointments', { slotId: s.id });
              setBusy(false);
            }}
          >
            {s.when} · {s.practitioner} ({s.specialty})
          </button>
        ))}
      </div>
      {free.length > shown.length && (
        <div className="muted" style={{ marginTop: 6 }}>
          +{free.length - shown.length} more slots available — ask for a specific day or specialty.
        </div>
      )}
    </>
  );
}

export default function PatientView() {
  const state = usePolledState();
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const bottomRef = useRef(null);
  const feedLen = state?.patientFeed?.length ?? 0;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [feedLen]);

  async function send(e) {
    e.preventDefault();
    const t = text.trim();
    if (!t || sending) return;
    setSending(true);
    setText('');
    await post('/api/intake', { text: t });
    setSending(false);
  }

  if (!state) return <div className="muted">Loading…</div>;

  return (
    <div>
      <h1>Patient view</h1>
      <p className="sub">
        Conversational intake. Try &quot;sore throat for three days&quot; (→ ARR),
        &quot;chest pain&quot; (→ EE), &quot;book an appointment&quot; (→ AU/APR/APC), or ask
        for the status of your appointments, claims, or lab results.
      </p>
      <div className="pii-note">
        🔒 <b>PII isolation:</b> ID and insurance-card document uploads are handled in a separate,
        secured provider portal — never through this chat. This channel carries only the clinical
        intake conversation.
      </div>
      <div className="card">
        <div className="chat">
          {state.patientFeed.map((m) => {
            if (m.kind === 'slots') {
              // A picker is "done" once any appointment was booked after it appeared
              const bookedAfter = state.appointments.some((a) => a.bookedAt > m.ts);
              return (
                <div className="msg ai" key={m.id}>
                  <div style={{ marginBottom: 4 }}>
                    <b>Available appointment slots</b>
                    {m.data?.caseId ? ` (case ${m.data.caseId})` : ''}
                    {m.data?.specialty ? ` — ${m.data.specialty}` : ''}:
                  </div>
                  {bookedAfter ? (
                    <div className="muted">✓ Appointment booked — see confirmation below.</div>
                  ) : (
                    <SlotPicker state={state} specialty={m.data?.specialty} />
                  )}
                </div>
              );
            }
            const cls =
              m.role === 'patient'
                ? 'msg patient'
                : `msg ai${['EE', 'coverage', 'lab-result'].includes(m.kind) ? ' ' + (m.kind === 'EE' ? 'ee' : m.kind) : ''}`;
            return (
              <div className={cls} key={m.id}>
                {m.text}
              </div>
            );
          })}
          <div ref={bottomRef} />
        </div>
        <form className="chatform" onSubmit={send}>
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Describe your symptoms…"
            aria-label="Describe your symptoms"
          />
          <button className="primary" type="submit" disabled={sending}>
            Send
          </button>
        </form>
      </div>
    </div>
  );
}
