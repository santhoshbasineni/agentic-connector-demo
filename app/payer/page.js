'use client';

import { usePolledState, post } from '@/lib/usePolledState';

export default function PayerView() {
  const state = usePolledState();
  if (!state) return <div className="muted">Loading…</div>;

  const reqs = [...state.payerRequests].sort((a, b) => b.createdAt - a.createdAt);

  return (
    <div>
      <h1>Payer view</h1>
      <p className="sub">
        Coverage eligibility (CEC) and cost-estimate (CER) requests arrive from the other
        parties&apos; agents and auto-resolve after a few seconds — no manual action needed —
        returning network status and mock pricing (CES).
      </p>
      <div className="row" style={{ marginBottom: 14 }}>
        <button className="primary" onClick={() => post('/api/payer/simulate')}>
          Simulate incoming CEC
        </button>
        <span className="muted">…or drive one from the Patient view (any intake creates a CEC).</span>
      </div>

      <div className="card">
        <h2>Requests ({reqs.length})</h2>
        {reqs.length === 0 && (
          <div className="muted">No requests yet — submit symptoms in the Patient view.</div>
        )}
        <table>
          <tbody>
            {reqs.map((r) => (
              <tr key={r.id}>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <span className={`badge ${r.status === 'pending' ? 'pending' : 'resolved'}`}>
                    {r.type}
                  </span>
                  <b>{r.id}</b>
                </td>
                <td>
                  {r.subject}
                  {r.status === 'pending' ? (
                    <div className="muted">⏳ auto-processing…</div>
                  ) : (
                    <div style={{ fontSize: 13, marginTop: 4 }}>
                      ✅ {r.result.coverage} · <b>{r.result.network}</b>
                      <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
                        {r.result.options.map((o) => (
                          <li key={o.provider}>
                            {o.provider}: <b>{o.estimate}</b>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
