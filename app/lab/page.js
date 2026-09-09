'use client';

import { usePolledState, post } from '@/lib/usePolledState';

export default function LabView() {
  const state = usePolledState();
  if (!state) return <div className="muted">Loading…</div>;

  return (
    <div>
      <h1>Laboratory view</h1>
      <p className="sub">
        Incoming orders and exposed collection slots (AU). Publishing a result performs the
        dual-push: it appears in the Patient chat AND re-enters the Org review queue as a new
        ARR, simultaneously.
      </p>

      <div className="card">
        <h2>Incoming orders</h2>
        <table>
          <thead>
            <tr>
              <th>Order</th>
              <th>Test</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {state.labOrders.map((o) => (
              <tr key={o.id}>
                <td>
                  <b>{o.id}</b>
                  <div className="muted">{o.patient}</div>
                </td>
                <td>{o.test}</td>
                <td>
                  {o.status === 'resulted' ? (
                    <>
                      <span className="badge resolved">RESULTED</span>
                      <div className="muted" style={{ marginTop: 4 }}>
                        {o.resultText}
                        <br />
                        Dual-pushed → patient + org queue case <b>{o.reviewCaseId}</b>
                      </div>
                    </>
                  ) : (
                    <span className="badge pending">IN PROGRESS</span>
                  )}
                </td>
                <td style={{ textAlign: 'right' }}>
                  {o.status !== 'resulted' && (
                    <button className="primary" onClick={() => post(`/api/lab/${o.id}/publish`)}>
                      Publish result
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h2>Exposed collection slots (AU — Availability Update)</h2>
        <div className="row">
          {state.labSlots.map((s) => (
            <span key={s} className="badge open" style={{ fontSize: 13, padding: '6px 12px' }}>
              {s}
            </span>
          ))}
        </div>
        <p className="muted" style={{ marginBottom: 0 }}>
          These slots are what the lab&apos;s agent exposes for APR/APC booking by other parties.
        </p>
      </div>
    </div>
  );
}
