import { assertTypeSafeConfigured } from "./client";
import type { DecisionEngine } from "./contracts";
import { TypeSafeDecisionEngine } from "./engine";

export * from "./contracts";
export { assertTypeSafeConfigured, isTypeSafeConfigured, TypeSafeNotConfiguredError, TypeSafeUnavailableError } from "./client";
export { TypeSafeDecisionEngine } from "./engine";

/** Stack4That decides with TypeSafe only. There is no alternative engine. */
export function getDecisionEngine(): DecisionEngine {
  assertTypeSafeConfigured();
  return new TypeSafeDecisionEngine();
}
