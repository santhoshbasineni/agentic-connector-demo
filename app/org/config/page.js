'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePolledState, post } from '@/lib/usePolledState';

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const EMPTY_PATTERN = { days: [1, 3, 5], start: '09:00', end: '11:00', slotMinutes: 60, weeks: 3 };

function fmtTime(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, '0')} ${ampm}`;
}

function PatternEditor({ practitioner, pattern, onDone }) {
  const [draft, setDraft] = useState(pattern || { ...EMPTY_PATTERN });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  function toggleDay(d) {
    setDraft((p) => ({
      ...p,
      days: p.days.includes(d) ? p.days.filter((x) => x !== d) : [...p.days, d].sort(),
    }));
  }

  async function save() {
    setBusy(true);
    setErr(null);
    const res = await post('/api/org/config', {
      action: 'pattern.save',
      id: pattern?.id,
      practitionerId: practitioner.id,
      ...draft,
    });
    setBusy(false);
    if (res.error) return setErr(res.error);
    onDone(res);
  }

  return (
    <div style={{ background: '#f7fafc', border: '1px solid #dde4ec', borderRadius: 8, padding: 10, marginTop: 8 }}>
      <div className="row" style={{ marginBottom: 8 }}>
        {DAY_NAMES.map((name, d) => (
          <button
            key={d}
            onClick={() => toggleDay(d)}
            style={{
              padding: '4px 9px',
              background: draft.days.includes(d) ? '#1d4fd8' : '#fff',
              color: draft.days.includes(d) ? '#fff' : '#33415a',
              borderColor: draft.days.includes(d) ? '#1d4fd8' : '#b9c6d6',
            }}
          >
            {name}
          </button>
        ))}
      </div>
      <div className="row" style={{ marginBottom: 8 }}>
        <label className="muted">
          From{' '}
          <input
            type="time"
            value={draft.start}
            onChange={(e) => setDraft({ ...draft, start: e.target.value })}
          />
        </label>
        <label className="muted">
          To{' '}
          <input
            type="time"
            value={draft.end}
            onChange={(e) => setDraft({ ...draft, end: e.target.value })}
          />
        </label>
        <label className="muted">
          Slot mins{' '}
          <input
            type="number"
            min="15"
            step="15"
            style={{ width: 70 }}
            value={draft.slotMinutes}
            onChange={(e) => setDraft({ ...draft, slotMinutes: e.target.value })}
          />
        </label>
        <label className="muted">
          Look-ahead wks{' '}
          <input
            type="number"
            min="1"
            max="12"
            style={{ width: 60 }}
            value={draft.weeks}
            onChange={(e) => setDraft({ ...draft, weeks: e.target.value })}
          />
        </label>
      </div>
      {err && <div style={{ color: '#b91c1c', fontSize: 13, marginBottom: 6 }}>{err}</div>}
      <div className="row">
        <button className="primary" onClick={save} disabled={busy}>
          {pattern ? 'Update pattern & regenerate slots' : 'Add pattern & generate slots'}
        </button>
        <button onClick={() => onDone(null)}>Cancel</button>
      </div>
    </div>
  );
}

function PractitionerForm({ onDone }) {
  const [draft, setDraft] = useState({ name: '', specialty: '', clinic: 'City Clinic' });
  const [err, setErr] = useState(null);
  return (
    <div className="row" style={{ marginTop: 10 }}>
      <input
        placeholder="Name (e.g. Dr. Novak)"
        value={draft.name}
        onChange={(e) => setDraft({ ...draft, name: e.target.value })}
      />
      <input
        placeholder="Specialty (e.g. Dermatology)"
        value={draft.specialty}
        onChange={(e) => setDraft({ ...draft, specialty: e.target.value })}
      />
      <input
        placeholder="Clinic"
        value={draft.clinic}
        onChange={(e) => setDraft({ ...draft, clinic: e.target.value })}
      />
      <button
        className="primary"
        onClick={async () => {
          const res = await post('/api/org/config', { action: 'practitioner.save', ...draft });
          if (res.error) return setErr(res.error);
          setDraft({ name: '', specialty: '', clinic: 'City Clinic' });
          onDone();
        }}
      >
        Add practitioner
      </button>
      {err && <span style={{ color: '#b91c1c', fontSize: 13 }}>{err}</span>}
    </div>
  );
}

export default function OrgConfig() {
  const state = usePolledState(2000);
  const [editing, setEditing] = useState(null); // practitionerId being edited
  const [note, setNote] = useState(null);
  const [blockDraft, setBlockDraft] = useState({});

  if (!state) return <div className="muted">Loading…</div>;

  const slotsFor = (pracId) => state.apptSlots.filter((s) => s.practitionerId === pracId);

  return (
    <div>
      <h1>Org configuration — practitioners &amp; availability</h1>
      <p className="sub">
        Org staff manage their own practitioners here. Saving a recurring weekly pattern expands it
        into individual bookable slot instances across the look-ahead window; these are the exact
        slots the Availability Update (AU) exposes to the patient agent via MCP.{' '}
        <Link href="/org">← back to the review queue</Link>
      </p>
      {note && <div className="pii-note">{note}</div>}

      {state.practitioners.map((p) => {
        const patterns = state.availabilityPatterns.filter((x) => x.practitionerId === p.id);
        const slots = slotsFor(p.id);
        const blocks = state.blockedDates.filter((b) => b.practitionerId === p.id);
        return (
          <div className="card" key={p.id}>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <div>
                <b>{p.name}</b> <span className="badge open">{p.specialty}</span>
                <span className="muted"> {p.clinic}</span>
              </div>
              <div className="row">
                <span className="muted">
                  {slots.filter((s) => !s.booked).length} open / {slots.length} generated
                </span>
                <button onClick={() => setEditing(editing === p.id ? null : p.id)}>
                  {editing === p.id ? 'Close' : 'Add pattern'}
                </button>
                <button
                  className="danger"
                  onClick={async () => {
                    const res = await post('/api/org/config', {
                      action: 'practitioner.remove',
                      id: p.id,
                    });
                    setNote(res.error || `Removed ${p.name} and their availability.`);
                  }}
                >
                  Remove
                </button>
              </div>
            </div>

            {patterns.length === 0 && (
              <div className="muted" style={{ marginTop: 6 }}>
                No recurring availability yet.
              </div>
            )}
            {patterns.map((pat) => (
              <div key={pat.id} style={{ marginTop: 8 }}>
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <span style={{ fontSize: 14 }}>
                    🗓 {pat.days.map((d) => DAY_NAMES[d]).join('/')} · {fmtTime(pat.start)}–
                    {fmtTime(pat.end)} · {pat.slotMinutes} min · {pat.weeks} wk look-ahead
                  </span>
                  <div className="row">
                    <button onClick={() => setEditing(editing === pat.id ? null : pat.id)}>
                      {editing === pat.id ? 'Close' : 'Edit'}
                    </button>
                    <button
                      className="danger"
                      onClick={async () => {
                        const res = await post('/api/org/config', {
                          action: 'pattern.remove',
                          id: pat.id,
                        });
                        setNote(res.error || `Pattern removed; ${res.slotsRemoved} future slots cleared.`);
                      }}
                    >
                      Delete
                    </button>
                  </div>
                </div>
                {editing === pat.id && (
                  <PatternEditor
                    practitioner={p}
                    pattern={pat}
                    onDone={(res) => {
                      setEditing(null);
                      if (res) setNote(`Regenerated: +${res.slotsAdded} slots, −${res.slotsRemoved} replaced.`);
                    }}
                  />
                )}
              </div>
            ))}
            {editing === p.id && (
              <PatternEditor
                practitioner={p}
                pattern={null}
                onDone={(res) => {
                  setEditing(null);
                  if (res) setNote(`Generated ${res.slotsAdded} slots for ${p.name}.`);
                }}
              />
            )}

            <div className="row" style={{ marginTop: 10 }}>
              <span className="muted">One-off block:</span>
              <input
                type="date"
                value={blockDraft[p.id] || ''}
                onChange={(e) => setBlockDraft({ ...blockDraft, [p.id]: e.target.value })}
              />
              <button
                onClick={async () => {
                  const res = await post('/api/org/config', {
                    action: 'date.block',
                    practitionerId: p.id,
                    date: blockDraft[p.id],
                  });
                  setNote(res.error || `Blocked ${blockDraft[p.id]} for ${p.name}.`);
                }}
              >
                Block date
              </button>
              {blocks.map((b) => (
                <span key={b.date} className="badge claimed">
                  {b.date}{' '}
                  <button
                    style={{ padding: '0 4px', border: 'none', background: 'none' }}
                    onClick={async () => {
                      await post('/api/org/config', {
                        action: 'date.unblock',
                        practitionerId: p.id,
                        date: b.date,
                      });
                      setNote(`Unblocked ${b.date} for ${p.name}.`);
                    }}
                  >
                    ✕
                  </button>
                </span>
              ))}
            </div>

            {slots.length > 0 && (
              <div className="muted" style={{ marginTop: 8, fontSize: 12.5 }}>
                Next generated slots: {slots.filter((s) => !s.booked).slice(0, 4).map((s) => s.when).join(' · ') || '(all booked)'}
              </div>
            )}
          </div>
        );
      })}

      <div className="card">
        <h2>Add a practitioner</h2>
        <PractitionerForm onDone={() => setNote('Practitioner added — give them a recurring pattern to generate slots.')} />
      </div>
    </div>
  );
}
