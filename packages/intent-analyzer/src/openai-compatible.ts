import { buildClassifierUserPrompt, CLASSIFIER_SYSTEM_PROMPT } from "./prompt.js";
import type { IntentAnalyzerBackend, IntentAnalyzerInput } from "./contract.js";
import { IntentAnalyzerFailure } from "./contract.js";
import type { IntentAnalyzerConfig } from "./config.js";
import { readBoundedBody } from "./bounded-body.js";

export type FetchImplementation = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export class OpenAICompatibleChatBackend implements IntentAnalyzerBackend {
  readonly id = "openai-chat-completions";
  private readonly endpoint: string;
  private readonly fetchImpl: FetchImplementation;

  constructor(private readonly config: Extract<IntentAnalyzerConfig, { protocol: "openai-chat-completions" }>, private readonly apiKey?: string, fetchImpl: FetchImplementation = fetch) {
    this.endpoint = new URL("chat/completions", config.baseUrl).toString();
    this.fetchImpl = fetchImpl;
  }

  async analyze(input: IntentAnalyzerInput, signal: AbortSignal): Promise<unknown> {
    const headers: Record<string, string> = { "content-type": "application/json", accept: "application/json" };
    const apiKey = this.apiKey?.trim();
    if (apiKey) headers.authorization = `Bearer ${apiKey}`;
    const body: Record<string, unknown> = {
      model: this.config.model,
      temperature: 0,
      stream: false,
      messages: [{ role: "system", content: CLASSIFIER_SYSTEM_PROMPT }, { role: "user", content: buildClassifierUserPrompt(input.text, input.tools ?? []) }],
    };
    if (this.config.responseFormat === "json-object") body.response_format = { type: "json_object" };
    const serializedBody = JSON.stringify(body);
    if (new TextEncoder().encode(serializedBody).byteLength > 256 * 1024) throw new IntentAnalyzerFailure("input_too_large", "analyzer request exceeds the configured byte limit");
    let response: Response;
    try { response = await this.fetchImpl(this.endpoint, { method: "POST", headers, body: serializedBody, signal }); }
    catch (error) {
      if (signal.aborted) throw error;
      throw new IntentAnalyzerFailure("network_error", "analyzer request failed", { cause: error });
    }
    if (!response.ok) {
      try { void response.body?.cancel().catch(() => undefined); } catch { /* response cleanup is best effort */ }
      throw new IntentAnalyzerFailure("http_error", `analyzer returned HTTP ${response.status}`, { status: response.status });
    }
    const bytes = await readBoundedBody(response, this.config.maxResponseBytes, signal);
    let envelope: unknown;
    try { envelope = JSON.parse(new TextDecoder().decode(bytes)) as unknown; }
    catch (error) { throw new IntentAnalyzerFailure("invalid_json", "analyzer response is not valid JSON", { cause: error }); }
    if (!envelope || typeof envelope !== "object" || Array.isArray(envelope)) throw new IntentAnalyzerFailure("protocol_error", "analyzer response envelope is invalid");
    const choices = (envelope as { choices?: unknown }).choices;
    if (!Array.isArray(choices) || !choices[0] || typeof choices[0] !== "object" || Array.isArray(choices[0])) throw new IntentAnalyzerFailure("protocol_error", "analyzer response has no choices");
    const message = (choices[0] as { message?: unknown }).message;
    if (!message || typeof message !== "object" || Array.isArray(message) || typeof (message as { content?: unknown }).content !== "string") throw new IntentAnalyzerFailure("protocol_error", "analyzer response content is invalid");
    try { return JSON.parse((message as { content: string }).content) as unknown; }
    catch (error) { throw new IntentAnalyzerFailure("invalid_json", "analyzer message content is not valid JSON", { cause: error }); }
  }
}
