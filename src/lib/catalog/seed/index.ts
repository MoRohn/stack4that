import { AI } from "./ai";
import { BACKEND } from "./backend";
import { DATA } from "./data";
import { FRONTEND } from "./frontend";
import { INFRA } from "./infra";
import { INGESTION } from "./ingestion";
import type { SeedTechnology } from "./helper";

export const SEED: SeedTechnology[] = [...FRONTEND, ...BACKEND, ...DATA, ...AI, ...INFRA, ...INGESTION];
