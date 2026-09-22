/**
 * Manage the visitor's own TypeSafe API key.
 *
 * The key is never sent back to the browser once stored: GET reports only
 * whether one is in effect and where it came from, so the modal can render
 * honest state without the page ever holding the secret.
 */
import { clientKey, rateLimit, tooManyRequests } from "@/lib/rate-limit";
import { askTypeSafe } from "@/lib/typesafe/client";
import { runWithTypeSafeKey } from "@/lib/typesafe/key-context";
import { clearSessionKey, looksLikeApiKey, readSessionKey, writeSessionKey } from "@/lib/typesafe/session-key";
import { AuthenticationError, noul, PermissionDeniedError } from "@typesafe-ai/sdk";

export const dynamic = "force-dynamic";

type Source = "session" | "env" | "none";

async function status(): Promise<{ source: Source; hint?: string }> {
  const session = await readSessionKey();
  if (session) return { source: "session", hint: hintFor(session) };
  return { source: process.env.TYPESAFE_API_KEY ? "env" : "none" };
}

/** Last four characters only: enough to recognise which key is saved, useless if leaked. */
function hintFor(key: string): string {
  return `…${key.slice(-4)}`;
}

export async function GET() {
  return Response.json(await status());
}

/**
 * The cheapest real call we can make: one question. If TypeSafe answers it the
 * key works, which beats saving a key that only fails later mid-architecture.
 */
async function keyWorks(key: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await runWithTypeSafeKey(key, () =>
      askTypeSafe({ text: "Stack4That is verifying an API key." }, { valid: noul("Is this text written in English?", { true: "It is English", false: "It is not English" }) }),
    );
    return { ok: true };
  } catch (err) {
    // askTypeSafe normalizes SDK failures but keeps the original as `cause`.
    const cause = (err as { cause?: unknown }).cause;
    if (cause instanceof AuthenticationError || cause instanceof PermissionDeniedError) {
      return { ok: false, error: "TypeSafe rejected that key. Check it was copied whole from the console." };
    }
    return { ok: false, error: `Could not reach TypeSafe to verify the key: ${(err as Error).message}` };
  }
}

export async function POST(request: Request) {
  // Verifying spends a TypeSafe call and talks to an upstream service, so it is
  // limited like the other endpoints that cost something.
  const limited = rateLimit(`settings:${clientKey(request)}`, 10, 60_000);
  if (!limited.ok) return tooManyRequests(limited.retryAfter);

  const body = (await request.json().catch(() => ({}))) as { key?: unknown };
  const key = typeof body.key === "string" ? body.key.trim() : "";
  if (!key) return Response.json({ error: "A key is required." }, { status: 400 });
  if (!looksLikeApiKey(key)) return Response.json({ error: "That does not look like an API key. Paste the whole value from the TypeSafe console." }, { status: 400 });

  const verified = await keyWorks(key);
  if (!verified.ok) return Response.json({ error: verified.error }, { status: 400 });

  await writeSessionKey(key);
  return Response.json({ source: "session" satisfies Source, hint: hintFor(key) });
}

export async function DELETE() {
  await clearSessionKey();
  return Response.json({ source: process.env.TYPESAFE_API_KEY ? ("env" as const) : ("none" as const) });
}
