export type ResponseFormat = "prompt-only" | "json-object";

export interface CommonIntentAnalyzerConfig {
  readonly baseUrl: string;
  readonly model: string;
  readonly timeoutMs: number;
  readonly maxInputCharacters: number;
  readonly maxResponseBytes: number;
}

export interface OpenAIIntentAnalyzerConfig extends CommonIntentAnalyzerConfig {
  readonly protocol: "openai-chat-completions";
  readonly responseFormat: ResponseFormat;
}

export interface JevIntentAnalyzerConfig extends CommonIntentAnalyzerConfig {
  readonly protocol: "jev";
}

export type IntentAnalyzerConfig = OpenAIIntentAnalyzerConfig | JevIntentAnalyzerConfig;
export type IntentAnalyzerProtocol = IntentAnalyzerConfig["protocol"];
export type MissingField = "protocol" | "baseUrl" | "model";

export interface IntentAnalyzerConfigResolution {
  readonly config?: IntentAnalyzerConfig;
  readonly missingFields: readonly MissingField[];
}

export const DEFAULTS = { timeoutMs: 1_500, maxInputCharacters: 12_000, maxResponseBytes: 32_768, responseFormat: "prompt-only" as ResponseFormat } as const;
const KEYS = new Set(["protocol", "baseUrl", "model", "timeoutMs", "maxInputCharacters", "maxResponseBytes", "responseFormat"]);

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("intent-analyzer config must be an object");
  return value as Record<string, unknown>;
}
function string(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim()) throw new TypeError(`intent-analyzer config ${name} must be a non-empty string`);
  return value.trim();
}
function integer(value: unknown, name: string, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) throw new TypeError(`intent-analyzer config ${name} must be an integer from ${minimum} to ${maximum}`);
  return value as number;
}
function endpoint(value: unknown): string {
  const baseUrl = string(value, "baseUrl");
  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
    if (!parsed.pathname.endsWith("/")) parsed.pathname += "/";
  } catch { throw new TypeError("intent-analyzer config baseUrl must be a valid URL"); }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new TypeError("intent-analyzer config baseUrl must use http or https");
  return parsed.toString();
}
function limits(raw: Record<string, unknown>): Pick<CommonIntentAnalyzerConfig, "timeoutMs" | "maxInputCharacters" | "maxResponseBytes"> {
  return {
    timeoutMs: raw.timeoutMs === undefined ? DEFAULTS.timeoutMs : integer(raw.timeoutMs, "timeoutMs", 100, 10_000),
    maxInputCharacters: raw.maxInputCharacters === undefined ? DEFAULTS.maxInputCharacters : integer(raw.maxInputCharacters, "maxInputCharacters", 1, 100_000),
    maxResponseBytes: raw.maxResponseBytes === undefined ? DEFAULTS.maxResponseBytes : integer(raw.maxResponseBytes, "maxResponseBytes", 256, 1_048_576),
  };
}

export function parseConfig(value: unknown): IntentAnalyzerConfig {
  const raw = record(value);
  for (const key of Object.keys(raw)) if (!KEYS.has(key)) throw new TypeError(`intent-analyzer config contains unknown field: ${key}`);
  const protocol = raw.protocol;
  if (protocol !== "openai-chat-completions" && protocol !== "jev") throw new TypeError("intent-analyzer config protocol must be openai-chat-completions or jev");
  const common = { baseUrl: endpoint(raw.baseUrl), model: string(raw.model, "model"), ...limits(raw) };
  if (protocol === "jev") return { protocol, ...common };
  const responseFormat = raw.responseFormat === undefined ? DEFAULTS.responseFormat : raw.responseFormat;
  if (responseFormat !== "prompt-only" && responseFormat !== "json-object") throw new TypeError("intent-analyzer config responseFormat is invalid");
  return { protocol, ...common, responseFormat };
}

/** Empty or partially completed setup is an inert, valid installation state. */
export function resolveConfig(value: unknown): IntentAnalyzerConfigResolution {
  const raw = record(value);
  for (const key of Object.keys(raw)) if (!KEYS.has(key)) throw new TypeError(`intent-analyzer config contains unknown field: ${key}`);
  if (raw.protocol !== undefined && typeof raw.protocol !== "string") throw new TypeError("intent-analyzer config protocol must be a string");
  if (typeof raw.protocol === "string" && raw.protocol.trim() && raw.protocol !== "openai-chat-completions" && raw.protocol !== "jev") throw new TypeError("intent-analyzer config protocol must be openai-chat-completions or jev");
  const missingFields = (["protocol", "baseUrl", "model"] as const).filter(key => raw[key] === undefined || (typeof raw[key] === "string" && !raw[key].trim()));
  return missingFields.length ? { missingFields } : { config: parseConfig(raw), missingFields: [] };
}
