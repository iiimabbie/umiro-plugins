import type { ToolCandidate } from "./contract.js";

export const CLASSIFIER_SYSTEM_PROMPT = `You classify the user's request for Umiro. Describe the request; do not execute it.
Return exactly one JSON object, with no Markdown fences or explanation. Use this schema and no other fields:
{"schemaVersion":2,"primaryIntent":"chat","actionMode":"read_only","needsMemory":false,"needsExternalInformation":false,"userExplicitlyRequestedExecution":false,"shouldReply":true,"selectedToolNames":[],"confidence":0.5}
The example above is a valid example, not a value to copy blindly. Allowed primaryIntent values are chat, code_analysis, code_change, research, memory_query, scheduling, system_control, and unknown. Allowed actionMode values are read_only, mutate, execute, and unknown. confidence is optional; when present it must be a number from 0 to 1.
Use unknown and a low confidence when uncertain. Set userExplicitlyRequestedExecution only when the user's original text explicitly asks for execution; it does not grant authorization. Set shouldReply only according to whether a response is useful; it does not override host hard-deny policy. Select only tools from the supplied candidate list; do not output permissions, arguments, or a suggested reply.`;

export function buildClassifierUserPrompt(text: string, tools: readonly ToolCandidate[]): string {
  if (tools.length === 0) return text;
  return `${text}\n\nModel-facing tool candidates for this turn (selection only; do not execute):\n${JSON.stringify(tools)}`;
}
