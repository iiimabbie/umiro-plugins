export type ResponseFormat = "prompt-only" | "json-object";
export interface IntentAnalyzerConfig {
  readonly protocol: "openai-chat-completions";
  readonly baseUrl: string;
  readonly model: string;
  readonly timeoutMs: number;
  readonly maxInputCharacters: number;
  readonly maxResponseBytes: number;
  readonly responseFormat: ResponseFormat;
}

export interface IntentAnalyzerConfigResolution {
  readonly config?: IntentAnalyzerConfig;
  readonly missingFields: readonly ("protocol" | "baseUrl" | "model")[];
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

export function parseConfig(value: unknown): IntentAnalyzerConfig {
  const raw = record(value);
  for (const key of Object.keys(raw)) if (!KEYS.has(key)) throw new TypeError(`intent-analyzer config contains unknown field: ${key}`);
  if (raw.protocol !== "openai-chat-completions") throw new TypeError("intent-analyzer config protocol must be openai-chat-completions");
  const baseUrl = string(raw.baseUrl, "baseUrl");
  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
    if (!parsed.pathname.endsWith("/")) parsed.pathname += "/";
  } catch { throw new TypeError("intent-analyzer config baseUrl must be a valid URL"); }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new TypeError("intent-analyzer config baseUrl must use http or https");
  const model = string(raw.model, "model");
  const timeoutMs = raw.timeoutMs === undefined ? DEFAULTS.timeoutMs : integer(raw.timeoutMs, "timeoutMs", 100, 10_000);
  const maxInputCharacters = raw.maxInputCharacters === undefined ? DEFAULTS.maxInputCharacters : integer(raw.maxInputCharacters, "maxInputCharacters", 1, 100_000);
  const maxResponseBytes = raw.maxResponseBytes === undefined ? DEFAULTS.maxResponseBytes : integer(raw.maxResponseBytes, "maxResponseBytes", 256, 1_048_576);
  const responseFormat = raw.responseFormat === undefined ? DEFAULTS.responseFormat : raw.responseFormat;
  if (responseFormat !== "prompt-only" && responseFormat !== "json-object") throw new TypeError("intent-analyzer config responseFormat is invalid");
  return { protocol: "openai-chat-completions", baseUrl: parsed.toString(), model, timeoutMs, maxInputCharacters, maxResponseBytes, responseFormat };
}

/** Empty or partially completed setup is an inert, valid installation state.
 * Plugin installation restarts Umiro before the user can configure the plugin. */
export function resolveConfig(value: unknown): IntentAnalyzerConfigResolution {
  const raw = record(value);
  for (const key of Object.keys(raw)) if (!KEYS.has(key)) throw new TypeError(`intent-analyzer config contains unknown field: ${key}`);
  const missingFields = (["protocol", "baseUrl", "model"] as const).filter(key => raw[key] === undefined || (typeof raw[key] === "string" && !raw[key].trim()));
  return missingFields.length ? { missingFields } : { config: parseConfig(raw), missingFields: [] };
}
