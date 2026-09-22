/**
 * Thin wrapper over the official TypeSafe SDK. All TypeSafe traffic in the
 * app goes through `askTypeSafe`, which records usage and normalizes errors.
 */
import { TypeSafeClient, type Questions, type SystemOneResult, APIError } from "@typesafe-ai/sdk";

let client: TypeSafeClient | null = null;

export function isTypeSafeConfigured(): boolean {
  return Boolean(process.env.TYPESAFE_API_KEY);
}

export function typeSafeModel(): string {
  return process.env.TYPESAFE_MODEL ?? process.env.TYPESAFE_DEFAULT_MODEL ?? "jev-latest";
}

/** Drop the cached client (the API key or model changed). */
export function resetTypeSafeClient() {
  client = null;
}

function getClient(): TypeSafeClient {
  if (!client) {
    client = new TypeSafeClient({
      apiKey: process.env.TYPESAFE_API_KEY,
      defaultModel: typeSafeModel(),
      timeout: Number(process.env.TYPESAFE_TIMEOUT_MS ?? 45000),
      logLevel: "warn",
    });
  }
  return client;
}

/** TYPESAFE_API_KEY is missing: Stack4That cannot make decisions without it. */
export class TypeSafeNotConfiguredError extends Error {
  constructor() {
    super("TypeSafe is not configured. Set TYPESAFE_API_KEY (https://console.typesafe.ai/settings/keys) and restart the server.");
    this.name = "TypeSafeNotConfiguredError";
  }
}

export function assertTypeSafeConfigured(): void {
  if (!isTypeSafeConfigured()) throw new TypeSafeNotConfiguredError();
}

export class TypeSafeUnavailableError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = "TypeSafeUnavailableError";
  }
}

export interface AskResult<Q extends Questions> {
  answers: SystemOneResult<Q>["answers"];
  model: string;
  usage: { inputTokens: number; outputTokens: number };
  latencyMs: number;
  questionCount: number;
}

/** Ask a batch of questions about one state. Throws TypeSafeUnavailableError on failure. */
export async function askTypeSafe<const Q extends Questions>(state: unknown, questions: Q, signal?: AbortSignal): Promise<AskResult<Q>> {
  assertTypeSafeConfigured();
  const started = Date.now();
  try {
    const res = await getClient().systemOne({ state: state as never, questions }, { signal });
    return {
      answers: res.answers,
      model: res.model,
      usage: { inputTokens: res.usage.input_tokens, outputTokens: res.usage.output_tokens },
      latencyMs: Date.now() - started,
      questionCount: Object.keys(questions).length,
    };
  } catch (err) {
    if (err instanceof APIError) {
      throw new TypeSafeUnavailableError(`TypeSafe API error ${err.status}: ${err.message}`, err);
    }
    throw new TypeSafeUnavailableError(`TypeSafe request failed: ${(err as Error).message}`, err);
  }
}

/** Split a large question map into requests that respect the model's context budget. */
export async function askTypeSafeChunked<const Q extends Questions>(state: unknown, questions: Q, chunkSize = 90, signal?: AbortSignal): Promise<AskResult<Q>> {
  const keys = Object.keys(questions);
  if (keys.length <= chunkSize) return askTypeSafe(state, questions, signal);
  const merged: Record<string, unknown> = {};
  let usage = { inputTokens: 0, outputTokens: 0 };
  let latency = 0;
  let model = "";
  const chunks: Questions[] = [];
  for (let i = 0; i < keys.length; i += chunkSize) {
    const sub: Questions = {};
    for (const k of keys.slice(i, i + chunkSize)) sub[k] = questions[k];
    chunks.push(sub);
  }
  const results = await Promise.all(chunks.map((c) => askTypeSafe(state, c, signal)));
  for (const r of results) {
    Object.assign(merged, r.answers);
    usage = { inputTokens: usage.inputTokens + r.usage.inputTokens, outputTokens: usage.outputTokens + r.usage.outputTokens };
    latency = Math.max(latency, r.latencyMs);
    model = r.model;
  }
  return { answers: merged as AskResult<Q>["answers"], model, usage, latencyMs: latency, questionCount: keys.length };
}
