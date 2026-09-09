import Link from 'next/link';

export default function Home() {
  return (
    <div>
      <h1>Agentic Connector — demo</h1>
      <p className="sub">
        A demonstration of a transaction standard for asynchronous, AI-mediated care review.
        Four parties — each with an AI agent at its layer — exchange typed transactions:{' '}
        <code>IS</code> <code>EE</code> <code>ARR</code> <code>RC</code> <code>DR</code>{' '}
        <code>APR/APC</code> <code>AU</code> <code>CEC</code> <code>CER/CES</code> and a
        dual-push lab result. Everything below is mocked/simulated — no real EHR, payer, or LLM
        calls. Open each view in its own tab to watch transactions propagate live.
      </p>
      <div className="home-grid">
        <Link href="/patient">
          <div className="card">
            <h2>1. Patient</h2>
            <p className="muted">
              Chat intake (IS). Emergency keywords fire EE; otherwise an ARR enters the review
              queue. Receives dispositions, appointment slots, cost estimates, and lab results.
            </p>
          </div>
        </Link>
        <Link href="/org">
          <div className="card">
            <h2>2. Reviewing Organization</h2>
            <p className="muted">
              Physician queue dashboard. Claim (RC) an open ARR, see the AI-suggested
              disposition, then Confirm or Redirect (DR).
            </p>
          </div>
        </Link>
        <Link href="/lab">
          <div className="card">
            <h2>3. Laboratory</h2>
            <p className="muted">
              Incoming orders + exposed slots (AU). Publishing a result dual-pushes it to the
              patient and back into the org queue as a new ARR.
            </p>
          </div>
        </Link>
        <Link href="/payer">
          <div className="card">
            <h2>4. Payer</h2>
            <p className="muted">
              Pending coverage (CEC) and cost-estimate (CER) requests auto-resolve after a few
              seconds with in-/out-of-network options and mock prices (CES).
            </p>
          </div>
        </Link>
      </div>
      <div className="card" style={{ marginTop: 16 }}>
        <h2>Suggested demo script</h2>
        <ol className="muted" style={{ margin: 0, paddingLeft: 20, lineHeight: 1.7 }}>
          <li>Patient: type &quot;sore throat for three days&quot; → ARR appears in Org queue; CEC appears in Payer view.</li>
          <li>Patient: type &quot;chest pain&quot; → EE fires instead (no queue entry).</li>
          <li>Org: Claim the live case → Redirect → Patient sees slots + payer cost estimate; pick a slot → APC.</li>
          <li>Lab: Publish a result → it appears in the Patient chat and as a new case in the Org queue simultaneously.</li>
        </ol>
      </div>
    </div>
  );
}
