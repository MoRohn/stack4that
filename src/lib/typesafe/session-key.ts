/**
 * The visitor's own TypeSafe key, carried in an httpOnly cookie.
 *
 * httpOnly keeps the key out of reach of page scripts, so an XSS bug or a
 * curious extension can not lift it; the browser simply replays it to our own
 * routes, which hand it to `runWithTypeSafeKey` for the life of the request.
 * Only ever imported from route handlers — `next/headers` is request-only, and
 * the pipeline runs from the CLI too.
 */
import { cookies } from "next/headers";
import { runWithTypeSafeKey } from "./key-context";

export const SESSION_KEY_COOKIE = "s4t_typesafe_key";

/** How long a saved key survives. Long enough to be convenient, short enough to lapse. */
const MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

/**
 * Shape check only — whether the key actually works is decided by TypeSafe, not
 * by us guessing at their format. This just rejects obvious paste accidents.
 */
export function looksLikeApiKey(value: string): boolean {
  return value.length >= 16 && value.length <= 256 && !/[\s\u0000-\u001f]/.test(value);
}

export async function readSessionKey(): Promise<string | undefined> {
  const value = (await cookies()).get(SESSION_KEY_COOKIE)?.value?.trim();
  return value && looksLikeApiKey(value) ? value : undefined;
}

export async function writeSessionKey(key: string): Promise<void> {
  (await cookies()).set(SESSION_KEY_COOKIE, key, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: MAX_AGE_SECONDS,
  });
}

export async function clearSessionKey(): Promise<void> {
  (await cookies()).delete(SESSION_KEY_COOKIE);
}

/**
 * Run a route handler with the visitor's key active, falling back to the
 * server's TYPESAFE_API_KEY (from .env.local in development) when they have
 * not set one. Every route that can reach TypeSafe goes through this.
 */
export async function withSessionKey<T>(fn: () => T | Promise<T>): Promise<T> {
  return runWithTypeSafeKey(await readSessionKey(), fn);
}
