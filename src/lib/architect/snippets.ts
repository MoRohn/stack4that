/**
 * Contextual implementation snippets. Each snippet references the generated
 * architecture (the app name, the other selected components) rather than
 * generic marketing examples.
 */
import type { Architecture, StackComponent } from "@/lib/types";

interface Ctx {
  appName: string;
  appSlug: string;
  has: (slug: string) => boolean;
  slot: (slotId: string) => StackComponent | undefined;
  language: string;
}

export function appNameFromRequest(request: string): { name: string; slug: string } {
  const words = request
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP.has(w))
    .slice(0, 3);
  const slug = words.join("-") || "my-app";
  const name = words.map((w) => w[0].toUpperCase() + w.slice(1)).join("") || "MyApp";
  return { name, slug };
}
const STOP = new Set(["build", "the", "for", "stack", "app", "application", "with", "and", "that", "need", "want", "me", "an", "a", "of", "to", "using", "based", "please", "create", "design", "make"]);

export function snippetFor(component: StackComponent, arch: Pick<Architecture, "request" | "components" | "intent">): StackComponent["snippet"] | undefined {
  const app = appNameFromRequest(arch.request);
  const ctx: Ctx = {
    appName: app.name,
    appSlug: app.slug,
    has: (slug) => arch.components.some((c) => c.slug === slug),
    slot: (id) => arch.components.find((c) => c.slotId === id),
    language: arch.intent.constraints.find((c) => c.kind === "language")?.value ?? "typescript",
  };
  const bySlug = SNIPPETS[component.slug];
  if (bySlug) return bySlug(ctx, component);
  const byCap = CAP_SNIPPETS[component.slotId];
  if (byCap) return byCap(ctx, component);
  return undefined;
}

type SnippetFn = (ctx: Ctx, c: StackComponent) => StackComponent["snippet"];
const ts = (title: string, code: string) => ({ language: "typescript", title, code });
const py = (title: string, code: string) => ({ language: "python", title, code });
const sh = (title: string, code: string) => ({ language: "bash", title, code });
const yaml = (title: string, code: string) => ({ language: "yaml", title, code });

const dbEnv = (ctx: Ctx) => {
  const db = ctx.slot("relational-db");
  return db ? `${db.name.toUpperCase().replace(/[^A-Z0-9]/g, "_")}_URL` : "DATABASE_URL";
};

const SNIPPETS: Record<string, SnippetFn> = {
  nextjs: (ctx) =>
    ts(
      `app/api/${ctx.appSlug}/route.ts`,
      `// ${ctx.appName}: Next.js route handler calling the ${ctx.slot("api-backend")?.slug === "nextjs" ? "in-process service layer" : ctx.slot("api-backend")?.name + " backend"}
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q") ?? "";
  ${ctx.slot("api-backend")?.slug === "nextjs" ? `const items = await db.query.items.findMany({ where: (t, { ilike }) => ilike(t.title, \`%\${q}%\`) });` : `const res = await fetch(\`\${process.env.API_URL}/items?q=\${encodeURIComponent(q)}\`, { next: { revalidate: 30 } });\n  const items = await res.json();`}
  return Response.json({ items });
}`,
    ),
  react: (ctx) => ts(`src/App.tsx`, `export function App() {\n  const [items, setItems] = useState([]);\n  useEffect(() => {\n    fetch(\`\${import.meta.env.VITE_API_URL}/items\`).then((r) => r.json()).then(setItems);\n  }, []);\n  return <main><h1>${ctx.appName}</h1>{items.map((i) => <Item key={i.id} {...i} />)}</main>;\n}`),
  swift: (ctx) =>
    ({ language: "swift", title: `${ctx.appName}/ItemsView.swift`, code: `struct ItemsView: View {\n    @State private var items: [Item] = []\n    var body: some View {\n        List(items) { item in Text(item.title) }\n            .task {\n                // Calls the ${ctx.slot("api-backend")?.name ?? "backend"} API\n                let url = URL(string: "https://api.${ctx.appSlug}.com/items")!\n                let (data, _) = try! await URLSession.shared.data(from: url)\n                items = try! JSONDecoder().decode([Item].self, from: data)\n            }\n    }\n}` }),
  "react-native": (ctx) => ts(`app/(tabs)/index.tsx`, `// ${ctx.appName} mobile client (Expo Router)\nexport default function Feed() {\n  const { data } = useQuery({ queryKey: ["items"], queryFn: () => fetch(\`\${process.env.EXPO_PUBLIC_API_URL}/items\`).then((r) => r.json()) });\n  return <FlatList data={data?.items} renderItem={({ item }) => <ItemCard item={item} />} />;\n}`),
  expo: (ctx) => SNIPPETS["react-native"](ctx, undefined as never),
  flutter: (ctx) => ({ language: "dart", title: "lib/main.dart", code: `Future<List<Item>> fetchItems() async {\n  // ${ctx.appName}: calls the ${ctx.slot("api-backend")?.name ?? "backend"} API\n  final res = await http.get(Uri.parse('\${const String.fromEnvironment("API_URL")}/items'));\n  return (jsonDecode(res.body)['items'] as List).map(Item.fromJson).toList();\n}` }),
  fastapi: (ctx) =>
    py(
      "app/main.py",
      `from fastapi import FastAPI\n${ctx.has("sqlalchemy") ? "from app.db import SessionLocal, Item\n" : ""}${ctx.slot("llm-inference") ? `# ${ctx.slot("llm-inference")!.name} handles inference (see its snippet)\n` : ""}\napp = FastAPI(title="${ctx.appName}")\n\n@app.get("/items")\ndef list_items(q: str = ""):\n    ${ctx.has("sqlalchemy") ? "with SessionLocal() as s:\n        return {\"items\": s.query(Item).filter(Item.title.ilike(f\"%{q}%\")).limit(50).all()}" : "return {\"items\": []}  # query " + (ctx.slot("relational-db")?.name ?? "the database")}`,
    ),
  django: (ctx) => py("items/views.py", `from django.http import JsonResponse\nfrom .models import Item\n\ndef items(request):\n    q = request.GET.get("q", "")\n    return JsonResponse({"items": list(Item.objects.filter(title__icontains=q).values()[:50])})  # ${ctx.appName}`),
  hono: (ctx) => ts("src/index.ts", `import { Hono } from "hono";\n\nconst app = new Hono();\n// ${ctx.appName} API${ctx.has("cloudflare-workers") ? " deployed to Cloudflare Workers" : ""}\napp.get("/items", async (c) => {\n  const q = c.req.query("q") ?? "";\n  const items = await listItems(q); // backed by ${ctx.slot("relational-db")?.name ?? "your database"}\n  return c.json({ items });\n});\n\nexport default app;`),
  express: (ctx) => ts("src/server.ts", `import express from "express";\n\nconst app = express();\napp.get("/items", async (req, res) => {\n  const items = await listItems(String(req.query.q ?? "")); // ${ctx.slot("relational-db")?.name ?? "database"}\n  res.json({ items });\n});\napp.listen(process.env.PORT ?? 3000, () => console.log("${ctx.appName} API ready"));`),
  nestjs: (ctx) => ts("src/items/items.controller.ts", `@Controller("items")\nexport class ItemsController {\n  constructor(private readonly items: ItemsService) {}\n  @Get()\n  list(@Query("q") q = "") {\n    return this.items.search(q); // ${ctx.appName}, backed by ${ctx.slot("relational-db")?.name ?? "the database"}\n  }\n}`),
  postgresql: (ctx) =>
    ctx.has("drizzle")
      ? ts("src/db/schema.ts", `import { pgTable, text, timestamp, uuid${ctx.has("pgvector") ? ", vector" : ""} } from "drizzle-orm/pg-core";\n\n// ${ctx.appName} core entities\nexport const users = pgTable("users", { id: uuid("id").primaryKey().defaultRandom(), email: text("email").notNull().unique(), createdAt: timestamp("created_at").defaultNow() });\nexport const items = pgTable("items", { id: uuid("id").primaryKey().defaultRandom(), ownerId: uuid("owner_id").references(() => users.id), title: text("title").notNull()${ctx.has("pgvector") ? `, embedding: vector("embedding", { dimensions: 1536 })` : ""} });`)
      : ctx.has("prisma")
        ? ({ language: "prisma", title: "prisma/schema.prisma", code: `model User {\n  id        String   @id @default(uuid())\n  email     String   @unique\n  items     Item[]\n}\n\nmodel Item {\n  id      String @id @default(uuid())\n  title   String\n  owner   User   @relation(fields: [ownerId], references: [id])\n  ownerId String\n}` })
        : ({ language: "sql", title: "migrations/001_init.sql", code: `-- ${ctx.appName} schema\nCREATE TABLE users (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text UNIQUE NOT NULL, created_at timestamptz DEFAULT now());\nCREATE TABLE items (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), owner_id uuid REFERENCES users(id), title text NOT NULL);${ctx.has("pgvector") ? "\nCREATE EXTENSION IF NOT EXISTS vector;\nALTER TABLE items ADD COLUMN embedding vector(1536);" : ""}` }),
  supabase: (ctx) => ts("src/lib/supabase.ts", `import { createClient } from "@supabase/supabase-js";\n\nexport const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);\n\n// ${ctx.appName}: Postgres + auth + storage from one client\nexport async function listItems(q: string) {\n  const { data } = await supabase.from("items").select("*").ilike("title", \`%\${q}%\`).limit(50);\n  return data ?? [];\n}`),
  neon: (ctx) => ts("src/db/index.ts", `import { neon } from "@neondatabase/serverless";\n${ctx.has("drizzle") ? `import { drizzle } from "drizzle-orm/neon-http";\n` : ""}\nconst sql = neon(process.env.DATABASE_URL!); // Neon serverless Postgres for ${ctx.appName}\n${ctx.has("drizzle") ? "export const db = drizzle(sql);" : "export { sql };"}`),
  redis: (ctx) => ts("src/lib/cache.ts", `import Redis from "ioredis";\nconst redis = new Redis(process.env.REDIS_URL!);\n\n// ${ctx.appName}: cache expensive reads from ${ctx.slot("relational-db")?.name ?? "the database"}\nexport async function cached<T>(key: string, ttl: number, load: () => Promise<T>): Promise<T> {\n  const hit = await redis.get(key);\n  if (hit) return JSON.parse(hit);\n  const value = await load();\n  await redis.set(key, JSON.stringify(value), "EX", ttl);\n  return value;\n}`),
  upstash: (ctx) => ts("src/lib/cache.ts", `import { Redis } from "@upstash/redis";\nconst redis = Redis.fromEnv(); // UPSTASH_REDIS_REST_URL / TOKEN\n\n// ${ctx.appName}: edge-friendly caching and rate limits\nexport const cached = async <T>(key: string, ttl: number, load: () => Promise<T>) =>\n  (await redis.get<T>(key)) ?? (async () => { const v = await load(); await redis.set(key, v, { ex: ttl }); return v; })();`),
  pgvector: (ctx) => ({ language: "sql", title: "search.sql", code: `-- ${ctx.appName}: semantic search inside ${ctx.slot("relational-db")?.name ?? "Postgres"}\nCREATE INDEX ON items USING hnsw (embedding vector_cosine_ops);\nSELECT id, title, 1 - (embedding <=> $1::vector) AS similarity\nFROM items ORDER BY embedding <=> $1::vector LIMIT 10;` }),
  pinecone: (ctx) => ts("src/lib/vectors.ts", `import { Pinecone } from "@pinecone-database/pinecone";\nconst index = new Pinecone().index("${ctx.appSlug}");\n\nexport async function similar(vector: number[]) {\n  const res = await index.query({ vector, topK: 10, includeMetadata: true });\n  return res.matches;\n}`),
  qdrant: (ctx) => py("app/vectors.py", `from qdrant_client import QdrantClient\nclient = QdrantClient(url=os.environ.get("QDRANT_URL", "http://localhost:6333"))\n\n# ${ctx.appName}: similarity search\ndef similar(vector: list[float], k: int = 10):\n    return client.search(collection_name="items", query_vector=vector, limit=k)`),
  chroma: (ctx) => py("app/vectors.py", `import chromadb\nclient = chromadb.PersistentClient(path="./data/chroma")  # local, no server for ${ctx.appName}\ncollection = client.get_or_create_collection("items")\n\ndef similar(query_embedding, k=10):\n    return collection.query(query_embeddings=[query_embedding], n_results=k)`),
  lancedb: (ctx) => py("app/vectors.py", `import lancedb\ndb = lancedb.connect("./data/lancedb")  # embedded vector store for ${ctx.appName}\ntable = db.open_table("items")\n\ndef similar(vector, k=10):\n    return table.search(vector).limit(k).to_list()`),
  openai: (ctx) =>
    ctx.language === "python"
      ? py("app/ai.py", `from openai import OpenAI\nclient = OpenAI()\n\ndef summarize(text: str) -> str:\n    # ${ctx.appName}: summaries via OpenAI\n    res = client.responses.create(model="gpt-5-mini", input=f"Summarize in 3 bullets:\\n{text}")\n    return res.output_text`)
      : ts("src/lib/ai.ts", `import OpenAI from "openai";\nconst openai = new OpenAI();\n\nexport async function summarize(text: string) {\n  const res = await openai.responses.create({ model: "gpt-5-mini", input: \`Summarize in 3 bullets:\\n\${text}\` });\n  return res.output_text; // ${ctx.appName}\n}`),
  anthropic: (ctx) =>
    ctx.language === "python"
      ? py("app/ai.py", `import anthropic\nclient = anthropic.Anthropic()\n\ndef summarize(text: str) -> str:\n    # ${ctx.appName}: summaries via Claude\n    msg = client.messages.create(model="claude-sonnet-5", max_tokens=400, messages=[{"role": "user", "content": f"Summarize in 3 bullets:\\n{text}"}])\n    return msg.content[0].text`)
      : ts("src/lib/ai.ts", `import Anthropic from "@anthropic-ai/sdk";\nconst client = new Anthropic();\n\nexport async function summarize(text: string) {\n  const msg = await client.messages.create({ model: "claude-sonnet-5", max_tokens: 400, messages: [{ role: "user", content: \`Summarize in 3 bullets:\\n\${text}\` }] });\n  return msg.content[0].type === "text" ? msg.content[0].text : ""; // ${ctx.appName}\n}`),
  "google-gemini": (ctx) => ts("src/lib/ai.ts", `import { GoogleGenAI } from "@google/genai";\nconst ai = new GoogleGenAI({});\n\nexport async function summarize(text: string) {\n  const res = await ai.models.generateContent({ model: "gemini-2.5-flash", contents: \`Summarize in 3 bullets:\\n\${text}\` });\n  return res.text; // ${ctx.appName}\n}`),
  ollama: (ctx) => sh("local inference", `# ${ctx.appName}: run models locally (uses NVIDIA GPU automatically)\nollama pull llama3.1\nollama pull nomic-embed-text\n# OpenAI-compatible endpoint at http://localhost:11434/v1\ncurl http://localhost:11434/v1/chat/completions -d '{"model":"llama3.1","messages":[{"role":"user","content":"Summarize: ..."}]}'`),
  vllm: (ctx) => sh("serve with vLLM", `# ${ctx.appName}: production serving on NVIDIA GPUs\npip install vllm\nvllm serve meta-llama/Llama-3.1-8B-Instruct --dtype auto --max-model-len 8192\n# OpenAI-compatible server on http://localhost:8000/v1`),
  "sentence-transformers": (ctx) => py("app/embeddings.py", `from sentence_transformers import SentenceTransformer\nmodel = SentenceTransformer("BAAI/bge-small-en-v1.5")  # runs locally for ${ctx.appName}\n\ndef embed(texts: list[str]):\n    return model.encode(texts, normalize_embeddings=True).tolist()`),
  "vercel-ai-sdk": (ctx) => ts("app/api/chat/route.ts", `import { streamText } from "ai";\n${ctx.has("anthropic") ? `import { anthropic } from "@ai-sdk/anthropic";` : `import { openai } from "@ai-sdk/openai";`}\n\nexport async function POST(req: Request) {\n  const { messages } = await req.json();\n  const result = streamText({ model: ${ctx.has("anthropic") ? `anthropic("claude-sonnet-5")` : `openai("gpt-5-mini")`}, messages }); // ${ctx.appName}\n  return result.toUIMessageStreamResponse();\n}`),
  langchain: (ctx) => py("app/rag.py", `from langchain_core.prompts import ChatPromptTemplate\n${ctx.has("pgvector") ? "from langchain_postgres import PGVector as Store" : ctx.has("qdrant") ? "from langchain_qdrant import QdrantVectorStore as Store" : "from langchain_chroma import Chroma as Store"}\n\n# ${ctx.appName}: retrieval-augmented answer\nretriever = store.as_retriever(search_kwargs={"k": 6})\nprompt = ChatPromptTemplate.from_template("Answer using only the context.\\n{context}\\nQuestion: {question}")\nchain = {"context": retriever, "question": lambda x: x} | prompt | llm`),
  llamaindex: (ctx) => py("app/rag.py", `from llama_index.core import VectorStoreIndex, SimpleDirectoryReader\n\n# ${ctx.appName}: index documents and query them\ndocs = SimpleDirectoryReader("./data").load_data()\nindex = VectorStoreIndex.from_documents(docs)\nanswer = index.as_query_engine().query("What changed this week?")`),
  bullmq: (ctx) => ts("src/jobs/ingest.ts", `import { Queue, Worker } from "bullmq";\nconst connection = { url: process.env.REDIS_URL! };\n\nexport const ingestQueue = new Queue("ingest", { connection }); // ${ctx.appName}\nnew Worker("ingest", async (job) => {\n  await processItem(job.data.itemId); // e.g. call ${ctx.slot("llm-inference")?.name ?? "the model"} and store results\n}, { connection, concurrency: 8 });`),
  celery: (ctx) => py("app/tasks.py", `from celery import Celery\napp = Celery("${ctx.appSlug}", broker=os.environ["REDIS_URL"])\n\n@app.task(bind=True, max_retries=3)\ndef process_item(self, item_id: str):\n    # ${ctx.appName}: background processing (e.g. summarize with ${ctx.slot("llm-inference")?.name ?? "the model"})\n    ...\n\napp.conf.beat_schedule = {"ingest-hourly": {"task": "app.tasks.ingest", "schedule": 3600}}`),
  inngest: (ctx) => ts("src/inngest/functions.ts", `import { inngest } from "./client";\n\nexport const processItem = inngest.createFunction(\n  { id: "process-item", concurrency: 10 },\n  { event: "${ctx.appSlug}/item.created" },\n  async ({ event, step }) => {\n    const text = await step.run("fetch", () => fetchItem(event.data.id));\n    const summary = await step.run("summarize", () => summarize(text)); // ${ctx.slot("llm-inference")?.name ?? "model"}\n    await step.run("save", () => saveSummary(event.data.id, summary));\n  },\n);`),
  "trigger-dev": (ctx) => ts("src/trigger/process.ts", `import { task } from "@trigger.dev/sdk/v3";\n\nexport const processItem = task({\n  id: "process-item",\n  retry: { maxAttempts: 3 },\n  run: async ({ id }: { id: string }) => {\n    const text = await fetchItem(id);\n    return summarize(text); // ${ctx.appName}\n  },\n});`),
  temporal: (ctx) => ts("src/workflows.ts", `import { proxyActivities } from "@temporalio/workflow";\nconst { fetchItem, summarize, save } = proxyActivities<typeof activities>({ startToCloseTimeout: "5 minutes", retry: { maximumAttempts: 5 } });\n\nexport async function processItem(id: string) {\n  const text = await fetchItem(id);\n  await save(id, await summarize(text)); // ${ctx.appName}: durable, resumable\n}`),
  modal: (ctx) => py("pipeline.py", `import modal\napp = modal.App("${ctx.appSlug}")\nimage = modal.Image.debian_slim().pip_install("torch", "transformers")\n\n@app.function(gpu="A10G", image=image, timeout=1800)\ndef generate(prompt: str):\n    # ${ctx.appName}: GPU job on Modal\n    ...\n\n@app.function(schedule=modal.Cron("0 * * * *"))\ndef hourly_ingest():\n    ...`),
  "cron-jobs": (ctx) => (ctx.has("vercel") ? ({ language: "json", title: "vercel.json", code: `{\n  "crons": [{ "path": "/api/jobs/ingest", "schedule": "0 * * * *" }]\n}` }) : yaml("k8s/cronjob.yaml", `apiVersion: batch/v1\nkind: CronJob\nmetadata: { name: ${ctx.appSlug}-ingest }\nspec:\n  schedule: "0 * * * *"\n  jobTemplate:\n    spec:\n      template:\n        spec:\n          containers: [{ name: ingest, image: ghcr.io/you/${ctx.appSlug}:latest, args: ["ingest"] }]\n          restartPolicy: OnFailure`)),
  vercel: (ctx) => sh("deploy", `# ${ctx.appName}: preview deploys on every PR, production on main\nnpm i -g vercel\nvercel link\nvercel env add ${dbEnv(ctx)}\nvercel --prod`),
  "cloudflare-workers": (ctx) => ({ language: "toml", title: "wrangler.toml", code: `name = "${ctx.appSlug}"\nmain = "src/index.ts"\ncompatibility_date = "2026-09-01"\n${ctx.has("cloudflare-r2") ? `[[r2_buckets]]\nbinding = "MEDIA"\nbucket_name = "${ctx.appSlug}-media"\n` : ""}[triggers]\ncrons = ["0 * * * *"]` }),
  railway: (ctx) => ({ language: "toml", title: "railway.toml", code: `[build]\nbuilder = "nixpacks"\n\n[deploy]\nstartCommand = "${ctx.language === "python" ? "uvicorn app.main:app --host 0.0.0.0 --port $PORT" : "npm run start"}"\nhealthcheckPath = "/health"\n# ${ctx.appName}: add ${ctx.slot("relational-db")?.name ?? "Postgres"} and ${ctx.slot("cache")?.name ?? "Redis"} as Railway services` }),
  render: (ctx) => yaml("render.yaml", `services:\n  - type: web\n    name: ${ctx.appSlug}-api\n    runtime: ${ctx.language === "python" ? "python" : "node"}\n    startCommand: ${ctx.language === "python" ? "uvicorn app.main:app --host 0.0.0.0 --port $PORT" : "npm start"}\n  - type: worker\n    name: ${ctx.appSlug}-worker\n    runtime: ${ctx.language === "python" ? "python" : "node"}\n    startCommand: ${ctx.language === "python" ? "celery -A app.tasks worker" : "node dist/worker.js"}\ndatabases:\n  - name: ${ctx.appSlug}-db`),
  "fly-io": (ctx) => ({ language: "toml", title: "fly.toml", code: `app = "${ctx.appSlug}"\nprimary_region = "iad"\n\n[http_service]\n  internal_port = ${ctx.language === "python" ? 8000 : 3000}\n  auto_stop_machines = true\n  min_machines_running = 1` }),
  aws: (ctx) => (ctx.has("aws-cdk") ? ts("infra/stack.ts", `// ${ctx.appName} on AWS with CDK\nconst vpc = new ec2.Vpc(this, "Vpc");\nconst db = new rds.DatabaseInstance(this, "Db", { engine: rds.DatabaseInstanceEngine.POSTGRES, vpc });\nconst service = new ecsPatterns.ApplicationLoadBalancedFargateService(this, "Api", { vpc, taskImageOptions: { image: ecs.ContainerImage.fromAsset(".") } });`) : ({ language: "hcl", title: "infra/main.tf", code: `# ${ctx.appName} on AWS\nresource "aws_db_instance" "main" {\n  engine         = "postgres"\n  instance_class = "db.t4g.small"\n  allocated_storage = 20\n}\n\nmodule "api" {\n  source = "terraform-aws-modules/ecs/aws"\n  # Fargate service for the ${ctx.slot("api-backend")?.name ?? "API"}\n}` })),
  "google-cloud": (ctx) => sh("deploy to Cloud Run", `# ${ctx.appName} on Google Cloud\ngcloud run deploy ${ctx.appSlug}-api --source . --region us-central1 --allow-unauthenticated \\\n  --set-env-vars ${dbEnv(ctx)}=$${dbEnv(ctx)}`),
  kubernetes: (ctx) => yaml("k8s/api.yaml", `apiVersion: apps/v1\nkind: Deployment\nmetadata: { name: ${ctx.appSlug}-api }\nspec:\n  replicas: 2\n  selector: { matchLabels: { app: ${ctx.appSlug}-api } }\n  template:\n    metadata: { labels: { app: ${ctx.appSlug}-api } }\n    spec:\n      containers:\n        - name: api\n          image: ghcr.io/you/${ctx.appSlug}:latest\n          envFrom: [{ secretRef: { name: ${ctx.appSlug}-secrets } }]`),
  terraform: (ctx) => ({ language: "hcl", title: "infra/main.tf", code: `terraform {\n  required_providers { ${ctx.has("aws") ? 'aws = { source = "hashicorp/aws" }' : ctx.has("google-cloud") ? 'google = { source = "hashicorp/google" }' : 'cloudflare = { source = "cloudflare/cloudflare" }'} }\n}\n\n# ${ctx.appName}: environments as code\nmodule "prod" { source = "./modules/app"; env = "prod" }` }),
  github: (ctx) => yaml(".github/workflows/ci.yml", `name: CI\non: [push, pull_request]\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n      ${ctx.language === "python" ? "- uses: astral-sh/setup-uv@v5\n      - run: uv sync && uv run pytest" : "- uses: actions/setup-node@v4\n        with: { node-version: 22 }\n      - run: npm ci && npm test && npm run build"}\n  # ${ctx.appName}: deploy to ${ctx.slot("hosting")?.name ?? "hosting"} on main`),
  sentry: (ctx) => ts("src/instrumentation.ts", `import * as Sentry from "@sentry/${ctx.has("nextjs") ? "nextjs" : "node"}";\n\nSentry.init({\n  dsn: process.env.SENTRY_DSN,\n  tracesSampleRate: 0.2,\n  environment: process.env.NODE_ENV, // ${ctx.appName}\n});`),
  stripe: (ctx) => ts("app/api/checkout/route.ts", `import Stripe from "stripe";\nconst stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);\n\nexport async function POST() {\n  const session = await stripe.checkout.sessions.create({\n    mode: "subscription",\n    line_items: [{ price: process.env.STRIPE_PRICE_PRO!, quantity: 1 }],\n    success_url: "https://${ctx.appSlug}.com/welcome",\n    cancel_url: "https://${ctx.appSlug}.com/pricing",\n  });\n  return Response.json({ url: session.url });\n}`),
  clerk: (ctx) => ts("proxy.ts", `import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";\nconst isProtected = createRouteMatcher(["/app(.*)"]);\n\nexport default clerkMiddleware(async (auth, req) => {\n  if (isProtected(req)) await auth.protect(); // ${ctx.appName}\n});`),
  "auth-js": (ctx) => ts("auth.ts", `import NextAuth from "next-auth";\nimport GitHub from "next-auth/providers/github";\n${ctx.has("drizzle") ? 'import { DrizzleAdapter } from "@auth/drizzle-adapter";\nimport { db } from "@/db";\n' : ""}\nexport const { handlers, auth } = NextAuth({\n  ${ctx.has("drizzle") ? "adapter: DrizzleAdapter(db),\n  " : ""}providers: [GitHub], // ${ctx.appName}\n});`),
  "better-auth": (ctx) => ts("src/lib/auth.ts", `import { betterAuth } from "better-auth";\n${ctx.has("drizzle") ? 'import { drizzleAdapter } from "better-auth/adapters/drizzle";\nimport { db } from "@/db";\n' : ""}\nexport const auth = betterAuth({\n  ${ctx.has("drizzle") ? 'database: drizzleAdapter(db, { provider: "pg" }),\n  ' : ""}emailAndPassword: { enabled: true }, // ${ctx.appName}\n});`),
  "supabase-auth": (ctx) => ts("src/lib/auth.ts", `import { createServerClient } from "@supabase/ssr";\n\n// ${ctx.appName}: session from Supabase Auth cookies\nexport async function currentUser() {\n  const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { cookies });\n  const { data } = await supabase.auth.getUser();\n  return data.user;\n}`),
  "amazon-s3": (ctx) => ts("src/lib/storage.ts", `import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";\nconst s3 = new S3Client({});\n\nexport async function upload(key: string, body: Buffer, contentType: string) {\n  await s3.send(new PutObjectCommand({ Bucket: "${ctx.appSlug}-media", Key: key, Body: body, ContentType: contentType }));\n  return \`https://${ctx.appSlug}-media.s3.amazonaws.com/\${key}\`;\n}`),
  "cloudflare-r2": (ctx) => ts("src/lib/storage.ts", `// R2 is S3-compatible: reuse the AWS SDK with the R2 endpoint (zero egress for ${ctx.appName})\nimport { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";\nconst r2 = new S3Client({ region: "auto", endpoint: \`https://\${process.env.CF_ACCOUNT_ID}.r2.cloudflarestorage.com\` });\nexport const upload = (key: string, body: Buffer) => r2.send(new PutObjectCommand({ Bucket: "${ctx.appSlug}-media", Key: key, Body: body }));`),
  resend: (ctx) => ts("src/lib/email.ts", `import { Resend } from "resend";\nconst resend = new Resend(process.env.RESEND_API_KEY);\n\nexport const sendWelcome = (to: string) =>\n  resend.emails.send({ from: "${ctx.appName} <hello@${ctx.appSlug}.com>", to, subject: "Welcome to ${ctx.appName}", html: "<p>Thanks for signing up.</p>" });`),
  posthog: (ctx) => ts("src/lib/analytics.ts", `import posthog from "posthog-js";\nposthog.init(process.env.NEXT_PUBLIC_POSTHOG_KEY!, { api_host: "/ingest" }); // ${ctx.appName}\nexport const track = (event: string, props?: Record<string, unknown>) => posthog.capture(event, props);`),
  firecrawl: (ctx) => ts("src/lib/crawl.ts", `import FirecrawlApp from "@mendable/firecrawl-js";\nconst firecrawl = new FirecrawlApp({ apiKey: process.env.FIRECRAWL_API_KEY });\n\n// ${ctx.appName}: turn a source page into clean markdown for ${ctx.slot("llm-inference")?.name ?? "the model"}\nexport const scrape = (url: string) => firecrawl.scrapeUrl(url, { formats: ["markdown"] });`),
  tavily: (ctx) => ts("src/lib/search.ts", `import { tavily } from "@tavily/core";\nconst client = tavily({ apiKey: process.env.TAVILY_API_KEY });\nexport const searchNews = (q: string) => client.search(q, { topic: "news", maxResults: 20 }); // ${ctx.appName}`),
  playwright: (ctx) => ts("src/lib/browser.ts", `import { chromium } from "playwright";\nexport async function capture(url: string) {\n  const browser = await chromium.launch();\n  const page = await browser.newPage();\n  await page.goto(url, { waitUntil: "networkidle" });\n  const text = await page.innerText("body"); // ${ctx.appName}\n  await browser.close();\n  return text;\n}`),
  ffmpeg: (ctx) => sh("transcode", `# ${ctx.appName}: normalize generated clips before upload to ${ctx.slot("object-storage")?.name ?? "storage"}\nffmpeg -i input.mp4 -c:v libx264 -preset fast -crf 22 -c:a aac -movflags +faststart output.mp4`),
  replicate: (ctx) => ts("src/lib/video.ts", `import Replicate from "replicate";\nconst replicate = new Replicate();\n\nexport async function generateClip(prompt: string) {\n  const output = await replicate.run("minimax/video-01", { input: { prompt } }); // ${ctx.appName}\n  return output;\n}`),
  "fal-ai": (ctx) => ts("src/lib/video.ts", `import { fal } from "@fal-ai/client";\n\nexport async function generateClip(prompt: string) {\n  const result = await fal.subscribe("fal-ai/minimax-video", { input: { prompt } }); // ${ctx.appName}\n  return result.data.video.url;\n}`),
  mux: (ctx) => ts("src/lib/video.ts", `import Mux from "@mux/mux-node";\nconst mux = new Mux();\nexport const ingest = (url: string) => mux.video.assets.create({ input: [{ url }], playback_policy: ["public"] }); // ${ctx.appName}`),
  deepgram: (ctx) => ts("src/lib/speech.ts", `import { createClient } from "@deepgram/sdk";\nconst deepgram = createClient(process.env.DEEPGRAM_API_KEY);\nexport const transcribe = (url: string) => deepgram.listen.prerecorded.transcribeUrl({ url }, { model: "nova-3", smart_format: true }); // ${ctx.appName}`),
  "typesafe-ai": (ctx) => ts("src/lib/decisions.ts", `import { TypeSafeClient, choice, noul } from "@typesafe-ai/sdk";\nconst client = new TypeSafeClient();\n\n// ${ctx.appName}: typed, calibrated judgments instead of parsing LLM prose\nexport async function triage(text: string) {\n  const res = await client.systemOne({ state: { text }, questions: { urgent: noul("Does \`text\` convey urgency?"), topic: choice("What is \`text\` about?", { billing: null, technical: null, other: null }) } });\n  return res.answers;\n}`),
  drizzle: (ctx) => SNIPPETS.postgresql(ctx, undefined as never),
  prisma: (ctx) => SNIPPETS.postgresql(ctx, undefined as never),
  sqlalchemy: (ctx) => py("app/db.py", `from sqlalchemy import create_engine, String\nfrom sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, sessionmaker\n\nengine = create_engine(os.environ["DATABASE_URL"])  # ${ctx.slot("relational-db")?.name ?? "Postgres"}\nSessionLocal = sessionmaker(engine)\n\nclass Base(DeclarativeBase): ...\n\nclass Item(Base):\n    __tablename__ = "items"\n    id: Mapped[str] = mapped_column(primary_key=True)\n    title: Mapped[str] = mapped_column(String(200))  # ${ctx.appName}`),
};

const CAP_SNIPPETS: Record<string, SnippetFn> = {
  hosting: (ctx, c) => sh("deploy", `# ${ctx.appName}: deploy to ${c.name}\n# See ${c.name} docs for the CLI; typical flow:\n#   1. build the ${ctx.slot("api-backend")?.name ?? "app"} container\n#   2. push to the registry\n#   3. create a service with ${dbEnv(ctx)} set`),
  "llm-inference": (ctx, c) => ts("src/lib/ai.ts", `// ${ctx.appName}: call ${c.name} through its SDK; keep the API key server-side\nexport async function summarize(text: string) {\n  const res = await fetch(process.env.${c.slug.toUpperCase().replace(/-/g, "_")}_URL!, { method: "POST", headers: { authorization: \`Bearer \${process.env.${c.slug.toUpperCase().replace(/-/g, "_")}_API_KEY}\` }, body: JSON.stringify({ input: text }) });\n  return res.json();\n}`),
  embeddings: (ctx, c) => ts("src/lib/embeddings.ts", `// ${ctx.appName}: embed content with ${c.name}, store vectors in ${ctx.slot("vector-db")?.name ?? "the vector store"}\nexport async function embed(texts: string[]): Promise<number[][]> {\n  // provider-specific SDK call goes here\n  return [];\n}`),
  "vector-db": (ctx, c) => ts("src/lib/vectors.ts", `// ${ctx.appName}: upsert and query embeddings in ${c.name}\nexport async function similar(vector: number[], k = 10) {\n  // ${c.name} client query; see its docs\n  return [];\n}`),
  queue: (ctx, c) => ts("src/jobs/queue.ts", `// ${ctx.appName}: enqueue work for the ${ctx.slot("workers")?.name ?? "worker"} via ${c.name}\nexport async function enqueue(job: { type: string; payload: unknown }) {\n  // publish to ${c.name}\n}`),
  workers: (ctx, c) => ts("src/jobs/worker.ts", `// ${ctx.appName}: background processing on ${c.name}\nexport async function handle(job: { type: string; payload: unknown }) {\n  // e.g. summarize with ${ctx.slot("llm-inference")?.name ?? "the model"} and persist to ${ctx.slot("relational-db")?.name ?? "the database"}\n}`),
  authentication: (ctx, c) => ts("src/lib/auth.ts", `// ${ctx.appName}: sessions via ${c.name}\nexport async function currentUser(req: Request) {\n  // verify the ${c.name} session token and load the user\n  return null;\n}`),
  monitoring: (ctx, c) => ts("src/instrumentation.ts", `// ${ctx.appName}: initialize ${c.name} before the app starts\n// send errors, traces and logs from the ${ctx.slot("api-backend")?.name ?? "backend"}`),
  "object-storage": (ctx, c) => ts("src/lib/storage.ts", `// ${ctx.appName}: upload media to ${c.name}\nexport async function upload(key: string, body: Buffer, contentType: string): Promise<string> {\n  // ${c.name} SDK call\n  return \`https://cdn.${ctx.appSlug}.com/\${key}\`;\n}`),
  "ci-cd": (ctx, c) => yaml("ci.yml", `# ${ctx.appName}: build, test and deploy with ${c.name}\nstages: [test, deploy]`),
  payments: (ctx, c) => ts("src/lib/billing.ts", `// ${ctx.appName}: checkout and subscriptions via ${c.name}`),
  email: (ctx, c) => ts("src/lib/email.ts", `// ${ctx.appName}: transactional email via ${c.name}`),
  realtime: (ctx, c) => ts("src/lib/realtime.ts", `// ${ctx.appName}: push live updates to clients via ${c.name}`),
  cache: (ctx, c) => ts("src/lib/cache.ts", `// ${ctx.appName}: cache hot reads from ${ctx.slot("relational-db")?.name ?? "the database"} in ${c.name}`),
  "relational-db": (ctx, c) => ({ language: "sql", title: "schema.sql", code: `-- ${ctx.appName} on ${c.name}\nCREATE TABLE users (id uuid PRIMARY KEY, email text UNIQUE NOT NULL);\nCREATE TABLE items (id uuid PRIMARY KEY, owner_id uuid REFERENCES users(id), title text NOT NULL);` }),
};
