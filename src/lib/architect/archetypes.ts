/**
 * Product archetypes: the vocabulary TypeSafe selects from to turn any request,
 * however short or vague, into an explicit brief. TypeSafe only chooses; the
 * brief is composed in code from the chosen archetype plus what the request
 * itself says, so nothing is invented beyond these curated defaults.
 */
export interface Archetype {
  id: string;
  /** Choice criterion shown to TypeSafe. */
  criterion: string;
  /** Noun phrase used in the brief, e.g. "task-management (to-do) application". */
  noun: string;
  /** Who it is for, used when the request does not say. */
  audience: string;
  /** Core capabilities (slot ids) a typical product of this kind needs. */
  capabilities: string[];
  /** Short feature phrases for the brief. */
  features: string[];
}

const A = (id: string, criterion: string, noun: string, audience: string, capabilities: string[], features: string[]): Archetype => ({ id, criterion, noun, audience, capabilities, features });

export const ARCHETYPES: Archetype[] = [
  A("todo_productivity", "To-do lists, task tracking, notes, habit trackers or personal productivity apps", "task-management (to-do) application", "individuals and small teams", ["web-frontend", "api-backend", "authentication", "relational-db"], ["user accounts", "lists and tasks with due dates", "sync across devices"]),
  A("project_management", "Project management, kanban boards, issue trackers or team collaboration workspaces", "project-management workspace", "teams", ["web-frontend", "api-backend", "authentication", "authorization", "relational-db", "realtime", "email"], ["workspaces and roles", "boards and issues", "live updates", "email notifications"]),
  A("chat_messaging", "Chat, messaging, team communication or community discussion apps", "real-time chat application", "teams and communities", ["web-frontend", "api-backend", "authentication", "relational-db", "realtime", "object-storage", "notifications"], ["real-time messaging", "channels and direct messages", "file sharing", "notifications"]),
  A("social_network", "Social networks, feeds, followers, creator or community platforms", "social network", "consumers", ["web-frontend", "api-backend", "authentication", "relational-db", "object-storage", "cache", "notifications", "realtime"], ["profiles and follows", "a personalized feed", "media uploads", "notifications"]),
  A("ecommerce_store", "Online stores, shops, product catalogs and checkout", "online store", "shoppers", ["web-frontend", "api-backend", "ecommerce", "payments", "search-engine", "email", "object-storage"], ["product catalog and search", "cart and checkout", "order emails"]),
  A("marketplace", "Two-sided marketplaces connecting buyers and sellers, hosts and guests, or providers and clients", "two-sided marketplace", "buyers and sellers", ["web-frontend", "api-backend", "authentication", "relational-db", "payments", "search-engine", "object-storage", "email"], ["listings and search", "payments and payouts", "messaging between parties"]),
  A("saas_b2b", "B2B SaaS products with accounts, teams, subscriptions and dashboards", "B2B SaaS product", "business customers", ["web-frontend", "api-backend", "authentication", "authorization", "relational-db", "payments", "email", "analytics"], ["organizations and roles", "subscription billing", "a customer dashboard"]),
  A("internal_tool", "Internal tools, admin panels, back-office dashboards or CRUD apps for a company", "internal admin tool", "employees", ["web-frontend", "api-backend", "authentication", "authorization", "relational-db"], ["single sign-on", "role-based access", "data tables and forms"]),
  A("content_site", "Blogs, marketing sites, documentation, portfolios or content publishing", "content website", "readers", ["web-frontend", "cms", "hosting", "analytics"], ["editor-managed content", "fast static pages", "SEO and analytics"]),
  A("landing_page", "A landing page, waitlist or simple marketing page", "landing page with a waitlist", "visitors", ["web-frontend", "hosting", "email", "analytics"], ["a signup form", "confirmation emails", "conversion analytics"]),
  A("ai_assistant", "AI assistants, chatbots, copilots or conversational AI products", "AI assistant", "end users", ["web-frontend", "api-backend", "authentication", "relational-db", "llm-inference", "ai-orchestration", "ai-evaluation"], ["streaming chat", "conversation history", "tool use"]),
  A("rag_knowledge", "Search or question answering over documents, knowledge bases, RAG", "document question-answering (RAG) application", "knowledge workers", ["web-frontend", "api-backend", "authentication", "relational-db", "object-storage", "vector-db", "embeddings", "llm-inference", "ocr-documents", "workers"], ["document upload and parsing", "semantic search", "cited answers"]),
  A("ai_agents", "Autonomous AI agents, agentic workflows or AI automation", "autonomous AI agent platform", "operators", ["api-backend", "llm-inference", "ai-orchestration", "workers", "queue", "web-search-api", "ai-evaluation", "relational-db"], ["multi-step agent runs", "tool calling", "durable execution", "observability"]),
  A("media_generation", "Image, video or audio generation, editing or media pipelines", "generative media pipeline", "creators", ["api-backend", "video-generation", "image-generation", "workers", "queue", "object-storage", "cdn"], ["generation jobs", "media storage and delivery", "progress tracking"]),
  A("video_streaming", "Video streaming, live streaming, courses or media platforms", "video streaming platform", "viewers", ["web-frontend", "api-backend", "authentication", "video-generation", "object-storage", "cdn", "payments"], ["upload and transcoding", "adaptive streaming", "subscriptions"]),
  A("education", "Learning platforms, courses, tutoring, schools or LMS", "online learning platform", "students and instructors", ["web-frontend", "api-backend", "authentication", "relational-db", "video-generation", "payments", "email"], ["courses and lessons", "progress tracking", "payments"]),
  A("booking_scheduling", "Booking, reservations, appointments or scheduling", "booking and scheduling application", "customers and businesses", ["web-frontend", "api-backend", "authentication", "relational-db", "payments", "email", "notifications"], ["availability calendars", "bookings and payments", "reminders"]),
  A("crm_sales", "CRM, sales pipelines, customer support or helpdesk tools", "CRM", "sales and support teams", ["web-frontend", "api-backend", "authentication", "authorization", "relational-db", "search-engine", "email"], ["contacts and deals", "search", "email integration"]),
  A("fintech", "Banking, payments, trading, budgeting, wallets or financial services", "financial application", "customers", ["web-frontend", "api-backend", "authentication", "authorization", "relational-db", "payments", "monitoring", "compliance-automation"], ["secure accounts", "transactions ledger", "audit trails"]),
  A("healthcare", "Healthcare, telehealth, patient portals, clinics or medical records", "healthcare application", "patients and clinicians", ["web-frontend", "api-backend", "authentication", "authorization", "relational-db", "compliance-automation", "email"], ["patient records", "appointments", "compliance controls"]),
  A("analytics_platform", "Analytics, BI, dashboards over large data, data platforms or pipelines", "analytics data platform", "analysts", ["api-backend", "data-warehouse", "etl", "scheduler", "web-frontend"], ["data ingestion", "transformations", "dashboards"]),
  A("api_product", "A developer-facing API, SDK or platform sold to other developers", "developer API product", "developers", ["api-backend", "api-gateway", "authentication", "relational-db", "payments", "monitoring"], ["API keys and rate limits", "usage-based billing", "documentation"]),
  A("mobile_app", "A mobile app for iOS and Android without a more specific product type", "mobile application", "mobile users", ["cross-platform-mobile", "api-backend", "authentication", "relational-db", "notifications"], ["native mobile experience", "user accounts", "push notifications"]),
  A("game", "Games, multiplayer experiences or leaderboards", "multiplayer game backend", "players", ["api-backend", "authentication", "realtime", "cache", "relational-db"], ["real-time sessions", "leaderboards", "player accounts"]),
  A("iot", "IoT, connected devices, sensors, fleets or telemetry", "IoT telemetry platform", "device operators", ["api-backend", "streaming", "data-warehouse", "web-frontend", "monitoring"], ["device ingestion", "time-series storage", "live dashboards"]),
  A("scraping_monitoring", "Web scraping, price or news monitoring, crawlers or data collection", "web data collection pipeline", "analysts", ["web-search-api", "browser-automation", "scheduler", "workers", "relational-db", "object-storage"], ["scheduled crawling", "extraction", "change alerts"]),
  A("news_media", "News, content aggregation, newsletters or publishing with feeds", "news and content aggregation app", "readers", ["web-frontend", "api-backend", "web-search-api", "scheduler", "workers", "search-engine", "llm-inference"], ["source ingestion", "summaries", "personalized feeds"]),
  A("developer_tool", "Developer tools, CLIs, IDE extensions or devops tooling", "developer tool", "developers", ["api-backend", "authentication", "relational-db", "ci-cd"], ["accounts and API tokens", "usage analytics", "CI integration"]),
  A("general_web_app", "A general web application; use when the request does not describe a specific product or is just a greeting or a word", "general-purpose web application starter", "a small team getting started", ["web-frontend", "api-backend", "authentication", "relational-db", "hosting"], ["user accounts", "a relational database", "managed hosting"]),
];

export const ARCHETYPE_BY_ID = new Map(ARCHETYPES.map((a) => [a.id, a]));
