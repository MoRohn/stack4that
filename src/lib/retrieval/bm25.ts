import { tokenize } from "@/lib/embeddings/hash";

/** Small in-memory BM25 index over short documents. */
export class BM25Index {
  private docs: Map<string, Map<string, number>> = new Map();
  private docLen: Map<string, number> = new Map();
  private df: Map<string, number> = new Map();
  private avgLen = 0;
  private readonly k1 = 1.4;
  private readonly b = 0.75;

  constructor(entries: Array<{ id: string; text: string }>) {
    let total = 0;
    for (const e of entries) {
      const tf = new Map<string, number>();
      const tokens = tokenize(e.text);
      for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
      this.docs.set(e.id, tf);
      this.docLen.set(e.id, tokens.length);
      total += tokens.length;
      for (const term of tf.keys()) this.df.set(term, (this.df.get(term) ?? 0) + 1);
    }
    this.avgLen = entries.length ? total / entries.length : 1;
  }

  get size() {
    return this.docs.size;
  }

  score(query: string, id: string): number {
    const tf = this.docs.get(id);
    if (!tf) return 0;
    const N = this.docs.size;
    const len = this.docLen.get(id) ?? 0;
    let s = 0;
    for (const q of new Set(tokenize(query))) {
      const f = tf.get(q);
      if (!f) continue;
      const df = this.df.get(q) ?? 0;
      const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5));
      s += idf * ((f * (this.k1 + 1)) / (f + this.k1 * (1 - this.b + (this.b * len) / this.avgLen)));
    }
    return s;
  }

  search(query: string, limit = 50): Array<{ id: string; score: number }> {
    const out: Array<{ id: string; score: number }> = [];
    for (const id of this.docs.keys()) {
      const s = this.score(query, id);
      if (s > 0) out.push({ id, score: s });
    }
    out.sort((a, b) => b.score - a.score);
    return out.slice(0, limit);
  }
}
