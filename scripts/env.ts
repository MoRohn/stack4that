/**
 * Load the same environment the app uses (.env, .env.local) for CLI scripts.
 * Import this first in every script: tsx does not load Next's env files.
 */
import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd(), process.env.NODE_ENV !== "production");
