// Smoke harness for the multi-session orchestration loop.
//
// Verifies maybeSpawnForTask dispatches headless claude under the right
// conditions, by replacing the real `claude` binary on PATH with a shim
// that records its invocations. Exits non-zero if any assertion fails.
//
// Run from the repo root: bun run server/scripts/smoke/run-smoke.ts

import fs from "node:fs";
import path from "node:path";

const SCRIPT_DIR = path.resolve(import.meta.dir);
const SHIM_DIR = path.join(SCRIPT_DIR, "bin");
const RUNTIME_DIR = "/tmp/vk-smoke";
const DATA_DIR = path.join(RUNTIME_DIR, "data");
const PROJECTS_DIR = path.join(RUNTIME_DIR, "projects");
const LOG = path.join(RUNTIME_DIR, "calls.jsonl");

// 1. Configure env BEFORE importing the app.
process.env.VK_DATA_DIR = DATA_DIR;
process.env.PATH = SHIM_DIR + path.delimiter + process.env.PATH;

// 2. Reset runtime state.
fs.rmSync(RUNTIME_DIR, { recursive: true, force: true });
fs.mkdirSync(DATA_DIR, { recursive: true });
for (const slot of ["A", "B", "C", "D"]) {
  fs.mkdirSync(path.join(PROJECTS_DIR, slot), { recursive: true });
}
fs.writeFileSync(LOG, "");

// 3. Import the real app.
const repoRoot = path.resolve(SCRIPT_DIR, "..", "..", "..");
const { buildApp } = await import(path.join(repoRoot, "server/src/app.ts"));
const app = await buildApp();
await app.ready();

const post = async (url: string, body: any): Promise<any> => {
  const r = await app.inject({
    method: "POST",
    url,
    headers: { "content-type": "application/json" },
    payload: JSON.stringify(body),
  });
  if (r.statusCode >= 300) throw new Error(`POST ${url} → ${r.statusCode}: ${r.body}`);
  return JSON.parse(r.body);
};
const patch = async (url: string, body: any): Promise<any> => {
  const r = await app.inject({
    method: "PATCH",
    url,
    headers: { "content-type": "application/json" },
    payload: JSON.stringify(body),
  });
  if (r.statusCode >= 300) throw new Error(`PATCH ${url} → ${r.statusCode}: ${r.body}`);
  return JSON.parse(r.body);
};

const readCalls = (): any[] => {
  const raw = fs.readFileSync(LOG, "utf8").trim();
  return raw ? raw.split("\n").map((l) => JSON.parse(l)) : [];
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const waitForCalls = async (n: number, timeoutMs = 8000): Promise<void> => {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (readCalls().length >= n) return;
    await sleep(100);
  }
};
const resetCalls = () => fs.writeFileSync(LOG, "");

let pass = 0;
let fail = 0;
const assert = (cond: any, label: string) => {
  if (cond) {
    pass++;
    console.log(`  ✓ ${label}`);
  } else {
    fail++;
    console.log(`  ✗ ${label}`);
  }
};

console.log("=== SCENARIO A: qa-test task with autoSpawnEnabled=1 → dispatches claude ===");
const projA = await post("/api/projects", { name: "smoke-A", path: path.join(PROJECTS_DIR, "A") });
await patch(`/api/projects/${projA.id}`, { autoSpawnEnabled: true, qaAgentPath: "/abs/path/to/qa-agent" });
const taskA = await post(`/api/projects/${projA.id}/tasks`, {
  title: "QA: login flow",
  metadata: {
    type: "qa-test",
    qa_scenario: "log in successfully",
    qa_target_url: "http://localhost:3000",
  },
});
await waitForCalls(1);
const callsA = readCalls();
assert(callsA.length === 1, `A1: exactly 1 dispatch (got ${callsA.length})`);
if (callsA.length >= 1) {
  const c = callsA[0];
  assert(c.cwd === path.join(PROJECTS_DIR, "A"), `A2: cwd matches project.path (${c.cwd})`);
  assert(c.argv.includes("-p"), "A3: argv contains -p flag");
  assert(c.argv.includes("--mcp-config"), "A4: argv contains --mcp-config");
  assert(c.argv.includes("--dangerously-skip-permissions"), "A5: argv contains --dangerously-skip-permissions");
  const prompt = c.argv[c.argv.length - 1];
  assert(prompt.includes("log in successfully"), "A6: prompt includes qa_scenario from metadata");
  assert(prompt.includes("http://localhost:3000"), "A7: prompt includes qa_target_url from metadata");
  assert(/qa[\s-]?test/i.test(prompt), "A8: prompt mentions qa-test");
}

console.log();
console.log("=== SCENARIO B: dev-fix task with bug_report → dispatches second claude ===");
resetCalls();
const taskB = await post(`/api/projects/${projA.id}/tasks`, {
  title: "Fix login bug",
  metadata: {
    type: "dev-fix",
    parent_task: taskA.id,
    bug_report: {
      summary: "login form doesn't submit on valid creds",
      expected: "form submits and redirects to /dashboard",
      actual: "click does nothing, no network request fires",
      severity: "high",
      steps: ["open /login", "enter test@x.com / pwd", "click Submit"],
      affected_files: ["client/src/auth.ts"],
    },
  },
});
await waitForCalls(1);
const callsB = readCalls();
assert(callsB.length === 1, `B1: exactly 1 dispatch (got ${callsB.length})`);
if (callsB.length >= 1) {
  const prompt = callsB[0].argv[callsB[0].argv.length - 1];
  assert(/dev[\s-]?fix/i.test(prompt), "B2: prompt mentions dev-fix");
  assert(prompt.includes("login form doesn't submit on valid creds"), "B3: prompt includes bug_report.summary");
  assert(prompt.includes("client/src/auth.ts"), "B4: prompt includes bug_report.affected_files");
  assert(prompt.includes("click does nothing"), "B5: prompt includes bug_report.actual");
  assert(prompt.includes("high"), "B6: prompt includes bug_report.severity");
  assert(prompt.includes(taskA.id), "B7: prompt links back to parent_task id");
}

console.log();
console.log("=== SCENARIO C: task without metadata.type → NO dispatch ===");
resetCalls();
await post(`/api/projects/${projA.id}/tasks`, { title: "Plain task", metadata: {} });
await sleep(800);
assert(readCalls().length === 0, "C1: no dispatch for empty metadata");

resetCalls();
await post(`/api/projects/${projA.id}/tasks`, { title: "No type", metadata: { foo: "bar" } });
await sleep(800);
assert(readCalls().length === 0, "C2: no dispatch for metadata without type field");

resetCalls();
await post(`/api/projects/${projA.id}/tasks`, { title: "Unregistered type", metadata: { type: "no-such-type" } });
await sleep(800);
assert(readCalls().length === 0, "C3: no dispatch for unregistered type");

console.log();
console.log("=== SCENARIO D: project autoSpawnEnabled=false → NO dispatch ===");
resetCalls();
const projD = await post("/api/projects", { name: "smoke-D", path: path.join(PROJECTS_DIR, "D") });
await post(`/api/projects/${projD.id}/tasks`, {
  title: "QA test (should not spawn)",
  metadata: { type: "qa-test", qa_scenario: "x" },
});
await sleep(800);
assert(readCalls().length === 0, "D1: no dispatch when autoSpawnEnabled=false");

console.log();
console.log("=== SCENARIO E: project.path missing on disk → NO dispatch ===");
resetCalls();
const projE = await post("/api/projects", {
  name: "smoke-E",
  path: path.join(PROJECTS_DIR, "does-not-exist"),
});
await patch(`/api/projects/${projE.id}`, { autoSpawnEnabled: true, qaAgentPath: "/abs/path/to/qa-agent" });
await post(`/api/projects/${projE.id}/tasks`, {
  title: "QA test (path missing)",
  metadata: { type: "qa-test", qa_scenario: "x" },
});
await sleep(800);
assert(readCalls().length === 0, "E1: no dispatch when project.path missing on disk");

console.log();
console.log("=== SCENARIO F: re-enable then re-spawn (sanity check loop closes) ===");
resetCalls();
await patch(`/api/projects/${projD.id}`, { autoSpawnEnabled: true, qaAgentPath: "/abs/path/to/qa-agent" });
await post(`/api/projects/${projD.id}/tasks`, {
  title: "QA test after enable",
  metadata: { type: "qa-test", qa_scenario: "y" },
});
await waitForCalls(1);
assert(readCalls().length === 1, "F1: enabling autoSpawn allows subsequent qa-test to dispatch");

await app.close();

console.log();
console.log("─".repeat(60));
console.log(`${pass}/${pass + fail} assertions passed`);
process.exit(fail === 0 ? 0 : 1);
