export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | readonly JsonValue[];
export type JsonObject = { readonly [key: string]: JsonValue };

export type InstructionAuthority = "none" | "scoped" | "full";

export interface AuthorityScopeRequest {
  readonly capabilities?: readonly string[];
  readonly visibility?: { readonly kind: "all" } | { readonly kind: "restricted"; readonly principalIds: readonly string[]; readonly labels: readonly string[]; readonly resources: readonly { readonly kind: string; readonly id: string }[] };
  readonly instructionAuthority?: InstructionAuthority;
}

export interface BudgetCeiling {
  readonly maxModelTurns?: number;
  readonly maxToolCalls?: number;
  readonly maxInputTokens?: number;
  readonly maxOutputTokens?: number;
  readonly maxDurationMs?: number;
}

/** Static, author-auditable subagent role. Declared in the manifest only. */
export interface SubagentProfileDefinition {
  readonly id: string;
  readonly description: string;
  /** The child's standing prompt, one line per element, joined with "\n". */
  readonly instructions: readonly string[];
  readonly model?: string;
  /** Availability gate at registration; not a per-Run tool allowlist. */
  readonly requiredTools?: readonly string[];
  /** Narrowing only. Intersected with the Parent Run authority by the Core. */
  readonly authorityScope?: AuthorityScopeRequest;
  readonly budgetCeiling?: BudgetCeiling;
  readonly outputContract?: { readonly kind: "text" | "json" | "artifact"; readonly schema?: JsonObject };
}

export interface PluginManifest {
  readonly schemaVersion: 0;
  readonly id: string;
  readonly version: string;
  readonly coreApi: string;
  readonly entry: string;
  readonly namespace: string;
  readonly permissions: { readonly capabilities: readonly string[]; readonly visibility: { readonly kind: string }; readonly instructionAuthority: InstructionAuthority };
  readonly contributes: { readonly subagentProfiles?: readonly SubagentProfileDefinition[] };
}

export interface PluginLogger { debug(event: string, message: string, data?: JsonObject): void; info(event: string, message: string, data?: JsonObject): void; warn(event: string, message: string, data?: JsonObject): void; error(event: string, message: string, data?: JsonObject): void }

export interface PluginSetupContext {
  readonly pluginId: string;
  readonly namespace: string;
  readonly permissionCeiling: unknown;
  readonly config: JsonObject;
  readonly logger?: PluginLogger;
  getSecret(name: string): string | undefined;
}

export interface PluginInstance {
  readonly contributions: { readonly tools?: readonly unknown[]; readonly contextProviders?: readonly unknown[] };
  start?(): Promise<void>;
  stop?(): Promise<void>;
}
