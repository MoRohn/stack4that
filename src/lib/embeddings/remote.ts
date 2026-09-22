import { normalize, type EmbeddingProvider } from "./provider";

/** OpenAI-compatible embeddings endpoint. */
export class RemoteEmbeddingProvider implements EmbeddingProvider {
  readonly id: string;
  readonly dimensions: number;
  constructor(
    private readonly url: string,
    private readonly apiKey: string | undefined,
    private readonly model: string,
    dimensions: number,
  ) {
    this.id = `remote:${model}`;
    this.dimensions = dimensions;
  }

  async embed(texts: string[]): Promise<number[][]> {
    const out: number[][] = [];
    for (let i = 0; i < texts.length; i += 64) {
      const batch = texts.slice(i, i + 64);
      const res = await fetch(this.url, {
        method: "POST",
        headers: { "content-type": "application/json", ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {}) },
        body: JSON.stringify({ model: this.model, input: batch }),
      });
      if (!res.ok) throw new Error(`embedding request failed: ${res.status} ${await res.text()}`);
      const json = (await res.json()) as { data: Array<{ embedding: number[]; index: number }> };
      const sorted = [...json.data].sort((a, b) => a.index - b.index);
      for (const d of sorted) out.push(normalize(d.embedding));
    }
    return out;
  }
}
