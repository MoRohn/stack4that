import { normalize, type EmbeddingProvider } from "./provider";

/**
 * Feature-hashing embedding: word unigrams, bigrams and character trigrams
 * hashed into a fixed-size vector with sign hashing. Deterministic, fast, no
 * model download. Captures lexical similarity well; semantics come from the
 * hybrid retrieval signals layered on top.
 */
export class HashEmbeddingProvider implements EmbeddingProvider {
  readonly id = "hash-v1";
  readonly dimensions: number;
  constructor(dimensions = 384) {
    this.dimensions = dimensions;
  }

  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((t) => this.embedOne(t));
  }

  embedOne(text: string): number[] {
    const v = new Array<number>(this.dimensions).fill(0);
    const tokens = tokenize(text);
    const add = (feature: string, weight: number) => {
      const h = fnv1a(feature);
      const idx = h % this.dimensions;
      const sign = (h >>> 31) & 1 ? -1 : 1;
      v[idx] += sign * weight;
    };
    for (let i = 0; i < tokens.length; i++) {
      add(`w:${tokens[i]}`, 1);
      if (i + 1 < tokens.length) add(`b:${tokens[i]}_${tokens[i + 1]}`, 0.6);
      const w = tokens[i];
      if (w.length >= 4) {
        for (let j = 0; j + 3 <= w.length; j++) add(`c:${w.slice(j, j + 3)}`, 0.25);
      }
    }
    return normalize(v);
  }
}

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9+#.\s-]/g, " ")
    .split(/[\s/,;:()]+/)
    .map((t) => t.replace(/^[.-]+|[.-]+$/g, ""))
    .filter((t) => t.length > 1 && !STOP.has(t));
}

const STOP = new Set(
  "a an the and or of for to in on with by is are be as at from this that it its into via your you we our their per not no".split(" "),
);

export function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}
