'use client';

import Link from 'next/link';
import { usePolledState, post } from '@/lib/usePolledState';

export default function OrgView() {
  const state = usePolledState();
  if (!state) return <div className="muted">Loading…</div>;

  const open = state.cases.filter((c) => c.status === 'open');
  const claimed = state.cases.filter((c) => c.status === 'claimed');
  const resolved = state.cases.filter((c) => c.status === 'resolved');
  const orgAppts = state.appointments.filter((a) => a.facility !== 'lab' && a.status !== 'cancelled');
  const openSlots = state.apptSlots.filter((s) => !s.booked);

  return (
    <div>
      <h1>Reviewing Organization view</h1>
      <p className="sub">
        Physician queue. Claim (RC) an open ARR, review the intake + AI-suggested disposition,
        then Confirm or Redirect (DR). ·{' '}
        <Link href="/org/config">Config: practitioners &amp; availability →</Link>
      </p>

      {state.eeAlerts.map((a) => (
        <div className="ee-banner" key={a.id}>
          🚨 <b>Emergency Escalation (EE)</b> received and routed outside the async queue —
          red-flag keyword &quot;{a.keyword}&quot; in patient intake: &quot;{a.text}&quot;
        </div>
      ))}

      <div className="card">
        <h2>Open queue ({open.length})</h2>
        {open.length === 0 && <div className="muted">Queue is empty.</div>}
        <table>
          <tbody>
            {open.map((c) => (
              <tr key={c.id}>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <span className="badge open">ARR</span>
                  {c.source === 'lab' && <span className="badge lab">from lab</span>}
                  <b>{c.id}</b>
                </td>
                <td>
                  <b>{c.patient}</b> — {c.summary}
                </td>
                <td style={{ textAlign: 'right' }}>
                  <button className="primary" onClick={() => post(`/api/cases/${c.id}/claim`)}>
                    Claim
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h2>In progress ({claimed.length})</h2>
        {claimed.length === 0 && <div className="muted">Nothing claimed yet.</div>}
        {claimed.map((c) => (
          <div key={c.id} style={{ borderTop: '1px solid #eef2f6', paddingTop: 10, marginTop: 10 }}>
            <div>
              <span className="badge claimed">CLAIMED</span>
              <b>{c.id}</b> · {c.patient} · claimed by {c.claimedBy}
            </div>
            <p style={{ fontSize: 14 }}>
              <b>Intake summary:</b> {c.summary}
            </p>
            <p style={{ fontSize: 14, background: '#f4f8ff', padding: '8px 10px', borderRadius: 8 }}>
              🤖 {c.aiSuggestion}
            </p>
            <div className="row">
              <button
                className="primary"
                onClick={() => post(`/api/cases/${c.id}/disposition`, { action: 'confirm' })}
              >
                Confirm AI suggestion
              </button>
              <button
                className="danger"
                onClick={() => post(`/api/cases/${c.id}/disposition`, { action: 'redirect' })}
              >
                Redirect to in-person visit
              </button>
            </div>
          </div>
        ))}
      </div>

      <div className="card">
        <h2>Booked appointments ({orgAppts.length})</h2>
        {orgAppts.length === 0 && <div className="muted">No clinic appointments booked.</div>}
        {orgAppts.map((a) => (
          <div key={a.id} style={{ fontSize: 13.5, padding: '3px 0' }}>
            <span className="badge resolved">{a.updatedAt ? 'MOVED' : 'CONFIRMED'}</span>
            <b>{a.id}</b> · {a.when} · {a.practitioner} ({a.specialty}) · {a.patient}
          </div>
        ))}
        <p className="muted" style={{ marginBottom: 0, marginTop: 8 }}>
          Exposed availability (AU): <b>{openSlots.length}</b> open slots across{' '}
          {state.practitioners.length} practitioners
          {openSlots.length > 0 && <> — next: {openSlots[0].when} with {openSlots[0].practitioner}</>}.
        </p>
      </div>

      <div className="card">
        <h2>Resolved ({resolved.length})</h2>
        {resolved.length === 0 && <div className="muted">None yet.</div>}
        {resolved.map((c) => (
          <div key={c.id} style={{ fontSize: 13.5, padding: '4px 0' }}>
            <span className="badge resolved">{c.disposition === 'confirm' ? 'CONFIRMED' : 'REDIRECTED'}</span>
            <b>{c.id}</b> · {c.patient} — {c.summary}
          </div>
        ))}
      </div>
    </div>
  );
}
