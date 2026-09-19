# intent-analyzer

Optional Umiro context provider that classifies only the current request prompt and adds a small, strict-schema advisory intent block. It never grants authorization, chooses tools or models, stores durable data, or sends history, memory, secrets, or other context to the analyzer.

## Install and configure

From a Umiro installation, install this workspace from the public plugin repository without supplying configuration:

```bash
umo plugin install https://github.com/iiimabbie/umiro-plugins --workspace intent-analyzer
```

Installation restarts Umiro before configuration. Empty or incomplete configuration is therefore a valid, inert state: the plugin loads successfully, Umiro remains ready, and the provider returns no context until setup is complete. After the restart, configure `protocol`, `baseUrl`, and `model` through WebUI or `umo plugin configure`.

The only supported protocol is `openai-chat-completions`. Optional settings are `timeoutMs` (default `1500`), `maxInputCharacters` (default `12000`), `maxResponseBytes` (default `32768`), and `responseFormat` (`prompt-only` by default, or `json-object` for endpoints that support JSON mode).

For a local endpoint that does not require authentication, omit `UMIRO_INTENT_API_KEY`:

```json
{
  "protocol": "openai-chat-completions",
  "baseUrl": "http://127.0.0.1:11434/v1",
  "model": "your-small-instruct-model",
  "timeoutMs": 1500,
  "responseFormat": "prompt-only"
}
```

For a hosted endpoint, configure its OpenAI-compatible base URL and model, then set the Umiro secret `UMIRO_INTENT_API_KEY`. The plugin sends the trimmed value as an `Authorization: Bearer` header and never logs it.

Jev works when the selected Jev endpoint implements this same OpenAI-compatible Chat Completions protocol. Jev endpoints using a different private wire protocol are not supported by this version; no Jev-specific API is assumed.

Analyzer errors, invalid responses, oversized responses, and timeouts fail open: Umiro continues the ordinary run without an intent block. An already-cancelled upstream request remains cancelled. The resulting block is untrusted advisory metadata and does not control permissions, tools, models, or execution.
