# Stack4That

Describe what you are building. Watch the stack assemble.

Stack4That is an AI-powered technology discovery and architecture application. It keeps a continuously refreshed knowledge base of technologies (frameworks, databases, AI systems, cloud services, SaaS, libraries) and turns a plain-language request such as *"Build the stack for a real-time AI news application"* into a coherent architecture that is physically assembled on screen from technology logo blocks.

```
USER REQUEST → INTENT + CONSTRAINT EXTRACTION → ARCHITECTURE REQUIREMENT GRAPH
→ HYBRID TECHNOLOGY RETRIEVAL → CANDIDATE SETS → TYPESAFE DECISION ENGINE
→ COMPATIBILITY / CONSTRAINT VALIDATION → STACK OPTIMIZATION → FINAL ARCHITECTURE
→ STREAMING VISUAL ASSEMBLY → EXPLANATIONS + IMPLEMENTATION SNIPPETS
```

## Run it

```bash
cp .env.example .env.local      # add TYPESAFE_API_KEY (required)
npm install && npm link         # installs the `stack4that` command
stack4that start                # builds if needed, starts in the background, opens http://stack4that:3333
```

The first `stack4that start` offers to make `http://stack4that:3333` resolve on this machine (one `/etc/hosts` line, asks for your password). You can also run `stack4that setup` any time; until then the app is served at `http://localhost:3333`.

| Command | What it does |
| --- | --- |
| `stack4that start` | Build if the code changed, start in the background, open the browser (`--no-open` to skip). If it is already running, it just opens it. |
| `stack4that stop` / `restart` | Stop or restart the background server. |
| `stack4that status` | Running or not, TypeSafe key, hostname, catalog size. |
| `stack4that open` / `logs` | Open the app, or follow the server log (`.stack4that/server.log`). |
| `stack4that dev` | Development server with hot reload in the foreground; stops the background server first. |
| `stack4that setup` | Add `stack4that` to `/etc/hosts`. |
| `stack4that refresh` | Run the pipeline now (`--mode full|refresh|discover`, `--limit N`, `--sources wikidata,apache,…`). You can also run it from the Pipeline page, with live progress. |

`STACK4THAT_PORT` changes the port (default 3333). If another program holds the port, the command names it instead of failing with `EADDRINUSE`.

Useful commands:

| Command | What it does |
| --- | --- |
| `npm run architect -- "Build a cheap stack for a two-person startup"` | Run the architect from the CLI and print the stack, decisions and issues (`VERBOSE=1` for explanations). |
| `npm run pipeline -- --mode full --limit 40` | Run the technology intelligence pipeline once (`refresh`, `discover` or `full`). |
| `npm run pipeline:watch` | Run the pipeline every 24 hours in-process. |
| `npm test` | Unit and integration tests. Decision tests call TypeSafe for real (the key is read from `.env.local`). |
| `npm run smoke -- http://stack4that:3333` | End-to-end smoke test against a running server (SSE stream, swap, persistence, pages). |
| `npm run eval` | Decision-quality evaluation: ~20 realistic requests (HIPAA SaaS, local RAG on NVIDIA, AWS fintech, Kafka on Kubernetes, voice agents, …) with expectations a senior architect would hold. Uses live TypeSafe. `ONLY=name` filters, `JSON=1` for machine output. |
| `npm run e2e -- http://stack4that:3333 screenshots` | Browser end-to-end suite in real Chrome with ~40 assertions: progressive assembly timing, frame rate, layout (no overlaps, below the header), detail panel, keyboard access, Escape, share/export, swap, refinement, short and vague requests ("todo app") being interpreted and built, Edit brief, refresh keeping the stack, error + retry, shared-link replay, reduced motion, tablet and mobile, catalog and pipeline pages, zero console errors. |
| `npm run a11y -- http://stack4that:3333` | Accessibility audit with axe-core over the home screen (idle and built), the detail panel, /catalog, /pipeline and mobile. Fails on any serious or critical violation. |
| `npm run audit` | Catalog data-quality audit: duplicate names and aliases, utility-library noise, missing descriptions or licences, sibling products sharing one vendor URL. Fails on blocking issues. |
| `npx tsx scripts/prune-utilities.ts [--dry-run]` | Retire catalog entries that are dependencies rather than architectural choices (SDKs, middleware, language bindings). Moves them to the `sunset` status and records the reason; nothing is deleted. |
| `npm run visual -- http://stack4that:3333 screenshots` | Screenshot walkthrough of the main flows. |
| `npm run build && npm start` | Production build. |

## How it works

### Two experiences

* **Discover**: the home screen is a physics-driven universe of technology blocks (Matter.js on a single canvas; React never mounts a component per block). Typing in the command bar glows matching blocks; clicking a block opens its knowledge-base record with evidence and change history. `/catalog` browses the whole knowledge base.
* **Build**: submit a request and the server streams events over SSE. Candidate blocks light up in the pile while retrieval runs, then chosen blocks launch out of the pile and fall into their architecture group (EXPERIENCE, API, DATA, AI, INGESTION, INFRASTRUCTURE). Once settled, relationships are drawn between blocks. Click a block for *why it's here*, the decision it won, tradeoffs, calibrated confidence, sources and a contextual implementation snippet. "Use instead" swaps in an alternative and re-evaluates dependent components. Follow-up requests ("make it open source", "use AWS instead") refine the existing stack.

### Decision architecture (`src/lib/architect`)

1. **Intent** (`intent.ts`): one TypeSafe request with ~70 questions over the raw request: a Noul per architecture capability ("does this product need vector retrieval?"), Choices for budget, scale, team size, hosting, cloud, language, open-source stance, time to market, data residency, and Choices for the role of every catalog technology mentioned in the text (keep / replace / avoid / preferred). Constraints are split into **hard** (must satisfy), **soft** (optimize) and **unknown** (assumption stated, never fabricated). **Every request is accepted:** TypeSafe also picks the closest product archetype (to-do app, marketplace, RAG app, … or a general web-app starter), and code composes an explicit brief from the archetype, surfaces, features and constraints. Short or vague requests ("todo app", "hello") borrow the archetype's typical capabilities; specific requests are kept as stated. The brief drives every downstream decision and is shown in the UI, where "Edit brief" lets you refine it. Request kinds are routed: new stack, replace a component, modify an existing stack, or a reference stack for questions.
2. **Requirement graph** (`requirements.ts`): capabilities become slots with request-specific descriptions and dependency edges; code resolves conflicts (one cross-platform mobile slot instead of iOS+Android, local inference instead of hosted APIs for local-first requests, no CDN slot when the host bundles one, …).
3. **Retrieval** (`src/lib/retrieval`): hybrid scoring per slot over the catalog: taxonomy/capability match (hard gate), BM25, semantic similarity, hard-constraint filtering with soft-preference bonuses, maturity, adoption, evidence freshness, source confidence and integration fit with already-selected components. Returns 10-30 candidates. Retrieval never decides.
4. **TypeSafeDecisionEngine** (`src/lib/typesafe/engine.ts`): for each slot, one request with the request, project context and the candidate shortlist as state; a Choice over candidate IDs (+ `none_suitable`), per-candidate Nouls for functional fit, hard-constraint violation and unnecessary complexity, and per-candidate Scores on the top criteria derived from the request. Criteria weights (`criteria.ts`) are contextual: "cheap MVP" weighs cost and speed, "HIPAA SaaS" weighs security and maturity, "local-first AI" weighs deployment flexibility and open source. No universal 0-100 score exists. Responses are normalized into `DecisionResult` objects; the UI never sees raw TypeSafe payloads. Candidate IDs always originate from the catalog, so TypeSafe cannot hallucinate technologies.
5. **Stack optimizer** (`optimizer.ts`): code checks duplicate capabilities, same technology in two slots (merged into one block), two backend platforms, cloud vendor conflicts, language/runtime mismatches, deployment and open-source contradictions, compliance gaps and budget contradictions; TypeSafe judges whether each optional slot is genuinely needed, whether overlapping pairs are redundant and whether pairs are compatible, and how oversized the stack is. Offending slots are re-decided with the offender excluded. The smallest coherent architecture wins.
6. **Explanations and snippets** (`explain.ts`, `snippets.ts`): generated from the structured decision (criteria results, constraints satisfied, integration edges, alternatives that beat the winner on some dimension). Snippets reference the actual architecture (the app name, the chosen database, model provider, hosting).

Every stage streams events (`analysis.started`, `requirements.extracted`, `requirement.created`, `retrieval.started`, `candidate.found`, `decision.started`, `decision.completed`, `technology.selected`, `technology.rejected`, `stack.slot.covered`, `stack.component.ready`, `stack.component.removed`, `stack.validation.*`, `stack.completed`) so the visual assembly starts as soon as the first decision completes.

### Knowledge base (`src/lib/catalog`, `src/lib/db`)

`Technology` is the canonical entity (companies own many technologies). Every record carries categories from the extensible taxonomy (`src/lib/taxonomy.ts`), capabilities, deployment models, languages, integrations, pricing model, maturity, lifecycle status, compliance, `Evidence` rows with source URL/type/claim/confidence and `SourceRecord` provenance. The curated seed (~330 technologies) is loaded on first start into libSQL (SQLite file locally, Turso in production). Nothing is ever deleted; lifecycle state changes and every tracked field change is appended to `technology_changes`.

### Technology intelligence pipeline (`src/lib/pipeline`)

`DISCOVER → FETCH → NORMALIZE → DEDUPLICATE → CLASSIFY → VALIDATE → ENRICH → EMBED → UPSERT → AUDIT`, scheduled daily (`vercel.json` cron → `/api/pipeline/run`, `npm run pipeline:watch`, or `PIPELINE_INPROCESS_SCHEDULE=1`).

* **Refresh** re-verifies existing technologies against Tier 1 sources: the official website (existence, title/description, shutdown/rename/acquisition signals judged by TypeSafe) and the official repository (stars, activity, license, archived state). Consecutive 404s and archived repositories change lifecycle status instead of deleting.
* **Discover** pulls candidates from nine global sources: **Wikidata** (software developed or owned by large technology companies, which captures products inside conglomerates such as Cloud Bigtable → Google → Alphabet, plus instances of technology classes like databases, frameworks and message brokers), the **Apache Software Foundation** catalog, the **CNCF landscape**, **Docker Hub official images**, the **yc-oss** company dataset, **GitHub** search, **npm**, top **PyPI** packages and **crates.io** categories. Candidates are ranked within each source by its own popularity signal and interleaved so every batch is diverse. Dedupe is product-aware (`aws.amazon.com/dynamodb` is not `aws.amazon.com`) and alias-aware (`mongo` ~ MongoDB, `kafka` ~ Apache Kafka). A source that fails or times out is logged and skipped; the run continues. Candidates are normalized, deduplicated and validated with TypeSafe: is it a stack technology, is it developer-facing, is it a low-level utility dependency rather than something a team chooses, is it active, does the website match, what type and category is it, then which capabilities it provides. Company and parent-company relationships are stored with provenance. Accepted candidates become verified technologies with evidence for every claim; uncertain ones are held; rejections are recorded with reasons. `/pipeline` shows runs, changes and candidates.
* **Embeddings** are behind an interface: hash embeddings by default (no downloads), any OpenAI-compatible endpoint, or local BGE-small via `@huggingface/transformers`.

## Hardening

* Build endpoints are rate limited per client (`ARCHITECT_RATE_LIMIT`, default 20/min per instance) and cap body size.
* Swaps prefer the server's saved architecture; a client-supplied architecture is never persisted, and every rendered link is restricted to http(s).
* Security headers are set globally; heavy JSON endpoints are gzip-compressed and memoized.
* Favicons for technologies without a brand icon go through `/api/favicon`, a validated, caching proxy, so the browser never calls third parties.
* The curated seed is versioned: when it changes, curated fields are merged into existing rows while pipeline-verified facts (stars, activity, verification status, lifecycle) and all evidence are preserved.

## Deploy

Vercel: set `TYPESAFE_API_KEY`, `CRON_SECRET`, and a libSQL database (`DATABASE_URL=libsql://…`, `DATABASE_AUTH_TOKEN`) since the filesystem is read-only; the cron in `vercel.json` runs the pipeline nightly. Any Node host works with the default SQLite file plus `PIPELINE_INPROCESS_SCHEDULE=1`.
