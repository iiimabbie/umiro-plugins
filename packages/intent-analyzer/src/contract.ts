export type PrimaryIntent = "chat" | "code_analysis" | "code_change" | "research" | "memory_query" | "scheduling" | "system_control" | "unknown";
export type ActionMode = "read_only" | "mutate" | "execute" | "unknown";

export interface IntentAnalysis {
  readonly schemaVersion: 1;
  readonly primaryIntent: PrimaryIntent;
  readonly actionMode: ActionMode;
  readonly needsMemory: boolean;
  readonly needsExternalInformation: boolean;
  readonly userExplicitlyRequestedExecution: boolean;
  readonly confidence?: number;
}

export interface IntentAnalyzerInput { readonly text: string }
export interface IntentAnalyzerBackend {
  readonly id: string;
  analyze(input: IntentAnalyzerInput, signal: AbortSignal): Promise<unknown>;
}

export type FailureCategory = "http_error" | "protocol_error" | "invalid_json" | "invalid_schema" | "response_too_large" | "timeout" | "network_error" | "input_too_large";

export class IntentAnalyzerFailure extends Error {
  readonly category: FailureCategory;
  readonly status?: number;

  constructor(category: FailureCategory, message: string, options?: { readonly status?: number; readonly cause?: unknown }) {
    super(message, options?.cause === undefined ? undefined : { cause: options.cause });
    this.name = "IntentAnalyzerFailure";
    this.category = category;
    if (options?.status !== undefined) this.status = options.status;
  }
}
