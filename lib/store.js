// In-memory store for the demo. Lives on globalThis so it survives Next.js
// dev-mode module reloads. Resets on server restart — fine for a demo.

const EMERGENCY_KEYWORDS = [
  'chest pain',
  'chest tightness',
  'chest pressure',
  'heart attack',
  'cardiac arrest',
  "can't breathe",
  'cant breathe',
  'cannot breathe',
  'not able to breathe',
  'trouble breathing',
  'difficulty breathing',
  'shortness of breath',
  'unconscious',
  'passed out',
  'passing out',
  'fainted',
  'seizure',
  'severe bleeding',
  'bleeding heavily',
  'stroke',
  'face drooping',
  'slurred speech',
  'overdose',
  'anaphyla',
  'suicidal',
  'suicide',
];

function initStore() {
  const t = Date.now();
  return {
    seq: 104,
    // Patient chat feed (single demo patient)
    patientFeed: [
      {
        id: 'pf-0',
        role: 'ai',
        kind: 'text',
        text: "Hi! I'm your care intake assistant. Describe your symptoms and I'll route them for asynchronous physician review (ARR) — or escalate immediately (EE) if anything looks urgent.",
        ts: t,
      },
    ],
    // Review-org queue, seeded with fake open cases
    cases: [
      {
        id: 'ARR-101',
        type: 'ARR',
        source: 'seed',
        status: 'open',
        patient: 'J. Rivera',
        summary: 'Recurring tension headaches for 2 weeks, no visual changes, no fever.',
        aiSuggestion:
          'AI-suggested disposition: likely tension-type headache. Recommend OTC analgesics, hydration, and sleep hygiene; follow up if persisting beyond 1 week.',
        createdAt: t - 3 * 3600e3,
      },
      {
        id: 'ARR-102',
        type: 'ARR',
        source: 'seed',
        status: 'open',
        patient: 'M. Okafor',
        summary: 'Mild seasonal allergy symptoms: sneezing, itchy eyes, clear rhinorrhea.',
        aiSuggestion:
          'AI-suggested disposition: allergic rhinitis. Recommend OTC antihistamine trial for 2 weeks; no in-person visit needed.',
        createdAt: t - 2 * 3600e3,
      },
      {
        id: 'ARR-103',
        type: 'ARR',
        source: 'seed',
        status: 'open',
        patient: 'S. Lindqvist',
        summary: 'Intermittent lower-back pain after lifting, no numbness or weakness.',
        aiSuggestion:
          'AI-suggested disposition: mechanical low-back strain. Recommend activity modification + NSAIDs; redirect to in-person visit if red flags develop.',
        createdAt: t - 1 * 3600e3,
      },
    ],
    // Laboratory
    labOrders: [
      {
        id: 'LAB-501',
        patient: 'Demo Patient',
        test: 'CBC panel',
        status: 'in-progress',
        receivedAt: t - 5 * 3600e3,
      },
      {
        id: 'LAB-502',
        patient: 'Demo Patient',
        test: 'Lipid panel',
        status: 'in-progress',
        receivedAt: t - 4 * 3600e3,
      },
    ],
    // AU — availability the lab exposes for specimen-collection bookings
    labSlots: ['Wed 9:00 AM', 'Wed 11:30 AM', 'Thu 2:00 PM'],
    // AU — appointment availability the reviewing org exposes
    apptSlots: [
      { id: 'slot-1', when: 'Tomorrow 9:30 AM', clinic: 'City Clinic — Dr. Chen', booked: false },
      { id: 'slot-2', when: 'Tomorrow 2:00 PM', clinic: 'City Clinic — Dr. Patel', booked: false },
      { id: 'slot-3', when: 'Friday 10:15 AM', clinic: 'Northside Practice — Dr. Ade', booked: false },
    ],
    payerRequests: [],
    appointments: [],
    eeAlerts: [],
    // Log of MCP tool calls made by the patient-side LLM agent (for
    // verification/debugging; also proves the wiring is real, not assumed)
    toolCallLog: [],
  };
}

export function getStore() {
  if (!globalThis.__agenticConnectorStore) {
    globalThis.__agenticConnectorStore = initStore();
  }
  return globalThis.__agenticConnectorStore;
}

export function nextId(prefix) {
  const s = getStore();
  s.seq += 1;
  return `${prefix}-${s.seq}`;
}

export function matchEmergency(text) {
  const lower = String(text || '').toLowerCase();
  return EMERGENCY_KEYWORDS.find((k) => lower.includes(k)) || null;
}

export function addPatientEvent(event) {
  const s = getStore();
  const e = { id: nextId('pf'), ts: Date.now(), ...event };
  s.patientFeed.push(e);
  return e;
}

export function logToolCall(entry) {
  const s = getStore();
  if (!s.toolCallLog) s.toolCallLog = [];
  const e = { id: nextId('tc'), ts: Date.now(), ...entry };
  s.toolCallLog.push(e);
  console.log(`[mcp-tool-call] ${entry.server} :: ${entry.tool}`, JSON.stringify(entry.input || {}));
  return e;
}

export function addCase(fields) {
  const s = getStore();
  const c = {
    id: nextId('ARR'),
    type: 'ARR',
    status: 'open',
    createdAt: Date.now(),
    ...fields,
  };
  s.cases.push(c);
  return c;
}

// type: 'CEC' | 'CER'. Auto-resolves ~4s later (lazily, on next state read).
export function addPayerRequest(type, subject, { notifyPatient = false } = {}) {
  const s = getStore();
  const r = {
    id: nextId(type),
    type,
    subject,
    status: 'pending',
    createdAt: Date.now(),
    resolveAt: Date.now() + 4000,
    notifyPatient,
    result: null,
  };
  s.payerRequests.push(r);
  return r;
}

// --- Patient chat intents (booking + status queries) -----------------------
// Simple keyword routing per the demo spec — no real NLU. Checked only after
// the emergency check, and before symptom intake falls through to ARR.
export function detectIntent(text) {
  const t = String(text || '').toLowerCase();
  if (/\b(book|schedule|reschedul)/.test(t)) return 'book';
  if (/\b(claim|insurance|coverage|cost)/.test(t)) return 'claims-status';
  if (/\b(lab|result)/.test(t)) return 'lab-status';
  if (/\b(appointment|visit|slot)/.test(t)) return 'appointment-status';
  return null;
}

export function appointmentStatusSummary() {
  const s = getStore();
  if (s.appointments.length === 0) {
    const free = s.apptSlots.filter((x) => !x.booked).length;
    return `You have no appointments booked yet. ${free} slot(s) are currently open — say "book an appointment" to see them.`;
  }
  const lines = s.appointments.map(
    (a) => `• ${a.id}: ${a.when} at ${a.clinic} — confirmed (APC)`
  );
  return `Your appointments:\n${lines.join('\n')}`;
}

export function claimsStatusSummary() {
  const s = getStore();
  if (s.payerRequests.length === 0) {
    return 'No coverage or cost-estimate requests on file with your payer yet. One is created automatically when you submit symptoms or get redirected to a visit.';
  }
  const lines = s.payerRequests.map((r) => {
    if (r.status === 'pending') return `• ${r.id} (${r.type}): ⏳ pending — payer is auto-processing`;
    const opts = r.result.options.map((o) => `${o.provider}: ${o.estimate}`).join('; ');
    return `• ${r.id} (${r.type}): resolved — ${r.result.coverage}, ${r.result.network}. ${opts}`;
  });
  return `Your payer requests (CEC/CES):\n${lines.join('\n')}`;
}

export function labStatusSummary() {
  const s = getStore();
  const mine = s.labOrders.filter((o) => o.patient === 'Demo Patient');
  if (mine.length === 0) return 'You have no lab orders on file.';
  const lines = mine.map((o) =>
    o.status === 'resulted'
      ? `• ${o.id} (${o.test}): ✅ result published — ${o.resultText} (also routed to your care team as case ${o.reviewCaseId})`
      : `• ${o.id} (${o.test}): ⏳ in progress at the lab`
  );
  return `Your lab orders:\n${lines.join('\n')}`;
}

// Simulates the payer's automated processing: any pending request past its
// resolveAt time flips to resolved. Called on every state read.
export function resolveDuePayerRequests() {
  const s = getStore();
  const now = Date.now();
  for (const r of s.payerRequests) {
    if (r.status === 'pending' && now >= r.resolveAt) {
      r.status = 'resolved';
      r.result = {
        coverage: 'Active — plan BlueDemo PPO',
        network: 'in-network',
        options: [
          { provider: 'City Clinic (in-network)', estimate: '$45' },
          { provider: 'Urgent Care Express (out-of-network)', estimate: '$180' },
        ],
      };
      if (r.notifyPatient) {
        addPatientEvent({
          role: 'ai',
          kind: 'coverage',
          text: 'Insurance check complete (CEC + CES): you are in-network, estimated visit cost $45 at City Clinic. Out-of-network option: Urgent Care Express, est. $180.',
        });
      }
    }
  }
}
