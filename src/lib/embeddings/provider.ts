/**
 * Embedding provider abstraction. Swap providers with EMBEDDING_PROVIDER:
 *   hash     - deterministic feature-hashing embeddings, no dependencies (default)
 *   openai   - any OpenAI-compatible /v1/embeddings endpoint (EMBEDDING_API_URL, EMBEDDING_API_KEY, EMBEDDING_MODEL)
 *   bge      - local BGE-small via @huggingface/transformers if installed
 */
export interface EmbeddingProvider {
  readonly id: string;
  readonly dimensions: number;
  embed(texts: string[]): Promise<number[][]>;
}

export function cosine(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const d = Math.sqrt(na) * Math.sqrt(nb);
  return d === 0 ? 0 : dot / d;
}

export function normalize(v: number[]): number[] {
  const n = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
  return n === 0 ? v : v.map((x) => x / n);
}
