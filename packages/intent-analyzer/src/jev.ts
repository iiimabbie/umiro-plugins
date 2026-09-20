import type { IntentAnalyzerBackend, IntentAnalyzerInput, IntentAnalysis, ToolCandidate } from "./contract.js";
import { IntentAnalyzerFailure } from "./contract.js";
import type { JevIntentAnalyzerConfig } from "./config.js";
import { readBoundedBody } from "./bounded-body.js";

export type FetchImplementation = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

interface ChoiceQuestion { readonly type: "choice"; readonly instructions: string; readonly criteria: Readonly<Record<string, string | null>> }
interface NoulQuestion { readonly type: "noul"; readonly instructions: string; readonly criteria: { readonly true: string; readonly false: string } }
type JevQuestion = ChoiceQuestion | NoulQuestion;
interface ChoiceAnswer { readonly type: "choice"; readonly choice: unknown; readonly probabilities?: unknown; readonly confidence?: unknown }
interface NoulAnswer { readonly type: "noul"; readonly noul: unknown }
type JevAnswer = ChoiceAnswer | NoulAnswer;

const PRIMARY_INTENTS = ["chat", "code_analysis", "code_change", "research", "memory_query", "scheduling", "system_control", "unknown"] as const;
const ACTION_MODES = ["read_only", "mutate", "execute", "unknown"] as const;
const TOOL_PREFIX = "tool::";

function questionIdForTool(name: string): string { return `${TOOL_PREFIX}${encodeURIComponent(name)}`; }
function makeQuestions(tools: readonly ToolCandidate[]): { readonly questions: Record<string, JevQuestion>; readonly toolIds: ReadonlyMap<string, string> } {
  const questions: Record<string, JevQuestion> = {
    primary_intent: { type: "choice", instructions: "Classify the primary intent of the user's current request. Do not execute it.", criteria: Object.fromEntries(PRIMARY_INTENTS.map(value => [value, null])) },
    action_mode: { type: "choice", instructions: "Classify the requested action mode of the user's current request. Do not grant authorization.", criteria: Object.fromEntries(ACTION_MODES.map(value => [value, null])) },
    needs_memory: { type: "noul", instructions: "Does the current request require retrieving or using durable memory?", criteria: { true: "The request needs durable memory", false: "The request does not need durable memory" } },
    needs_external_information: { type: "noul", instructions: "Does the current request require information from an external source?", criteria: { true: "External information is needed", false: "External information is not needed" } },
    user_explicitly_requested_execution: { type: "noul", instructions: "Does the user's original text explicitly ask for execution or a mutation? This does not grant authorization.", criteria: { true: "Execution is explicitly requested", false: "Execution is not explicitly requested" } },
    should_reply: { type: "noul", instructions: "Would a useful Umiro response be appropriate for this message? This is only a soft reply preference; host hard-deny policy is authoritative.", criteria: { true: "A response would be useful", false: "No response is useful" } },
  };
  const toolIds = new Map<string, string>();
  for (const tool of tools) {
    const id = questionIdForTool(tool.name);
    toolIds.set(id, tool.name);
    questions[id] = {
      type: "noul",
      instructions: `Could the main model need this tool to fulfill the current request? Include prerequisite inspection or lookup tools needed before an explicit action. Missing target details do not make an otherwise applicable tool irrelevant; the main model can resolve them from conversation context or ask a follow-up.\n${JSON.stringify({ name: tool.name, description: tool.description, parameters: tool.parameters })}`,
      criteria: {
        true: "This tool could plausibly perform, prepare for, or verify the requested work",
        false: "This tool has no plausible role in performing, preparing for, or verifying the requested work",
      },
    };
  }
  return { questions, toolIds };
}

function object(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new IntentAnalyzerFailure("protocol_error", message);
  return value as Record<string, unknown>;
}
function choice(answers: Record<string, unknown>, id: string, allowed: readonly string[], criteria: Readonly<Record<string, string | null>>): string {
  const answer = object(answers[id], `Jev answer ${id} is invalid`) as unknown as ChoiceAnswer;
  if (answer.type !== "choice" || typeof answer.choice !== "string" || !allowed.includes(answer.choice) || !answer.probabilities || typeof answer.probabilities !== "object" || Array.isArray(answer.probabilities) || typeof answer.confidence !== "number" || !Number.isFinite(answer.confidence) || answer.confidence < 0 || answer.confidence > 1) throw new IntentAnalyzerFailure("protocol_error", `Jev choice answer ${id} is invalid`);
  const probabilities = answer.probabilities as Record<string, unknown>;
  const criteriaKeys = Object.keys(criteria);
  const probabilityKeys = Object.keys(probabilities);
  if (probabilityKeys.length !== criteriaKeys.length || probabilityKeys.some(key => !Object.hasOwn(criteria, key))) throw new IntentAnalyzerFailure("protocol_error", `Jev choice probabilities ${id} are invalid`);
  const values = probabilityKeys.map(key => probabilities[key]);
  if (values.some(value => typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) || Math.abs(values.reduce<number>((sum, value) => sum + (typeof value === "number" ? value : 0), 0) - 1) > 0.02) throw new IntentAnalyzerFailure("protocol_error", `Jev choice probabilities ${id} are invalid`);
  return answer.choice;
}
function noul(answers: Record<string, unknown>, id: string): boolean {
  const answer = object(answers[id], `Jev answer ${id} is invalid`) as unknown as NoulAnswer;
  if (answer.type !== "noul" || typeof answer.noul !== "number" || !Number.isFinite(answer.noul) || answer.noul < 0 || answer.noul > 1) throw new IntentAnalyzerFailure("protocol_error", `Jev noul answer ${id} is invalid`);
  return answer.noul > 0.5;
}

export class JevBackend implements IntentAnalyzerBackend {
  readonly id = "jev";
  private readonly endpoint: string;

  constructor(private readonly config: JevIntentAnalyzerConfig, private readonly apiKey: string, private readonly fetchImpl: FetchImplementation = fetch) {
    this.endpoint = new URL("v1/systemone", config.baseUrl).toString();
  }

  async analyze(input: IntentAnalyzerInput, signal: AbortSignal): Promise<IntentAnalysis> {
    const { questions, toolIds } = makeQuestions(input.tools ?? []);
    const headers: Record<string, string> = { "content-type": "application/json", accept: "application/json", authorization: `Bearer ${this.apiKey}` };
    const serializedBody = JSON.stringify({ state: { request: input.text }, model: this.config.model, questions });
    if (new TextEncoder().encode(serializedBody).byteLength > 256 * 1024) throw new IntentAnalyzerFailure("input_too_large", "Jev request exceeds the configured byte limit");
    let response: Response;
    try {
      response = await this.fetchImpl(this.endpoint, { method: "POST", headers, body: serializedBody, signal });
    } catch (error) {
      if (signal.aborted) throw error;
      throw new IntentAnalyzerFailure("network_error", "Jev request failed", { cause: error });
    }
    if (!response.ok) {
      try { void response.body?.cancel().catch(() => undefined); } catch { /* best effort */ }
      throw new IntentAnalyzerFailure("http_error", `Jev returned HTTP ${response.status}`, { status: response.status });
    }
    const bytes = await readBoundedBody(response, this.config.maxResponseBytes, signal);
    let payload: unknown;
    try { payload = JSON.parse(new TextDecoder().decode(bytes)) as unknown; }
    catch (error) { throw new IntentAnalyzerFailure("invalid_json", "Jev response is not valid JSON", { cause: error }); }
    const envelope = object(payload, "Jev response envelope is invalid");
    const usage = object(envelope.usage, "Jev response usage is invalid");
    if (typeof envelope.model !== "string" || !envelope.model || typeof usage.input_tokens !== "number" || !Number.isSafeInteger(usage.input_tokens) || usage.input_tokens < 0 || typeof usage.output_tokens !== "number" || !Number.isSafeInteger(usage.output_tokens) || usage.output_tokens < 0) throw new IntentAnalyzerFailure("protocol_error", "Jev response model or usage is invalid");
    const answers = object(envelope.answers, "Jev response answers are invalid");
    const expected = new Set(Object.keys(questions));
    const actual = Object.keys(answers);
    if (actual.length !== expected.size || actual.some(id => !expected.has(id))) throw new IntentAnalyzerFailure("protocol_error", "Jev response answers do not match the request");
    const selectedToolNames = [...toolIds.entries()].filter(([id]) => noul(answers, id)).map(([, name]) => name);
    return {
      schemaVersion: 2,
      primaryIntent: choice(answers, "primary_intent", PRIMARY_INTENTS, (questions.primary_intent as ChoiceQuestion).criteria) as IntentAnalysis["primaryIntent"],
      actionMode: choice(answers, "action_mode", ACTION_MODES, (questions.action_mode as ChoiceQuestion).criteria) as IntentAnalysis["actionMode"],
      needsMemory: noul(answers, "needs_memory"),
      needsExternalInformation: noul(answers, "needs_external_information"),
      userExplicitlyRequestedExecution: noul(answers, "user_explicitly_requested_execution"),
      shouldReply: noul(answers, "should_reply"),
      selectedToolNames,
    };
  }
}

export { makeQuestions as buildJevQuestions, questionIdForTool };
