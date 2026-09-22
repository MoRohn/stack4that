/**
 * Core domain types for Stack4That.
 *
 * Everything the UI, the decision engine, the retrieval layer and the
 * intelligence pipeline share lives here. Keep this file dependency-free.
 */

// ---------------------------------------------------------------------------
// Technology knowledge base
// ---------------------------------------------------------------------------

export type TechnologyType =
  | "platform"
  | "service"
  | "framework"
  | "library"
  | "database"
  | "language"
  | "runtime"
  | "tool"
  | "model"
  | "api"
  | "infrastructure"
  | "protocol";

export type DeploymentModel =
  | "managed-cloud"
  | "self-hosted"
  | "serverless"
  | "edge"
  | "on-device"
  | "desktop"
  | "hybrid";

export type PricingModel =
  | "free"
  | "open-source"
  | "freemium"
  | "usage-based"
  | "subscription"
  | "seat-based"
  | "enterprise"
  | "unknown";

export type Maturity = "experimental" | "emerging" | "growing" | "established" | "legacy" | "unknown";

export type LifecycleStatus =
  | "active"
  | "beta"
  | "deprecated"
  | "sunset"
  | "acquired"
  | "renamed"
  | "unknown";

export type VerificationStatus = "verified" | "seeded" | "candidate" | "unverified" | "disputed";

export type SourceType =
  | "official-website"
  | "official-docs"
  | "official-repository"
  | "official-pricing"
  | "official-changelog"
  | "official-api"
  | "yc-oss"
  | "github"
  | "npm"
  | "pypi"
  | "cncf"
  | "cloud-marketplace"
  | "directory"
  | "publication"
  | "launch"
  | "wikidata"
  | "apache"
  | "dockerhub"
  | "crates"
  | "curated-seed"
  | "simple-icons"
  | "typesafe-classification";

export type ClaimType =
  | "existence"
  | "website"
  | "description"
  | "category"
  | "capability"
  | "license"
  | "open-source"
  | "repository"
  | "repository-stars"
  | "repository-activity"
  | "pricing"
  | "free-tier"
  | "deployment-model"
  | "integration"
  | "compliance"
  | "status"
  | "company"
  | "logo"
  | "package"
  | "region"
  | "language-support";

export interface Evidence {
  id: string;
  technologyId: string;
  sourceUrl: string;
  sourceType: SourceType;
  retrievedAt: string;
  claimType: ClaimType;
  extractedValue: string;
  confidence: number;
}

export interface SourceRecord {
  id: string;
  technologyId: string;
  sourceType: SourceType;
  sourceUrl: string;
  externalId?: string;
  retrievedAt: string;
  payload: Record<string, unknown>;
}

export interface Technology {
  id: string;
  slug: string;
  name: string;
  aliases: string[];
  companyId?: string;
  companyName?: string;
  /** The conglomerate above the company, when known (e.g. Google → Alphabet, Red Hat → IBM). */
  parentCompanyName?: string;

  type: TechnologyType;
  categories: string[];
  subcategories: string[];
  capabilities: string[];
  useCases: string[];
  tags: string[];

  description: string;
  shortDescription: string;

  websiteUrl?: string;
  documentationUrl?: string;
  repositoryUrl?: string;
  pricingUrl?: string;

  logoUrl?: string;
  logoAssetId?: string;
  brandColor?: string;

  openSource?: boolean;
  license?: string;
  repositoryStars?: number;
  repositoryActivity?: string; // ISO date of last push, when known

  deploymentModels: DeploymentModel[];
  supportedClouds: string[];
  supportedLanguages: string[];
  supportedFrameworks: string[];
  integrations: string[]; // slugs of other technologies

  pricingModel: PricingModel;
  freeTier?: boolean;
  pricingSummary?: string;

  maturity: Maturity;
  status: LifecycleStatus;

  regions: string[];
  compliance: string[];

  semanticEmbedding?: number[];
  embeddingProvider?: string;

  sourceRecords: SourceRecord[];
  evidence: Evidence[];

  firstSeenAt: string;
  lastVerifiedAt?: string;
  lastUpdatedAt: string;

  confidence: number;
  verificationStatus: VerificationStatus;
}

export interface TechnologyChange {
  id: string;
  technologyId: string;
  field: string;
  previousValue: string | null;
  newValue: string | null;
  detectedAt: string;
  source: string;
  confidence: number;
  changeKind:
    | "new-technology"
    | "renamed"
    | "acquisition"
    | "shutdown"
    | "deprecated"
    | "pricing"
    | "license"
    | "capability"
    | "repository-inactivity"
    | "integration"
    | "deployment-model"
    | "field";
}

export interface Company {
  id: string;
  slug: string;
  name: string;
  websiteUrl?: string;
  ycBatch?: string;
  ycTags?: string[];
}

/** A lightweight projection used by the physics universe. */
export interface UniverseTech {
  id: string;
  slug: string;
  name: string;
  color: string;
  iconPath?: string; // simple-icons 24x24 path
  /** Website domain, used for a favicon fallback when no brand icon exists. */
  domain?: string;
  categories: string[];
  monogram: string;
}

// ---------------------------------------------------------------------------
// Intent, constraints, requirements
// ---------------------------------------------------------------------------

export type ConstraintKind =
  | "budget"
  | "team-size"
  | "traffic"
  | "latency"
  | "geography"
  | "data-residency"
  | "compliance"
  | "open-source"
  | "cloud"
  | "existing-technology"
  | "language"
  | "developer-experience"
  | "mobile"
  | "web"
  | "ai"
  | "gpu"
  | "vendor-lock-in"
  | "time-to-market"
  | "operational-complexity"
  | "self-hosting"
  | "realtime"
  | "availability"
  | "hosting-model";

export interface Constraint {
  id: string;
  kind: ConstraintKind;
  /** Human readable, e.g. "Budget: minimal (bootstrapped)". */
  label: string;
  /** Machine value, e.g. "minimal" | "aws" | "typescript". */
  value: string;
  severity: "hard" | "soft";
  /** How sure we are that the user actually meant this. */
  confidence: number;
  source: "explicit" | "implicit";
}

export interface TechnologyMention {
  technologyId: string;
  name: string;
  role: "existing-keep" | "replace-target" | "avoid" | "preferred" | "incidental";
  confidence: number;
  /** Primary architecture slot this technology fills, when it has one. */
  capability?: string;
}

export type RequestKind = "new-stack" | "replace-component" | "modify-existing" | "question" | "unclear";

/** A primary objective, kept in the user's own words and traced to the block that serves it. */
export interface Objective {
  text: string;
  /** Which thread turn it came from (0 = the first request). */
  turn: number;
  /** Probability TypeSafe gave that this clause states a real objective. */
  confidence: number;
  /** The capability TypeSafe judged most essential to deliver it (a slot id), if any. */
  capability?: string;
  capabilityLabel?: string;
  /** What kind of objective: a capability to deliver, the product as a whole, or a constraint to respect. */
  kind: "capability" | "product" | "constraint";
  /** Filled in once the stack is built. */
  servedBy?: { slotId: string; technologyId: string; name: string };
}

export interface ThreadTurn {
  request: string;
  brief?: string;
  architectureId?: string;
  createdAt: string;
}

export interface ContextSuggestion {
  label: string;
  /** Text appended to the input when chosen. */
  text: string;
  kind: "unknown" | "feature" | "direction";
}

export interface RequestInterpretation {
  original: string;
  /** Every turn's words, oldest first (the current request is last). */
  context: string[];
  objectives: Objective[];
  /** Explicit brief composed from TypeSafe's judgments; drives every downstream decision. */
  enhancedRequest: string;
  archetype: string;
  archetypeLabel: string;
  archetypeConfidence: number;
  /** True when the request said little, so the archetype's typical capabilities were added. */
  vague: boolean;
  addedCapabilities: string[];
  route: "new-stack" | "replace-component" | "modify-existing" | "reference-stack";
}

export interface IntentAnalysis {
  request: string;
  requestKind: RequestKind;
  summary: string;
  productKind: string;
  needs: Record<string, number>; // capability -> probability that it is needed
  constraints: Constraint[];
  unknowns: string[];
  assumptions: string[];
  mentions: TechnologyMention[];
  /** How the request was understood and improved; every request is accepted. */
  interpretation: RequestInterpretation;
  engine: "typesafe";
  model?: string;
}

export type ArchitectureGroup =
  | "EXPERIENCE"
  | "API"
  | "DATA"
  | "AI"
  | "INGESTION"
  | "INFRASTRUCTURE";

export interface Requirement {
  id: string; // slot id, e.g. "relational-db"
  group: ArchitectureGroup;
  label: string;
  capability: string;
  description: string; // request-specific description
  required: boolean;
  probability: number;
  dependsOn: string[];
  queryText: string;
  categories: string[];
}

export interface RequirementGraph {
  requirements: Requirement[];
  edges: Array<{ from: string; to: string; relation: string }>;
}

// ---------------------------------------------------------------------------
// Decision engine
// ---------------------------------------------------------------------------

export type CriterionId =
  | "functional-fit"
  | "constraint-satisfaction"
  | "integration-fit"
  | "developer-experience"
  | "maturity"
  | "operational-complexity"
  | "scalability"
  | "performance"
  | "cost"
  | "ecosystem"
  | "documentation"
  | "security"
  | "deployment-flexibility"
  | "vendor-lock-in"
  | "open-source"
  | "maintenance"
  | "time-to-market";

export interface Criterion {
  id: CriterionId;
  label: string;
  weight: number; // 0..1, derived per request
  rationale: string;
}

export type DecisionType =
  | "select-candidate"
  | "compare-candidates"
  | "suitability"
  | "requires-component"
  | "compatibility"
  | "replacement"
  | "constraint-evaluation"
  | "architecture-validation";

export interface CandidateSummary {
  id: string;
  slug: string;
  name: string;
  shortDescription: string;
  type: TechnologyType;
  categories: string[];
  capabilities: string[];
  openSource?: boolean;
  license?: string;
  deploymentModels: DeploymentModel[];
  supportedClouds: string[];
  supportedLanguages: string[];
  integrations: string[];
  pricingModel: PricingModel;
  freeTier?: boolean;
  pricingSummary?: string;
  maturity: Maturity;
  status: LifecycleStatus;
  compliance: string[];
  retrievalScore: number;
  retrievalReasons: string[];
}

export interface ProjectContext {
  request: string;
  summary: string;
  productKind: string;
  hardConstraints: string[];
  softPreferences: string[];
  assumptions: string[];
  /** The user's primary objectives, verbatim. Every decision must serve them. */
  objectives: string[];
  primaryLanguage?: string;
  cloudPreference?: string;
  hostingModel?: string;
  /** Slugs already chosen in other slots, used for integration fit. */
  selectedSoFar: Array<{ slot: string; name: string; slug: string }>;
}

export interface DecisionRequest {
  decisionType: DecisionType;
  requirement: Requirement;
  projectContext: ProjectContext;
  constraints: Constraint[];
  candidates: CandidateSummary[];
  criteria: Criterion[];
}

export interface CriterionResult {
  candidateId: string;
  criterionId: CriterionId;
  score: number; // 0..1 normalized
  confidence: number;
  levelLabel: string;
}

export interface CandidateVerdict {
  candidateId: string;
  selectionProbability: number;
  functionalFit: number;
  hardConstraintViolation: number;
  unnecessaryComplexity: number;
  compositeScore: number;
  eliminated: boolean;
  eliminationReason?: string;
}

export interface DecisionResult {
  decisionType: DecisionType;
  requirementId: string;
  selectedCandidateIds: string[];
  rejectedCandidateIds: string[];
  confidence: number;
  criteriaResults: CriterionResult[];
  verdicts: CandidateVerdict[];
  explanationInputs: {
    strongestCriteria: CriterionId[];
    weakestCriterion?: CriterionId;
    decisiveConstraints: string[];
  };
  decisionMetadata: {
    engine: "typesafe";
    model?: string;
    inputTokens?: number;
    outputTokens?: number;
    latencyMs: number;
    questionCount: number;
    noneSuitableProbability: number;
  };
}

// ---------------------------------------------------------------------------
// Final architecture
// ---------------------------------------------------------------------------

export interface Alternative {
  technologyId: string;
  slug: string;
  name: string;
  whyNot: string;
  whenPreferable: string;
  compositeScore: number;
}

export interface StackComponent {
  slotId: string;
  group: ArchitectureGroup;
  slotLabel: string;
  role: string;
  technologyId: string;
  slug: string;
  name: string;
  color: string;
  iconPath?: string;
  domain?: string;
  monogram: string;
  whyHere: string;
  tradeoff: string;
  alternatives: Alternative[];
  confidence: number;
  criteriaResults: CriterionResult[];
  decisionMetadata: DecisionResult["decisionMetadata"];
  sources: Array<{ url: string; type: SourceType; claim: ClaimType }>;
  snippet?: { language: string; title: string; code: string };
  optional: boolean;
  /** Other slots this same technology covers (merged into this block). */
  coveredSlots: Array<{ slotId: string; label: string }>;
}

export interface StackIssue {
  id: string;
  severity: "info" | "warning" | "error";
  kind:
    | "duplicate-capability"
    | "incompatible"
    | "unnecessary"
    | "missing-layer"
    | "vendor-conflict"
    | "deployment-incompatible"
    | "language-incompatible"
    | "excessive-complexity"
    | "budget-contradiction"
    | "compliance-contradiction"
    | "regional-availability"
    | "operational-burden";
  message: string;
  slotIds: string[];
  resolution?: string;
}

export interface Architecture {
  id: string;
  createdAt: string;
  request: string;
  intent: IntentAnalysis;
  requirementGraph: RequirementGraph;
  criteria: Criterion[];
  components: StackComponent[];
  edges: Array<{ from: string; to: string; relation: string }>;
  issues: StackIssue[];
  assumptions: string[];
  /** The conversation this stack belongs to; each follow-up adds a turn. */
  thread: { id: string; turns: ThreadTurn[] };
  /** Ways to add context for the next turn. */
  suggestions: ContextSuggestion[];
  stats: {
    technologiesSearched: number;
    candidatesConsidered: number;
    decisions: number;
    typesafeCalls: number;
    inputTokens: number;
    durationMs: number;
    engine: "typesafe";
  };
}
