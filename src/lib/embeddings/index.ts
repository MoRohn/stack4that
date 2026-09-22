import { BgeEmbeddingProvider } from "./bge";
import { HashEmbeddingProvider } from "./hash";
import { RemoteEmbeddingProvider } from "./remote";
import type { EmbeddingProvider } from "./provider";
import type { Technology } from "@/lib/types";

export * from "./provider";

let provider: EmbeddingProvider | null = null;

export function getEmbeddingProvider(): EmbeddingProvider {
  if (provider) return provider;
  const kind = (process.env.EMBEDDING_PROVIDER ?? "hash").toLowerCase();
  if (kind === "openai" || kind === "remote") {
    provider = new RemoteEmbeddingProvider(
      process.env.EMBEDDING_API_URL ?? "https://api.openai.com/v1/embeddings",
      process.env.EMBEDDING_API_KEY ?? process.env.OPENAI_API_KEY,
      process.env.EMBEDDING_MODEL ?? "text-embedding-3-small",
      Number(process.env.EMBEDDING_DIMENSIONS ?? 1536),
    );
  } else if (kind === "bge") {
    provider = new BgeEmbeddingProvider();
  } else {
    provider = new HashEmbeddingProvider();
  }
  return provider;
}

export function setEmbeddingProvider(p: EmbeddingProvider | null) {
  provider = p;
}

/** The text a technology is embedded from: name, description, taxonomy and use cases. */
export function technologyEmbeddingText(t: Technology): string {
  return [
    t.name,
    t.aliases.join(" "),
    [t.companyName, t.parentCompanyName].filter(Boolean).join(" "),
    t.shortDescription,
    t.description,
    `categories: ${t.categories.join(", ")}`,
    `capabilities: ${t.capabilities.join(", ")}`,
    t.useCases.length ? `use cases: ${t.useCases.join(", ")}` : "",
    t.tags.length ? `tags: ${t.tags.join(", ")}` : "",
    t.deploymentModels.length ? `deployment: ${t.deploymentModels.join(", ")}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}
