import type { ActionMode, IntentAnalysis, PrimaryIntent } from "./contract.js";
import { IntentAnalyzerFailure } from "./contract.js";

const PRIMARY = new Set<PrimaryIntent>(["chat", "code_analysis", "code_change", "research", "memory_query", "scheduling", "system_control", "unknown"]);
const ACTION = new Set<ActionMode>(["read_only", "mutate", "execute", "unknown"]);
const FIELDS = new Set(["schemaVersion", "primaryIntent", "actionMode", "needsMemory", "needsExternalInformation", "userExplicitlyRequestedExecution", "confidence"]);

export function validateIntentAnalysis(value: unknown): IntentAnalysis {
  if (!value || typeof value !== "object" || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new IntentAnalyzerFailure("invalid_schema", "intent analysis must be a plain object");
  const raw = value as Record<string, unknown>;
  if (Object.keys(raw).some(key => !FIELDS.has(key))) throw new IntentAnalyzerFailure("invalid_schema", "intent analysis contains an unsupported field");
  if (raw.schemaVersion !== 1) throw new IntentAnalyzerFailure("invalid_schema", "intent analysis schemaVersion must be 1");
  if (typeof raw.primaryIntent !== "string" || !PRIMARY.has(raw.primaryIntent as PrimaryIntent)) throw new IntentAnalyzerFailure("invalid_schema", "intent analysis primaryIntent is invalid");
  if (typeof raw.actionMode !== "string" || !ACTION.has(raw.actionMode as ActionMode)) throw new IntentAnalyzerFailure("invalid_schema", "intent analysis actionMode is invalid");
  for (const key of ["needsMemory", "needsExternalInformation", "userExplicitlyRequestedExecution"]) if (typeof raw[key] !== "boolean") throw new IntentAnalyzerFailure("invalid_schema", `intent analysis ${key} must be boolean`);
  if (raw.confidence !== undefined && (typeof raw.confidence !== "number" || !Number.isFinite(raw.confidence) || raw.confidence < 0 || raw.confidence > 1)) throw new IntentAnalyzerFailure("invalid_schema", "intent analysis confidence must be a finite number from 0 to 1");
  return {
    schemaVersion: 1,
    primaryIntent: raw.primaryIntent as PrimaryIntent,
    actionMode: raw.actionMode as ActionMode,
    needsMemory: raw.needsMemory as boolean,
    needsExternalInformation: raw.needsExternalInformation as boolean,
    userExplicitlyRequestedExecution: raw.userExplicitlyRequestedExecution as boolean,
    ...(raw.confidence === undefined ? {} : { confidence: raw.confidence as number }),
  };
}
