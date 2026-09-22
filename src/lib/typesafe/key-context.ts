/**
 * Request-scoped TypeSafe credentials.
 *
 * A key entered in the settings modal belongs to one visitor, so it must not
 * become process-wide state: TYPESAFE_API_KEY stays the deployment-wide default
 * and a session key overrides it only for the async work of that one request.
 * AsyncLocalStorage carries it, which keeps `askTypeSafe` callers deep in the
 * engine and the pipeline free of plumbing they have no reason to know about.
 */
import { AsyncLocalStorage } from "node:async_hooks";

const store = new AsyncLocalStorage<string>();

/** Run `fn` with `key` as the active TypeSafe credential. A blank key changes nothing. */
export function runWithTypeSafeKey<T>(key: string | undefined, fn: () => T): T {
  return key ? store.run(key, fn) : fn();
}

/** The session key for the request in flight, if one was supplied. */
export function activeTypeSafeKey(): string | undefined {
  return store.getStore();
}
