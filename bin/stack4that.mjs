#!/usr/bin/env node
/**
 * stack4that — the Stack4That command.
 *
 *   stack4that start      build if needed, start in the background, open http://stack4that:3333
 *   stack4that stop       stop the background server
 *   stack4that restart    stop, then start
 *   stack4that status     is it running, is TypeSafe configured, does the hostname resolve
 *   stack4that open       open the app in the browser
 *   stack4that logs       follow the server log
 *   stack4that dev        development server in the foreground (hot reload)
 *   stack4that setup      make http://stack4that:3333 resolve on this machine (asks for your password once)
 *   stack4that refresh    run the technology intelligence pipeline now
 */
import { spawn, spawnSync, execFileSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import readline from "node:readline";
import { lookup } from "node:dns/promises";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fs.realpathSync(fileURLToPath(import.meta.url))), "..");
const HOST = "stack4that";
const PORT = Number(process.env.STACK4THAT_PORT ?? 3333);
const STATE_DIR = path.join(ROOT, ".stack4that");
const PID_FILE = path.join(STATE_DIR, "server.pid");
const LOG_FILE = path.join(STATE_DIR, "server.log");
const NEXT_BIN = path.join(ROOT, "node_modules", "next", "dist", "bin", "next");

const tty = process.stdout.isTTY;
const c = (code) => (s) => (tty ? `\x1b[${code}m${s}\x1b[0m` : String(s));
const bold = c(1), dim = c(2), green = c(32), yellow = c(33), red = c(31), cyan = c(36);
const say = (s = "") => console.log(s);
const ok = (s) => say(`  ${green("✓")} ${s}`);
const warn = (s) => say(`  ${yellow("!")} ${s}`);
const fail = (s) => say(`  ${red("✗")} ${s}`);
const brand = () => say(`\n  ${bold("Stack4That")} ${dim("· describe it, watch the stack assemble")}\n`);

// ---------------------------------------------------------------------------
// helpers

async function hostResolves() {
  try {
    await lookup(HOST);
    return true;
  } catch {
    return false;
  }
}
async function appUrl() {
  return (await hostResolves()) ? `http://${HOST}:${PORT}` : `http://localhost:${PORT}`;
}

function readPid() {
  try {
    const pid = Number(fs.readFileSync(PID_FILE, "utf8").trim());
    return Number.isFinite(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}
function alive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
function portFree(port) {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once("error", () => resolve(false));
    srv.once("listening", () => srv.close(() => resolve(true)));
    srv.listen(port, "::");
  });
}
function portOwner(port) {
  try {
    const pid = execFileSync("lsof", ["-ti", `tcp:${port}`, "-sTCP:LISTEN"], { encoding: "utf8" }).trim().split("\n")[0];
    if (!pid) return null;
    const cmd = execFileSync("ps", ["-o", "command=", "-p", pid], { encoding: "utf8" }).trim();
    let cwd = "";
    try {
      cwd = execFileSync("lsof", ["-a", "-p", pid, "-d", "cwd", "-Fn"], { encoding: "utf8" }).split("\n").find((l) => l.startsWith("n"))?.slice(1) ?? "";
    } catch {
      /* ignore */
    }
    return { pid: Number(pid), cmd, cwd };
  } catch {
    return null;
  }
}
async function health() {
  try {
    const res = await fetch(`http://127.0.0.1:${PORT}/api/health`, { signal: AbortSignal.timeout(3000) });
    return { status: res.status, body: await res.json().catch(() => ({})) };
  } catch {
    return null;
  }
}
function hasTypeSafeKey() {
  if (process.env.TYPESAFE_API_KEY) return true;
  try {
    return /^\s*TYPESAFE_API_KEY\s*=\s*\S+/m.test(fs.readFileSync(path.join(ROOT, ".env.local"), "utf8"));
  } catch {
    return false;
  }
}
function newestMtime(target) {
  let newest = 0;
  const walk = (p) => {
    let st;
    try {
      st = fs.statSync(p);
    } catch {
      return;
    }
    if (st.isDirectory()) {
      for (const e of fs.readdirSync(p)) if (e !== "node_modules" && !e.startsWith(".")) walk(path.join(p, e));
    } else newest = Math.max(newest, st.mtimeMs);
  };
  walk(target);
  return newest;
}
function buildIsStale() {
  let built;
  try {
    built = fs.statSync(path.join(ROOT, ".next", "BUILD_ID")).mtimeMs;
  } catch {
    return true;
  }
  const inputs = ["src", "public", "next.config.ts", "package.json", "postcss.config.mjs", "tsconfig.json"].map((p) => newestMtime(path.join(ROOT, p)));
  return Math.max(...inputs) > built;
}
function openBrowser(url) {
  const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
  spawn(cmd, [url], { stdio: "ignore", detached: true, shell: process.platform === "win32" }).unref();
}
/** Yes/no prompt. Without a terminal it can not ask, so it answers "no" (never runs sudo or kills anything unasked). */
function ask(question) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) return Promise.resolve("n");
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(question, (a) => (rl.close(), resolve(a.trim().toLowerCase()))));
}
async function waitFor(fn, timeoutMs) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const v = await fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 400));
  }
  return null;
}

/** Make sure nothing else holds the port. Our own server is handled by the caller. */
async function ensurePortAvailable() {
  if (await portFree(PORT)) return true;
  const owner = portOwner(PORT);
  // Ours = a Next server started from this project (background start, dev server, or npm script).
  const ours = owner && owner.cwd === ROOT && /next/i.test(owner.cmd);
  if (ours) {
    warn(`Port ${PORT} is held by another Stack4That process (pid ${owner.pid}: ${owner.cmd}).`);
    const a = await ask(`    Stop it and continue? ${dim("[Y/n]")} `);
    if (a === "" || a === "y" || a === "yes") {
      try {
        process.kill(owner.pid, "SIGTERM");
      } catch {
        /* already gone */
      }
      if (await waitFor(() => portFree(PORT), 8000)) {
        ok("Stopped it.");
        return true;
      }
    } else {
      say(`    Stop it first with ${cyan(`kill ${owner.pid}`)} (or Ctrl+C in the terminal running it), then try again.`);
      return false;
    }
  } else if (owner) {
    fail(`Port ${PORT} is in use by another program (pid ${owner.pid}: ${owner.cmd}).`);
    say(`    Stop that program, or run on another port: ${cyan(`STACK4THAT_PORT=4444 stack4that start`)}`);
    return false;
  }
  fail(`Port ${PORT} is not available.`);
  return false;
}

async function preflight() {
  if (!fs.existsSync(path.join(ROOT, "node_modules", "next"))) {
    warn("Dependencies are not installed yet; installing…");
    const r = spawnSync("npm", ["install"], { cwd: ROOT, stdio: "inherit" });
    if (r.status !== 0) return false;
  }
  if (!hasTypeSafeKey()) {
    fail(`TypeSafe is not configured. Stack4That makes every decision with TypeSafe.`);
    say(`    Add ${cyan("TYPESAFE_API_KEY=...")} to ${path.join(ROOT, ".env.local")}`);
    say(`    Get a key at https://console.typesafe.ai/settings/keys`);
    return false;
  }
  if (!(await hostResolves())) {
    warn(`"${HOST}" does not resolve on this machine yet.`);
    const a = await ask(`    Set up http://${HOST}:${PORT} now? It adds one line to /etc/hosts and asks for your password. ${dim("[Y/n]")} `);
    if (a === "" || a === "y" || a === "yes") await setupHosts();
    else say(`    ${dim(`Using http://localhost:${PORT} for now. Run`)} ${cyan("stack4that setup")} ${dim("any time.")}`);
  }
  return true;
}

// ---------------------------------------------------------------------------
// commands

async function setupHosts() {
  if (await hostResolves()) {
    ok(`${HOST} already resolves.`);
    return true;
  }
  say(`    ${dim("Adding")} 127.0.0.1 ${HOST} ${dim("and")} ::1 ${HOST} ${dim("to /etc/hosts…")}`);
  const r = spawnSync("sudo", ["sh", "-c", `printf '\\n# Stack4That\\n127.0.0.1 ${HOST}\\n::1 ${HOST}\\n' >> /etc/hosts`], { stdio: "inherit" });
  if (r.status !== 0) {
    fail("Could not update /etc/hosts.");
    return false;
  }
  if (process.platform === "darwin") spawnSync("sudo", ["dscacheutil", "-flushcache"], { stdio: "ignore" });
  if (await waitFor(hostResolves, 3000)) {
    ok(`http://${HOST}:${PORT} now resolves.`);
    return true;
  }
  warn("The entry was added but does not resolve yet; it usually takes effect within a few seconds.");
  return false;
}

async function start({ open = true } = {}) {
  brand();
  const pid = readPid();
  if (alive(pid) && (await health())) {
    const url = await appUrl();
    ok(`Already running at ${bold(url)} ${dim(`(pid ${pid})`)}`);
    if (open) openBrowser(url);
    return 0;
  }
  if (!(await preflight())) return 1;
  if (!(await ensurePortAvailable())) return 1;

  if (buildIsStale()) {
    say(`  ${dim("Building the production app (first start or code changed)…")}`);
    const r = spawnSync(process.execPath, [NEXT_BIN, "build"], { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"], encoding: "utf8" });
    if (r.status !== 0) {
      fail("Build failed:");
      say(((r.stdout ?? "") + (r.stderr ?? "")).split("\n").slice(-30).join("\n"));
      return 1;
    }
    ok("Built.");
  }

  fs.mkdirSync(STATE_DIR, { recursive: true });
  const log = fs.openSync(LOG_FILE, "a");
  fs.writeSync(log, `\n--- stack4that start ${new Date().toISOString()} ---\n`);
  const child = spawn(process.execPath, [NEXT_BIN, "start", "-p", String(PORT)], { cwd: ROOT, detached: true, stdio: ["ignore", log, log], env: { ...process.env, NODE_ENV: "production" } });
  child.unref();
  fs.writeFileSync(PID_FILE, String(child.pid));

  const h = await waitFor(async () => (alive(child.pid) ? await health() : "dead"), 30000);
  if (!h || h === "dead") {
    fail(`The server did not come up. Last log lines (${LOG_FILE}):`);
    say(fs.readFileSync(LOG_FILE, "utf8").split("\n").slice(-15).join("\n"));
    return 1;
  }
  const url = await appUrl();
  ok(`Running at ${bold(url)}`);
  const cat = h.body?.catalog;
  if (cat) say(`    ${dim(`${cat.active} technologies · TypeSafe ${h.body.typesafe}`)}`);
  if (h.status !== 200) warn(`Health check reported a problem: ${JSON.stringify(h.body)}`);
  say(`    ${dim("stop:")} stack4that stop   ${dim("logs:")} stack4that logs   ${dim("status:")} stack4that status\n`);
  if (open) openBrowser(url);
  return 0;
}

async function stop({ quiet = false } = {}) {
  const pid = readPid();
  if (!alive(pid)) {
    if (!quiet) say(`\n  ${dim("Stack4That is not running.")}\n`);
    fs.rmSync(PID_FILE, { force: true });
    return 0;
  }
  try {
    process.kill(-pid, "SIGTERM"); // the whole detached process group
  } catch {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      /* gone */
    }
  }
  const gone = await waitFor(() => !alive(pid) && portFree(PORT), 10000);
  if (!gone) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      /* gone */
    }
  }
  fs.rmSync(PID_FILE, { force: true });
  if (!quiet) say(`\n  ${green("✓")} Stopped Stack4That.\n`);
  return 0;
}

async function status() {
  brand();
  const pid = readPid();
  const h = await health();
  if (alive(pid) && h) ok(`Running at ${bold(await appUrl())} ${dim(`(pid ${pid})`)}`);
  else if (h) warn(`A server answers on port ${PORT} but was not started with 'stack4that start' (dev server?).`);
  else say(`  ${dim("○")} Not running ${dim("(start it with")} stack4that start${dim(")")}`);
  (hasTypeSafeKey() ? ok : fail)(`TypeSafe API key ${hasTypeSafeKey() ? "configured" : "missing (required)"}`);
  if (await hostResolves()) ok(`http://${HOST}:${PORT} resolves`);
  else warn(`"${HOST}" does not resolve (run ${cyan("stack4that setup")})`);
  if (h?.body?.catalog) ok(`${h.body.catalog.active} technologies · ${h.body.catalog.verified} verified by the pipeline`);
  say();
  return 0;
}

async function dev() {
  brand();
  const pid = readPid();
  if (alive(pid)) {
    say(`  ${dim("Stopping the background server so the dev server can use the port…")}`);
    await stop({ quiet: true });
  }
  if (!(await preflight())) return 1;
  if (!(await ensurePortAvailable())) return 1;
  say(`  ${green("▲")} Development server with hot reload at ${bold(await appUrl())} ${dim("(Ctrl+C to stop)")}\n`);
  const child = spawn(process.execPath, [NEXT_BIN, "dev", "-p", String(PORT)], { cwd: ROOT, stdio: "inherit" });
  return new Promise((resolve) => child.on("exit", (code) => resolve(code ?? 0)));
}

function logs() {
  if (!fs.existsSync(LOG_FILE)) {
    say(`\n  ${dim("No log yet. Start with")} stack4that start\n`);
    return 0;
  }
  const child = spawn("tail", ["-n", "50", "-f", LOG_FILE], { stdio: "inherit" });
  return new Promise((resolve) => child.on("exit", () => resolve(0)));
}

function refresh(args) {
  if (!hasTypeSafeKey()) {
    fail("TypeSafe is not configured; the pipeline validates every technology with TypeSafe.");
    return 1;
  }
  const tsx = path.join(ROOT, "node_modules", "tsx", "dist", "cli.mjs");
  const r = spawnSync(process.execPath, [tsx, "scripts/pipeline.ts", ...(args.length ? args : ["--mode", "full"])], { cwd: ROOT, stdio: "inherit" });
  return r.status ?? 1;
}

function help() {
  brand();
  const rows = [
    ["start", "Build if needed, start in the background, and open the app"],
    ["stop", "Stop the background server"],
    ["restart", "Stop, then start"],
    ["status", "Show whether it is running and what is configured"],
    ["open", "Open the app in your browser"],
    ["logs", "Follow the server log"],
    ["dev", "Development server with hot reload (foreground)"],
    ["setup", `Make http://${HOST}:${PORT} resolve on this machine`],
    ["refresh", "Run the pipeline now (--mode full|refresh|discover, --limit N, --sources a,b)"],
  ];
  say(`  ${bold("Usage")}  stack4that <command>\n`);
  for (const [cmd, text] of rows) say(`    ${cyan(cmd.padEnd(9))} ${text}`);
  say(`\n  ${dim("Options: --no-open (start/restart)   Env: STACK4THAT_PORT (default 3333)")}\n`);
  return 0;
}

// ---------------------------------------------------------------------------

const [cmd = "help", ...rest] = process.argv.slice(2);
const noOpen = rest.includes("--no-open");
const commands = {
  start: () => start({ open: !noOpen }),
  stop: () => stop(),
  restart: async () => (await stop({ quiet: true }), start({ open: !noOpen })),
  status,
  open: async () => (openBrowser(await appUrl()), 0),
  logs,
  dev,
  setup: async () => (brand(), (await setupHosts()) ? 0 : 1),
  refresh: () => refresh(rest.filter((a) => a !== "--no-open")),
  help,
  "--help": help,
  "-h": help,
};
const run = commands[cmd];
if (!run) {
  fail(`Unknown command "${cmd}".`);
  help();
  process.exit(1);
}
Promise.resolve(run()).then((code) => process.exit(code ?? 0), (err) => {
  fail(err?.message ?? String(err));
  process.exit(1);
});
