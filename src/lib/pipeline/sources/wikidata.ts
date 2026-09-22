/**
 * Wikidata: the global, multilingual knowledge graph. Two query families:
 *  1. Software developed or owned by large technology companies (captures products that live
 *     inside conglomerates: Cloud Bigtable → Google → Alphabet, DynamoDB → Amazon).
 *  2. Instances of developer-technology classes (databases, frameworks, brokers, ML frameworks…).
 * Each query is small so it stays well under the public endpoint's 60 s limit; failures are skipped.
 */
import { fetchWithTimeout } from "../http";

const ENDPOINT = "https://query.wikidata.org/sparql";

export interface WikidataItem {
  qid: string;
  name: string;
  description?: string;
  website: string;
  sitelinks: number;
  /** Ranking signal: popularity, weighted by how much the description reads like stack technology. */
  score: number;
  company?: string;
  parentCompany?: string;
  /** Canonical category hints from the class it was found under. */
  categories: string[];
  via: string;
}

/** Large technology companies (verified QIDs). */
export const WIKIDATA_COMPANIES: Array<{ qid: string; name: string; parent?: string }> = [
  { qid: "Q456157", name: "Amazon Web Services", parent: "Amazon" },
  { qid: "Q3884", name: "Amazon" },
  { qid: "Q95", name: "Google", parent: "Alphabet" },
  { qid: "Q2283", name: "Microsoft" },
  { qid: "Q380", name: "Meta" },
  { qid: "Q37156", name: "IBM" },
  { qid: "Q19900", name: "Oracle" },
  { qid: "Q1359568", name: "Alibaba Group" },
  { qid: "Q860580", name: "Tencent" },
  { qid: "Q941127", name: "Salesforce" },
  { qid: "Q11463", name: "Adobe" },
  { qid: "Q552581", name: "SAP" },
  { qid: "Q182477", name: "NVIDIA" },
  { qid: "Q14772", name: "Baidu" },
  { qid: "Q160120", name: "Huawei" },
  { qid: "Q4778915", name: "Cloudflare" },
  { qid: "Q485593", name: "Red Hat", parent: "IBM" },
  { qid: "Q55606242", name: "ByteDance" },
  { qid: "Q173395", name: "Cisco" },
  { qid: "Q248", name: "Intel" },
  { qid: "Q757307", name: "Atlassian" },
  { qid: "Q11407", name: "VMware", parent: "Broadcom" },
  { qid: "Q5281", name: "Yandex" },
  { qid: "Q18350420", name: "Databricks" },
];

/** Developer-technology classes (verified QIDs) with the canonical categories they imply. */
export const WIKIDATA_CLASSES: Array<{ qid: string; label: string; categories: string[] }> = [
  { qid: "Q3932296", label: "relational DBMS", categories: ["sql-databases", "databases"] },
  { qid: "Q82231", label: "NoSQL DBMS", categories: ["nosql-databases", "databases"] },
  { qid: "Q176165", label: "DBMS", categories: ["databases"] },
  { qid: "Q20706915", label: "key-value database", categories: ["nosql-databases", "caching"] },
  { qid: "Q7805429", label: "time series database", categories: ["databases"] },
  { qid: "Q595971", label: "graph database", categories: ["nosql-databases"] },
  { qid: "Q1330336", label: "web framework", categories: ["backend-frameworks", "frontend-frameworks"] },
  { qid: "Q271680", label: "software framework", categories: ["developer-tools"] },
  { qid: "Q783866", label: "JavaScript library", categories: ["frontend-frameworks"] },
  { qid: "Q6821765", label: "message broker", categories: ["queues", "streaming"] },
  { qid: "Q7935198", label: "container orchestration", categories: ["kubernetes", "containers"] },
  { qid: "Q21169670", label: "machine learning framework", categories: ["ml-platforms", "ai-infrastructure"] },
  { qid: "Q115305900", label: "large language model", categories: ["ai-models"] },
  { qid: "Q131093", label: "content management system", categories: ["cms"] },
  { qid: "Q13741", label: "IDE", categories: ["developer-tools"] },
];

/** Consumer products (search, video, social apps) are skipped; TypeSafe re-checks what remains. */
const TECH_WORDS = /\b(service|platform|database|framework|library|api|sdk|cloud|engine|runtime|language|toolkit|tool|software|storage|compute|serverless|machine learning|artificial intelligence|\bai\b|model|analytics|queue|messaging|broker|server|container|kubernetes|orchestration|infrastructure|devops|integration|pipeline|search engine for developers|data warehouse|cdn|dns|identity|authentication|monitoring|observability|compiler|operating system|virtualization|hosting)\b/i;
/** Words that make an item likely to be a component of a technology stack. */
const STACK_SIGNALS = /\b(service|platform|database|data warehouse|framework|library|api|sdk|cloud|engine|runtime|storage|compute|serverless|queue|messaging|broker|analytics|observability|monitoring|orchestration|container|kubernetes|cdn|identity|authentication|managed|hosting|pipeline|streaming|machine learning|inference)\b/gi;
/** Interesting, but rarely the thing a stack is built from. */
const LOW_VALUE = /\b(programming language|operating system|web browser|font|video game|markup language|file format|protocol|standard|specification|encyclopedia)\b/i;

const CONSUMER_WORDS = /\b(video-sharing|social network|search engine by|web browser|smartphone|mobile phone|video game|television|music streaming|messaging app|instant messaging|contact tracing|e-book|email client for consumers)\b/i;

async function sparql(query: string, timeoutMs = 45000): Promise<Array<Record<string, { value: string }>>> {
  const res = await fetchWithTimeout(`${ENDPOINT}?query=${encodeURIComponent(query)}`, { headers: { accept: "application/sparql-results+json" } }, timeoutMs);
  if (!res.ok) throw new Error(`Wikidata ${res.status}`);
  const json = (await res.json()) as { results: { bindings: Array<Record<string, { value: string }>> } };
  return json.results.bindings;
}

function toItems(rows: Array<Record<string, { value: string }>>, via: string, categories: string[], companyFallback?: { name: string; parent?: string }): WikidataItem[] {
  const byId = new Map<string, WikidataItem>();
  for (const r of rows) {
    const qid = r.item.value.split("/").pop()!;
    if (byId.has(qid)) continue;
    const desc = r.desc?.value ?? "";
    const links = Number(r.links?.value ?? 0);
    const signals = (desc.match(STACK_SIGNALS) ?? []).length;
    byId.set(qid, {
      qid,
      name: r.label.value,
      description: r.desc?.value,
      website: r.website.value,
      sitelinks: links,
      score: links + signals * 30 - (LOW_VALUE.test(desc) ? 60 : 0),
      company: r.devLabel?.value ?? companyFallback?.name,
      parentCompany: r.parentLabel?.value ?? companyFallback?.parent,
      categories,
      via,
    });
  }
  return [...byId.values()];
}

export async function fetchWikidataCompanyProducts(companies = WIKIDATA_COMPANIES, perCompany = 80): Promise<WikidataItem[]> {
  const out: WikidataItem[] = [];
  for (const c of companies) {
    const q = `SELECT ?item ?label ?desc ?website ?links WHERE {
      { ?item wdt:P178 wd:${c.qid} } UNION { ?item wdt:P127 wd:${c.qid} }
      ?item wdt:P856 ?website ; wikibase:sitelinks ?links .
      ?item rdfs:label ?label FILTER(LANG(?label) = "en")
      OPTIONAL { ?item schema:description ?desc FILTER(LANG(?desc) = "en") }
    } ORDER BY DESC(?links) LIMIT ${perCompany * 2}`;
    try {
      const items = toItems(await sparql(q), `wikidata:${c.name}`, [], { name: c.name, parent: c.parent });
      out.push(...items.filter((i) => i.description && TECH_WORDS.test(i.description) && !CONSUMER_WORDS.test(i.description)).sort((a, b) => b.score - a.score).slice(0, perCompany));
    } catch {
      /* one slow company must not fail the run */
    }
  }
  return out;
}

export async function fetchWikidataClassMembers(classes = WIKIDATA_CLASSES, perClass = 80): Promise<WikidataItem[]> {
  const out: WikidataItem[] = [];
  for (const cls of classes) {
    const q = `SELECT ?item ?label ?desc ?website ?links ?devLabel ?parentLabel WHERE {
      ?item wdt:P31 wd:${cls.qid} ; wdt:P856 ?website ; wikibase:sitelinks ?links .
      FILTER(?links >= 4)
      ?item rdfs:label ?label FILTER(LANG(?label) = "en")
      OPTIONAL { ?item schema:description ?desc FILTER(LANG(?desc) = "en") }
      OPTIONAL { ?item wdt:P178 ?dev . ?dev rdfs:label ?devLabel FILTER(LANG(?devLabel) = "en")
        OPTIONAL { ?dev wdt:P749 ?parent . ?parent rdfs:label ?parentLabel FILTER(LANG(?parentLabel) = "en") } }
    } ORDER BY DESC(?links) LIMIT ${perClass * 2}`;
    try {
      out.push(...toItems(await sparql(q), `wikidata:${cls.label}`, cls.categories).sort((a, b) => b.score - a.score).slice(0, perClass));
    } catch {
      /* skip classes that time out */
    }
  }
  return out;
}
