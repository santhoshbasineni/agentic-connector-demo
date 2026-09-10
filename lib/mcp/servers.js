// Three MCP servers — one per party — exposing each party's existing
// operations (from lib/actions.js) as MCP tools. The same registration
// functions back both surfaces:
//   - HTTP endpoints at /api/mcp/{org,lab,payer} (Streamable HTTP, via mcp-handler)
//   - the Patient agent's in-process MCP clients (InMemoryTransport)

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getStore, resolveDuePayerRequests, activeAppointments } from '@/lib/store';
import { openSlots } from '@/lib/scheduling';
import {
  submitARR,
  claimCase,
  setDisposition,
  bookAppointment,
  bookLabSlot,
  cancelAppointment,
  updateAppointment,
  publishLabResult,
  requestCoverageCheck,
  requestCostEstimate,
} from '@/lib/actions';

const asText = (data) => ({
  content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
});

export function registerOrgTools(server) {
  server.registerTool(
    'list_open_queue',
    { description: 'List the reviewing organization\'s open ARR review queue (physician-facing).' },
    async () => asText(getStore().cases.filter((c) => c.status === 'open'))
  );
  server.registerTool(
    'claim_case',
    {
      description: 'RC (Review Claim): a physician claims an open case from the queue.',
      inputSchema: { case_id: z.string().describe('Case id, e.g. ARR-104') },
    },
    async ({ case_id }) => asText(claimCase(case_id))
  );
  server.registerTool(
    'submit_disposition',
    {
      description:
        'DR (Disposition Response): resolve a claimed case by confirming the AI suggestion or redirecting to an in-person visit.',
      inputSchema: {
        case_id: z.string(),
        action: z.enum(['confirm', 'redirect']),
      },
    },
    async ({ case_id, action }) => asText(setDisposition(case_id, action))
  );
  server.registerTool(
    'submit_review_request',
    {
      description:
        'ARR (Async Review Request): file a patient\'s non-emergency symptoms into the physician review queue. Also fires a CEC coverage check automatically. Use for any new symptom report that is not an emergency.',
      inputSchema: { symptom_summary: z.string().describe('The patient\'s symptom description') },
    },
    async ({ symptom_summary }) => {
      const c = submitARR(symptom_summary, { notifyPatient: false });
      return asText({ transaction: 'ARR', caseId: c.id, status: c.status });
    }
  );
  server.registerTool(
    'list_appointment_slots',
    {
      description:
        'AU (Availability Update): list the org\'s currently exposed, unbooked appointment slots, soonest first. Each slot carries the real practitioner name and specialty from the org\'s practitioner config — always use those, never invent a doctor name. Pass specialty to prefer a matching practitioner (e.g. "Orthopedics" for a back/joint referral). Call this when the patient wants to book a visit — the chat UI shows a slot picker.',
      inputSchema: {
        specialty: z.string().optional().describe('Preferred specialty, e.g. Orthopedics'),
        limit: z.number().optional().describe('Max slots to return (default 8)'),
      },
    },
    async ({ specialty, limit }) =>
      asText(openSlots(getStore(), { specialty, limit: limit || 8 }))
  );
  server.registerTool(
    'list_practitioners',
    {
      description:
        'List the org\'s practitioners with their specialties and clinics, as configured by org staff.',
    },
    async () => asText(getStore().practitioners)
  );
  server.registerTool(
    'book_appointment',
    {
      description:
        'APR→APC: book a specific clinic appointment slot for the patient by slot id. Confirm back using the practitioner name and specialty returned by the tool.',
      inputSchema: { slot_id: z.string().describe('Slot id from list_appointment_slots') },
    },
    async ({ slot_id }) => asText(bookAppointment(slot_id, { notifyPatient: false }))
  );
  server.registerTool(
    'update_appointment',
    {
      description:
        'Move an existing confirmed CLINIC appointment to a different slot. Look up open slots with list_appointment_slots first. Omit appointment_id if the patient has exactly one clinic appointment.',
      inputSchema: {
        new_slot_id: z.string().describe('Target slot id from list_appointment_slots'),
        appointment_id: z.string().optional().describe('e.g. APT-110'),
      },
    },
    async ({ new_slot_id, appointment_id }) =>
      asText(updateAppointment(appointment_id, new_slot_id, { facility: 'org' }))
  );
  server.registerTool(
    'cancel_appointment',
    {
      description:
        'Cancel an existing confirmed CLINIC appointment and release its slot back into availability. Omit appointment_id if the patient has exactly one clinic appointment.',
      inputSchema: { appointment_id: z.string().optional().describe('e.g. APT-110') },
    },
    async ({ appointment_id }) => asText(cancelAppointment(appointment_id, { facility: 'org' }))
  );
  server.registerTool(
    'get_patient_record',
    {
      description:
        'Read the demo patient\'s current record: cases (any status), active appointments at every facility, and upcoming clinic availability. Use for status questions.',
    },
    async () => {
      const s = getStore();
      return asText({
        cases: s.cases,
        appointments: activeAppointments(),
        cancelledAppointments: s.appointments.filter((a) => a.status === 'cancelled'),
        practitioners: s.practitioners,
        openSlots: openSlots(s, { limit: 8 }),
      });
    }
  );
}

export function registerLabTools(server) {
  server.registerTool(
    'list_orders',
    { description: 'List the laboratory\'s orders for the demo patient and their status.' },
    async () => asText(getStore().labOrders)
  );
  server.registerTool(
    'list_collection_slots',
    { description: 'AU (Availability Update): list the lab\'s exposed specimen-collection slots.' },
    async () => asText(getStore().labSlots)
  );
  server.registerTool(
    'book_collection_slot',
    {
      description: 'Book one of the lab\'s exposed specimen-collection slots for the patient.',
      inputSchema: { slot: z.string().describe('Exact slot string, e.g. "Wed 9:00 AM"') },
    },
    async ({ slot }) => asText(bookLabSlot(slot))
  );
  server.registerTool(
    'list_appointments',
    { description: 'List the patient\'s active LAB collection appointments.' },
    async () => asText(activeAppointments().filter((a) => a.facility === 'lab'))
  );
  server.registerTool(
    'update_appointment',
    {
      description:
        'Move an existing confirmed LAB collection appointment to a different exposed slot. Check list_collection_slots first. Omit appointment_id if the patient has exactly one lab appointment.',
      inputSchema: {
        new_slot_id: z.string().describe('Exact target slot string, e.g. "Thu 2:00 PM"'),
        appointment_id: z.string().optional().describe('e.g. APT-112'),
      },
    },
    async ({ new_slot_id, appointment_id }) =>
      asText(updateAppointment(appointment_id, new_slot_id, { facility: 'lab' }))
  );
  server.registerTool(
    'cancel_appointment',
    {
      description:
        'Cancel an existing confirmed LAB collection appointment and release its slot back into the lab\'s availability. Omit appointment_id if the patient has exactly one lab appointment.',
      inputSchema: { appointment_id: z.string().optional().describe('e.g. APT-112') },
    },
    async ({ appointment_id }) => asText(cancelAppointment(appointment_id, { facility: 'lab' })),
  );
  server.registerTool(
    'publish_result',
    {
      description:
        'Publish a completed lab result. Dual-push: it goes to the patient AND re-enters the org review queue as a new ARR simultaneously.',
      inputSchema: { order_id: z.string().describe('e.g. LAB-501') },
    },
    async ({ order_id }) => asText(publishLabResult(order_id))
  );
}

export function registerPayerTools(server) {
  server.registerTool(
    'check_coverage',
    {
      description:
        'CEC (Coverage Eligibility Check): check the demo patient\'s insurance coverage status. Returns coverage, network status, and provider options with prices.',
    },
    async () => asText(requestCoverageCheck('Coverage eligibility for Demo Patient (agent CEC)'))
  );
  server.registerTool(
    'get_cost_estimate',
    {
      description:
        'CER/CES (Cost Estimate Request/Response): get in-network vs out-of-network provider options and estimated prices for a visit.',
      inputSchema: { reason: z.string().optional().describe('What the visit is for') },
    },
    async ({ reason }) =>
      asText(requestCostEstimate(`Cost estimate${reason ? `: ${reason}` : ''} (agent CER)`))
  );
  server.registerTool(
    'list_requests',
    { description: 'List all CEC/CER requests the payer has received and their status.' },
    async () => {
      resolveDuePayerRequests();
      return asText(getStore().payerRequests);
    }
  );
}

const REGISTRARS = {
  org: { name: 'reviewing-org-mcp', register: registerOrgTools },
  lab: { name: 'laboratory-mcp', register: registerLabTools },
  payer: { name: 'payer-mcp', register: registerPayerTools },
};

export function buildServer(party) {
  const { name, register } = REGISTRARS[party];
  const server = new McpServer({ name, version: '1.0.0' });
  register(server);
  return server;
}

export const PARTIES = Object.keys(REGISTRARS);
