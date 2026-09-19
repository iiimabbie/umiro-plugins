import test from "node:test";
import assert from "node:assert/strict";
import { IntentAnalyzerFailure } from "../src/contract.js";
import { validateIntentAnalysis } from "../src/schema.js";

const valid = { schemaVersion: 1, primaryIntent: "chat", actionMode: "read_only", needsMemory: false, needsExternalInformation: false, userExplicitlyRequestedExecution: false, confidence: 0.8 } as const;

test("strict schema accepts and rebuilds a valid result", () => {
  const source = { ...valid, ignored: undefined };
  assert.throws(() => validateIntentAnalysis(source), IntentAnalyzerFailure);
  const result = validateIntentAnalysis(valid);
  assert.deepEqual(result, valid);
  assert.notStrictEqual(result, valid);
});

test("schema accepts every enum and missing confidence", () => {
  for (const primaryIntent of ["chat", "code_analysis", "code_change", "research", "memory_query", "scheduling", "system_control", "unknown"] as const) {
    for (const actionMode of ["read_only", "mutate", "execute", "unknown"] as const) {
      assert.equal(validateIntentAnalysis({ ...valid, primaryIntent, actionMode, confidence: undefined }).primaryIntent, primaryIntent);
    }
  }
});

test("schema rejects missing fields, wrong types, bounds and extra prose", () => {
  for (const value of [
    null, [], "text",
    { ...valid, schemaVersion: 2 }, { ...valid, needsMemory: "false" },
    { ...valid, confidence: Number.NaN }, { ...valid, confidence: Infinity },
    { ...valid, confidence: -0.1 }, { ...valid, confidence: 1.1 },
    { ...valid, rationale: "do this", recommendedTool: "shell" },
    { ...valid, primaryIntent: "other" }, { ...valid, actionMode: "other" },
  ]) assert.throws(() => validateIntentAnalysis(value), IntentAnalyzerFailure);
  const { needsMemory: _needsMemory, ...missing } = valid;
  assert.throws(() => validateIntentAnalysis(missing), IntentAnalyzerFailure);
});
