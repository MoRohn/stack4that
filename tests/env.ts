import fs from "node:fs";
import path from "node:path";
import { loadEnvConfig } from "@next/env";

// Tests use the app's environment. Next skips .env.local under NODE_ENV=test, so read it explicitly.
// TypeSafe is required: there is no offline mode.
loadEnvConfig(process.cwd());
const local = path.join(process.cwd(), ".env.local");
if (fs.existsSync(local)) {
  for (const line of fs.readFileSync(local, "utf8").split("\n")) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m && !process.env[m[1]] && m[2]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
