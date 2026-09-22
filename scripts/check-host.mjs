// Runs before `npm run dev`: explains the two things that stop http://stack4that:3333 from working.
import { execFileSync } from "node:child_process";
import { lookup } from "node:dns/promises";
import net from "node:net";

const HOST = "stack4that";
const PORT = 3333;

const free = await new Promise((resolve) => {
  const srv = net.createServer();
  srv.once("error", () => resolve(false));
  srv.once("listening", () => srv.close(() => resolve(true)));
  srv.listen(PORT, "::");
});
if (!free) {
  let who = "another program";
  try {
    const pid = execFileSync("lsof", ["-ti", `tcp:${PORT}`, "-sTCP:LISTEN"], { encoding: "utf8" }).trim().split("\n")[0];
    const cwd = execFileSync("lsof", ["-a", "-p", pid, "-d", "cwd", "-Fn"], { encoding: "utf8" }).split("\n").find((l) => l.startsWith("n"))?.slice(1);
    const cmd = execFileSync("ps", ["-o", "command=", "-p", pid], { encoding: "utf8" }).trim();
    who = cwd === process.cwd() && /next/i.test(cmd) ? `Stack4That itself (pid ${pid})` : `another program (pid ${pid}: ${cmd})`;
  } catch {
    /* lsof unavailable */
  }
  console.log(`\n  ✗ Port ${PORT} is already in use by ${who}.`);
  console.log(`    If Stack4That is already running, open it with:  stack4that open`);
  console.log(`    To switch to the dev server:                   stack4that dev   (stops the background server first)\n`);
  process.exit(1);
}
try {
  await lookup(HOST);
  console.log(`\n  ▲ Stack4That → http://${HOST}:${PORT}\n`);
} catch {
  console.log(`\n  ⚠ "${HOST}" does not resolve yet. Run \`stack4that setup\` once (asks for your password).`);
  console.log(`    Until then the app is at http://localhost:${PORT}\n`);
}
