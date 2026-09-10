// The Patient view's conversational agent: a real Claude API call configured
// with the three party MCP servers (Reviewing Org, Laboratory, Payer). The
// LLM decides which tool to call; app code no longer routes intents.
//
// Two wiring modes:
//  - 'connector' (MCP_PUBLIC_BASE_URL set, MCP_MODE != 'local'): uses the
//    API's native `mcp_servers` parameter — Anthropic's servers connect to
//    this app's public /api/mcp/* Streamable HTTP endpoints. Requires the app
//    to be publicly reachable, so it can't work against localhost.
//  - 'local' (default): the same three MCP servers run in-process; a real MCP
//    client (InMemoryTransport) does tools/list + tools/call, and the tools
//    are presented to Claude as regular tools. Same servers, same protocol,
//    state-coherent everywhere.
//
// Emergency escalation is decided BEFORE this runs (lib/triage.js) and stays
// a deterministic code path — tool selection never decides emergencies.

import Anthropic from '@anthropic-ai/sdk';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { buildServer, PARTIES } from '@/lib/mcp/servers';
import { getStore, addPatientEvent, logToolCall } from '@/lib/store';

const MODEL = 'claude-opus-5';

const AGENT_SYSTEM = `You are the patient-side care assistant in an asynchronous, AI-mediated care review demo. Triage already ran: this message is NOT an emergency. You are connected to three MCP servers — the reviewing organization (org), the laboratory (lab), and the payer — and you decide which tools to call.

Guidelines:
- New symptom reports — clarify once, then file:
  * If this is the patient's FIRST message about a new symptom and it is brief or non-specific (e.g. "having fever since last evening", "my back hurts"), do NOT file yet and do NOT call tools. Ask exactly ONE focused clarifying question relevant to that symptom — duration/severity plus the red-flag associated symptoms a clinician would screen for (fever → rash, stiff neck, confusion; back pain → numbness, weakness, loss of bladder control; headache → vision changes, worst-ever onset; etc.).
  * If the recent conversation shows you ALREADY asked a clarifying question about this symptom, never ask another one. File now: call org submit_review_request with a summary combining everything the patient has told you across both messages. One clarifying round maximum, ever.
  * If the patient's first message is already detailed and specific (has duration AND severity or associated-symptom detail), skip the question and file the ARR immediately — don't force a question that isn't needed.
  * Emergencies never reach you — a separate triage step escalates them before this conversation, including red flags revealed in a clarifying answer.
  * When you file, tell the patient their case id and that a physician will review asynchronously.
- Wanting to book an appointment/visit: call BOTH org list_appointment_slots AND payer get_cost_estimate before replying (pass a specialty argument to list_appointment_slots when the reason suggests one — e.g. back/joint → Orthopedics), then present the options as a short comparison that says WHY each is surfaced, along two dimensions: cost (from the payer's CES options — identify the lowest-cost in-network choice vs the out-of-network alternative, with prices) and timing/fit (from the AU slots — name the soonest available slot with its real practitioner and specialty, and say when a practitioner matches the visit reason). Example shape: "City Clinic is your lowest-cost in-network option (est. $45) and has the earliest slot, tomorrow 9:30 AM; Urgent Care Express is out-of-network (est. $180)." Never list bare slots with no reasoning. The chat UI renders a clickable slot picker from the list_appointment_slots call, so end by telling the patient to pick a slot below. Only call book_appointment yourself if the patient already named a specific slot.
- Changing an existing appointment ("move my appointment to Thursday", "reschedule", "cancel my lab appointment"): first read what they have (org get_patient_record, or lab list_appointments) so you target the right one, then call the tool on the RIGHT server — org update_appointment / org cancel_appointment for clinic visits, lab update_appointment / lab cancel_appointment for specimen collection. For a move, look up open slots first (org list_appointment_slots or lab list_collection_slots) and pick the one matching what the patient asked for. Confirm back with the old time and the new time, or that the slot was released. If a tool returns an error (no such appointment, already cancelled, slot taken), tell the patient plainly what happened and what their options are — never pretend it worked.
- Practitioner identity: slots and appointments carry real practitioner names and specialties from the org's configuration. Always use exactly those names/specialties in confirmations. NEVER invent, guess, or embellish a doctor's name or specialty.
- Status questions (appointments, cases, claims/insurance/costs, lab results): read from org get_patient_record, payer list_requests / check_coverage / get_cost_estimate, or lab list_orders / list_appointments, and summarize accurately from the tool results — never invent state.
- The patient is "Demo Patient". Keep replies short (2-4 sentences), warm, and concrete; mention transaction codes (ARR, CEC, APC...) in parentheses where natural. Never diagnose; the physician does dispositions.
- Reminder: ID/insurance document uploads happen in a separate provider portal, never in this chat — mention only if the patient asks about uploading documents.`;

function recentContext() {
  const feed = getStore().patientFeed.slice(-8);
  return feed
    .map((e) => `${e.role === 'patient' ? 'Patient' : 'Assistant'}: ${e.text || '[slot picker shown]'}`)
    .join('\n');
}

function maybeShowSlotPicker(toolName, input) {
  if (toolName !== 'list_appointment_slots') return;
  const s = getStore();
  if (s.apptSlots.some((x) => !x.booked)) {
    addPatientEvent({
      role: 'ai',
      kind: 'slots',
      data: { direct: true, specialty: input?.specialty || null },
    });
  }
}

async function connectLocalClients() {
  const clients = {};
  for (const party of PARTIES) {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = buildServer(party);
    await server.connect(serverTransport);
    const client = new Client({ name: `patient-agent-${party}`, version: '1.0.0' });
    await client.connect(clientTransport);
    clients[party] = client;
  }
  return clients;
}

async function runLocalMode(anthropic, userText) {
  const clients = await connectLocalClients();
  const tools = [];
  for (const party of PARTIES) {
    const { tools: partyTools } = await clients[party].listTools();
    for (const t of partyTools) {
      tools.push({
        name: `${party}__${t.name}`,
        description: `[${party} MCP server] ${t.description || ''}`,
        input_schema: t.inputSchema || { type: 'object', properties: {} },
      });
    }
  }

  const messages = [
    {
      role: 'user',
      content: `Recent conversation:\n${recentContext()}\n\nNew patient message: "${userText}"`,
    },
  ];
  const toolCalls = [];

  for (let i = 0; i < 8; i++) {
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 10000,
      system: AGENT_SYSTEM,
      tools,
      messages,
    });
    if (response.stop_reason === 'refusal') {
      return { text: 'I was unable to process that message. Please rephrase, or call your care team directly.', toolCalls };
    }
    if (response.stop_reason !== 'tool_use') {
      const text = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
      return { text, toolCalls };
    }
    messages.push({ role: 'assistant', content: response.content });
    const results = [];
    for (const block of response.content) {
      if (block.type !== 'tool_use') continue;
      const [party, toolName] = block.name.split('__');
      logToolCall({ server: party, tool: toolName, input: block.input, mode: 'local-mcp' });
      toolCalls.push({ server: party, tool: toolName });
      let resultText;
      try {
        const result = await clients[party].callTool({ name: toolName, arguments: block.input });
        resultText = (result.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n');
      } catch (err) {
        resultText = `Tool error: ${err.message}`;
      }
      maybeShowSlotPicker(toolName, block.input);
      results.push({ type: 'tool_result', tool_use_id: block.id, content: resultText });
    }
    messages.push({ role: 'user', content: results });
  }
  return { text: 'I hit my tool-call limit for this turn — please try again.', toolCalls };
}

async function runConnectorMode(anthropic, userText, baseUrl) {
  const response = await anthropic.beta.messages.create({
    model: MODEL,
    max_tokens: 10000,
    betas: ['mcp-client-2025-11-20'],
    mcp_servers: PARTIES.map((p) => ({
      type: 'url',
      name: p,
      url: `${baseUrl}/api/mcp/${p}/mcp`,
    })),
    tools: PARTIES.map((p) => ({ type: 'mcp_toolset', mcp_server_name: p })),
    system: AGENT_SYSTEM,
    messages: [
      {
        role: 'user',
        content: `Recent conversation:\n${recentContext()}\n\nNew patient message: "${userText}"`,
      },
    ],
  });
  const toolCalls = [];
  for (const block of response.content) {
    if (block.type === 'mcp_tool_use') {
      logToolCall({ server: block.server_name, tool: block.name, input: block.input, mode: 'connector' });
      toolCalls.push({ server: block.server_name, tool: block.name });
      maybeShowSlotPicker(block.name, block.input);
    }
  }
  const text =
    response.stop_reason === 'refusal'
      ? 'I was unable to process that message. Please rephrase, or call your care team directly.'
      : response.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
  return { text, toolCalls };
}

// Returns { text, toolCalls, mode }
export async function runPatientAgent(userText) {
  const anthropic = new Anthropic();
  const baseUrl = process.env.MCP_PUBLIC_BASE_URL;
  const useConnector = baseUrl && process.env.MCP_MODE !== 'local';
  try {
    const result = useConnector
      ? await runConnectorMode(anthropic, userText, baseUrl.replace(/\/$/, ''))
      : await runLocalMode(anthropic, userText);
    return { ...result, mode: useConnector ? 'connector' : 'local-mcp' };
  } catch (err) {
    console.error('[agent] failed:', err.message);
    return { text: null, toolCalls: [], mode: 'error', error: err.message };
  }
}
