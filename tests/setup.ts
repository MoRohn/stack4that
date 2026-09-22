import { beforeAll } from "vitest";
import { useInMemoryDb } from "@/lib/db/client";

beforeAll(async () => {
  process.env.DATABASE_URL = "file::memory:";
  await useInMemoryDb();
});
