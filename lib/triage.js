// Real conversational triage via the Anthropic API, replacing the keyword
// list. Safety-critical bias: when uncertain, classify as EMERGENCY — a false
// "urgent" costs nothing in a demo; a missed real emergency is the failure
// mode that matters. Falls back to the keyword list if no API key is set or
// the API call fails.

import Anthropic from '@anthropic-ai/sdk';
import { matchEmergency } from '@/lib/store';

const TRIAGE_SYSTEM = `You are a medical intake triage classifier for an asynchronous care-review system. Given a patient's free-text message, decide whether it describes a potential medical EMERGENCY that must bypass the asynchronous physician review queue.

BE CONSERVATIVE. If you are genuinely uncertain whether the situation could be an emergency, classify it as an emergency rather than risk a false negative. A false "this is urgent" costs nothing; a missed real emergency is the failure mode that matters. Emergencies include (not exhaustively): chest pain or pressure, heart attack or stroke symptoms, breathing difficulty, loss of consciousness, severe bleeding, seizures, anaphylaxis, overdose, suicidal ideation, and any acute severe or rapidly worsening presentation.

Non-symptom messages (booking requests, status questions, general chat) are never emergencies.`;

const TRIAGE_SCHEMA = {
  type: 'object',
  properties: {
    emergency: {
      type: 'boolean',
      description: 'true if this could be an emergency (be conservative)',
    },
    reason: {
      type: 'string',
      description: 'Short phrase naming the red-flag concern, or why it is routine',
    },
  },
  required: ['emergency', 'reason'],
  additionalProperties: false,
};

// Returns { emergency, reason, via: 'llm' | 'keyword-fallback' }
export async function triage(text) {
  if (!process.env.ANTHROPIC_API_KEY) return keywordTriage(text);
  try {
    const client = new Anthropic();
    const response = await client.messages.create({
      model: 'claude-opus-5',
      max_tokens: 2000,
      output_config: { effort: 'low', format: { type: 'json_schema', schema: TRIAGE_SCHEMA } },
      system: TRIAGE_SYSTEM,
      messages: [{ role: 'user', content: `Patient message: "${text}"` }],
    });
    if (response.stop_reason === 'refusal') {
      // Classifier declined — conservative default: treat as emergency
      return { emergency: true, reason: 'triage refused — escalating out of caution', via: 'llm' };
    }
    const textBlock = response.content.find((b) => b.type === 'text');
    const parsed = JSON.parse(textBlock.text);
    return { emergency: !!parsed.emergency, reason: parsed.reason, via: 'llm' };
  } catch (err) {
    console.error('[triage] API call failed, falling back to keywords:', err.message);
    return keywordTriage(text);
  }
}

export function keywordTriage(text) {
  const keyword = matchEmergency(text);
  return keyword
    ? { emergency: true, reason: `"${keyword}"`, via: 'keyword-fallback' }
    : { emergency: false, reason: 'no red-flag keywords', via: 'keyword-fallback' };
}
