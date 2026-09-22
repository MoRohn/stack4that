import { normalize, type EmbeddingProvider } from "./provider";

/**
 * Local BGE-small embeddings through @huggingface/transformers (optional
 * dependency). The package name is resolved at runtime so the app builds
 * without it installed; install it and set EMBEDDING_PROVIDER=bge to enable.
 */
export class BgeEmbeddingProvider implements EmbeddingProvider {
  readonly id = "bge-small-en-v1.5";
  readonly dimensions = 384;
  private pipe: Promise<(texts: string[], opts: Record<string, unknown>) => Promise<{ tolist(): number[][] }>> | null = null;

  private load() {
    if (!this.pipe) {
      const moduleName = "@huggingface/transformers";
      this.pipe = (import(/* webpackIgnore: true */ moduleName) as Promise<{ pipeline: (task: string, model: string) => Promise<unknown> }>)
        .then(async (m) => {
          const p = await m.pipeline("feature-extraction", "BAAI/bge-small-en-v1.5");
          return p as (texts: string[], opts: Record<string, unknown>) => Promise<{ tolist(): number[][] }>;
        })
        .catch((err) => {
          throw new Error(`BGE provider unavailable: install @huggingface/transformers (${(err as Error).message})`);
        });
    }
    return this.pipe;
  }

  async embed(texts: string[]): Promise<number[][]> {
    const pipe = await this.load();
    const out: number[][] = [];
    for (let i = 0; i < texts.length; i += 16) {
      const res = await pipe(texts.slice(i, i + 16), { pooling: "cls", normalize: true });
      for (const v of res.tolist()) out.push(normalize(v));
    }
    return out;
  }
}
