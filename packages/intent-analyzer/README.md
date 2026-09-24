# intent-analyzer

Optional Umiro turn analyzer that classifies the current request once and adds strict-schema advisory intent, reply, and tool-selection metadata. It never grants authorization, executes tools, or sends history, memory, secrets, tool results, or runtime authorization to the analyzer.

## Install and configure

From a Umiro installation, install this workspace from the public plugin repository without supplying configuration:

```bash
umo plugin install https://github.com/iiimabbie/umiro-plugins --workspace intent-analyzer
```

Installation restarts Umiro before configuration. Empty or incomplete configuration is therefore a valid, inert state: the plugin loads successfully, Umiro remains ready, and the analyzer returns no result until setup is complete. After the restart, configure `protocol`, `baseUrl`, and `model` through WebUI or `umo plugin configure`; choose exactly one backend.

Supported protocols are `openai-chat-completions` and `jev`. Shared settings are `timeoutMs` (default `1500`), `maxInputCharacters` (default `12000`), and `maxResponseBytes` (default `32768`). `responseFormat` (`prompt-only` by default, or `json-object`) applies only to OpenAI-compatible endpoints.

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

For Jev, use the TypeSafe API root and `jev-latest`, then set the optional Umiro secret `TYPESAFE_API_KEY`:

```json
{
  "protocol": "jev",
  "baseUrl": "https://api.typesafe.ai",
  "model": "jev-latest",
  "timeoutMs": 1500
}
```

Jev uses `POST /v1/systemone` with one request containing intent, reply, and per-tool questions. The request includes only this turn's text and registered tools' model-facing name, description, and parameter schemas; it never includes history, memory, credentials, tool results, or runtime authorization. See the TypeSafe [API reference](https://docs.typesafe.ai/api.md).

Analyzer errors, invalid responses, oversized responses, and timeouts fail open: Umiro falls back to its deterministic reply decision and exposes all registered tools. An already-cancelled upstream request remains cancelled. The result may gate Run creation and narrow the tools directly visible on the first model turn, but remains untrusted advisory data: it never grants permission, authorizes a resource, or executes a tool. The `tool_catalog` exploration tool remains visible regardless of analysis and is excluded from analyzer candidates. The model can use its list, search, and describe actions to discover tools, then call a tool that was not selected for direct first-turn visibility. The catalog only routes that call; the target tool's own authorization and input validation still apply.
