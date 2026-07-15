import fs from "node:fs";
import path from "node:path";
import type { DepGraph, DepGraphNode, DepGraphEdge } from "@vibe-kanban/shared";

// Native TS/JS import-dependency graph extractor. Walks a project's source
// roots, parses each file's imports, resolves relative + tsconfig-alias +
// workspace-package specifiers to internal files, and emits a file-level graph.
// No external tooling (this is the in-app counterpart to `bun run graphs`).

const SRC_EXTS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"];
const IGNORE_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "out",
  ".next",
  "coverage",
  ".venv",
  "graphify-out",
  ".turbo",
  ".cache",
]);
// Safety cap so a pathological repo can't build a multi-minute graph.
const MAX_FILES = 5000;

interface Alias {
  prefix: string; // e.g. "@/"  (trailing slash normalised)
  base: string; // absolute dir the prefix maps to
}
interface Workspace {
  name: string; // package.json "name"
  dir: string; // absolute package dir
  entry: string | null; // absolute main/module entry file, if resolvable
}

// Loose shape covering the tsconfig + package.json fields we read.
interface RawConfig {
  compilerOptions?: { paths?: Record<string, string[]>; baseUrl?: string };
  extends?: string | string[];
  references?: { path?: string }[];
  workspaces?: string[] | { packages?: string[] };
  name?: string;
  main?: string;
  module?: string;
}

// Strip block + line comments and trailing commas so a JSONC tsconfig parses.
function parseJsonc(text: string): RawConfig {
  const noComments = text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'])\/\/.*$/gm, "$1");
  const noTrailingCommas = noComments.replace(/,(\s*[}\]])/g, "$1");
  return JSON.parse(noTrailingCommas) as RawConfig;
}

function readJsonc(file: string): RawConfig | null {
  try {
    return parseJsonc(fs.readFileSync(file, "utf-8"));
  } catch {
    return null;
  }
}

/** Pull compilerOptions.paths from one config, following `extends` + `references`
 *  (Vite/TS projects put the real `@/*` paths in a referenced tsconfig.app.json). */
function collectAliases(configPath: string, aliases: Alias[], visited: Set<string>): void {
  const abs = path.resolve(configPath);
  if (visited.has(abs) || !isFile(abs)) return;
  visited.add(abs);
  const cfg = readJsonc(abs);
  if (!cfg) return;
  const dir = path.dirname(abs);

  const ext = Array.isArray(cfg.extends) ? cfg.extends : cfg.extends ? [cfg.extends] : [];
  for (const e of ext)
    collectAliases(path.resolve(dir, e.endsWith(".json") ? e : e + ".json"), aliases, visited);

  const co = cfg.compilerOptions;
  if (co?.paths) {
    const baseUrl = path.resolve(dir, co.baseUrl ?? ".");
    for (const [key, targets] of Object.entries(co.paths as Record<string, string[]>)) {
      const target = Array.isArray(targets) ? targets[0] : null;
      if (!target) continue;
      aliases.push({
        prefix: key.replace(/\*$/, ""),
        base: path.resolve(baseUrl, target.replace(/\*$/, "")),
      });
    }
  }

  for (const ref of cfg.references ?? []) {
    if (!ref?.path) continue;
    let rp = path.resolve(dir, ref.path);
    if (!rp.endsWith(".json")) {
      rp = isDir(rp) ? path.join(rp, "tsconfig.json") : rp + ".json";
    }
    collectAliases(rp, aliases, visited);
  }
}

/** Collect tsconfig/jsconfig path aliases for a dir (following extends/references). */
function readAliases(dir: string): Alias[] {
  const aliases: Alias[] = [];
  const visited = new Set<string>();
  for (const name of ["tsconfig.json", "jsconfig.json"]) {
    collectAliases(path.join(dir, name), aliases, visited);
  }
  return aliases;
}

/** Read workspace package dirs from the root package.json. */
function readWorkspaces(projectPath: string): Workspace[] {
  const root = readJsonc(path.join(projectPath, "package.json"));
  if (!root) return [];
  let patterns: string[] = [];
  if (Array.isArray(root.workspaces)) patterns = root.workspaces;
  else if (Array.isArray(root.workspaces?.packages)) patterns = root.workspaces.packages;
  const dirs = new Set<string>();
  for (const pat of patterns) {
    // support "pkg", "pkg/*", "packages/*"
    if (pat.endsWith("/*")) {
      const parent = path.join(projectPath, pat.slice(0, -2));
      if (!fs.existsSync(parent)) continue;
      for (const e of fs.readdirSync(parent, { withFileTypes: true })) {
        if (e.isDirectory()) dirs.add(path.join(parent, e.name));
      }
    } else {
      dirs.add(path.join(projectPath, pat));
    }
  }
  const ws: Workspace[] = [];
  for (const dir of dirs) {
    const pkg = readJsonc(path.join(dir, "package.json"));
    if (!pkg?.name) continue;
    const main = pkg.module || pkg.main;
    const entry = main ? resolveFileOrIndex(path.resolve(dir, main)) : null;
    ws.push({ name: pkg.name, dir, entry });
  }
  return ws;
}

/** Detect source roots: each workspace's src (or dir), plus a top-level src/. */
function detectRoots(projectPath: string, workspaces: Workspace[]): string[] {
  const roots = new Set<string>();
  for (const ws of workspaces) {
    const src = path.join(ws.dir, "src");
    roots.add(fs.existsSync(src) ? src : ws.dir);
  }
  const topSrc = path.join(projectPath, "src");
  if (fs.existsSync(topSrc)) roots.add(topSrc);
  // Fallback: nothing detected → scan the project root itself.
  if (roots.size === 0) roots.add(projectPath);
  return [...roots];
}

function resolveFileOrIndex(base: string): string | null {
  // exact file
  if (SRC_EXTS.some((e) => base.endsWith(e)) && isFile(base)) return base;
  for (const e of SRC_EXTS) if (isFile(base + e)) return base + e;
  for (const e of SRC_EXTS)
    if (isFile(path.join(base, "index" + e))) return path.join(base, "index" + e);
  if (isFile(base)) return base; // e.g. an explicit .json/.css — kept only if a source ext
  return null;
}

function isFile(p: string): boolean {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

function isDir(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function walk(root: string, out: string[]): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (out.length >= MAX_FILES) return;
    if (e.name.startsWith(".") && e.name !== ".") continue;
    const full = path.join(root, e.name);
    if (e.isDirectory()) {
      if (IGNORE_DIRS.has(e.name)) continue;
      walk(full, out);
    } else if (SRC_EXTS.some((ext) => e.name.endsWith(ext))) {
      out.push(full);
    }
  }
}

const IMPORT_RE =
  /(?:import|export)\s+(?:[^'"]*?\sfrom\s+)?["']([^"']+)["']|import\s*\(\s*["']([^"']+)["']\s*\)|require\s*\(\s*["']([^"']+)["']\s*\)/g;

function extractSpecifiers(text: string): string[] {
  const specs: string[] = [];
  let m: RegExpExecArray | null;
  IMPORT_RE.lastIndex = 0;
  while ((m = IMPORT_RE.exec(text))) {
    const spec = m[1] || m[2] || m[3];
    if (spec) specs.push(spec);
  }
  return specs;
}

function resolveSpecifier(
  spec: string,
  fromFile: string,
  aliases: Alias[],
  workspaces: Workspace[],
): string | null {
  if (spec.startsWith(".")) {
    return resolveFileOrIndex(path.resolve(path.dirname(fromFile), spec));
  }
  for (const a of aliases) {
    if (spec === a.prefix.replace(/\/$/, "") || spec.startsWith(a.prefix)) {
      const rest = spec.slice(a.prefix.length);
      return resolveFileOrIndex(rest ? path.join(a.base, rest) : a.base);
    }
  }
  for (const ws of workspaces) {
    if (spec === ws.name) return ws.entry;
    if (spec.startsWith(ws.name + "/")) {
      return resolveFileOrIndex(path.join(ws.dir, spec.slice(ws.name.length + 1)));
    }
  }
  return null; // bare npm import → external, no node
}

function groupOf(rel: string): string {
  const seg = rel.split("/");
  // client/src/… → "client"; src/components/… → "components"
  if (seg[0] === "src" && seg.length > 1) return seg[1];
  return seg[0] || "root";
}

export function generateDepGraph(projectPath: string): DepGraph {
  if (!fs.existsSync(projectPath)) {
    throw Object.assign(new Error("Project path does not exist"), { statusCode: 404 });
  }
  const workspaces = readWorkspaces(projectPath);
  const roots = detectRoots(projectPath, workspaces);
  // aliases: project root + each workspace dir
  const aliases = [projectPath, ...workspaces.map((w) => w.dir)].flatMap(readAliases);

  const files: string[] = [];
  for (const r of roots) walk(r, files);
  const fileSet = new Set(files);

  const rel = (abs: string) => path.relative(projectPath, abs).split(path.sep).join("/");

  const nodes = new Map<string, DepGraphNode>();
  const edges: DepGraphEdge[] = [];
  const degree = new Map<string, number>();

  for (const file of files) {
    const id = rel(file);
    if (!nodes.has(id))
      nodes.set(id, {
        id,
        label: path.basename(id),
        group: groupOf(id),
        degree: 0,
        community: 0,
        inCycle: false,
      });
  }

  for (const file of files) {
    let text: string;
    try {
      text = fs.readFileSync(file, "utf-8");
    } catch {
      continue;
    }
    const srcId = rel(file);
    const seen = new Set<string>();
    for (const spec of extractSpecifiers(text)) {
      const resolved = resolveSpecifier(spec, file, aliases, workspaces);
      if (!resolved || !fileSet.has(resolved)) continue; // external or out-of-tree
      const tgtId = rel(resolved);
      if (tgtId === srcId || seen.has(tgtId)) continue;
      seen.add(tgtId);
      edges.push({ source: srcId, target: tgtId });
      degree.set(srcId, (degree.get(srcId) ?? 0) + 1);
      degree.set(tgtId, (degree.get(tgtId) ?? 0) + 1);
    }
  }

  for (const [id, d] of degree) {
    const n = nodes.get(id);
    if (n) n.degree = d;
  }

  const ids = [...nodes.keys()];

  // Cycles: strongly-connected components of the directed import graph.
  const cycles = detectCycles(ids, edges);
  const inCycle = new Set(cycles.flat());
  for (const id of inCycle) {
    const n = nodes.get(id);
    if (n) n.inCycle = true;
  }

  // Communities: Louvain over the undirected import graph → subsystems.
  const community = detectCommunities(ids, edges);
  let communityCount = 0;
  for (const id of ids) {
    const n = nodes.get(id);
    if (n) {
      n.community = community.get(id) ?? 0;
      communityCount = Math.max(communityCount, n.community + 1);
    }
  }

  return {
    nodes: [...nodes.values()],
    edges,
    fileCount: files.length,
    roots: roots.map(rel),
    communityCount,
    cycles,
    generatedAt: new Date().toISOString(),
  };
}

// ── Cycle detection: iterative Tarjan SCC (safe for large graphs) ──
function detectCycles(ids: string[], edges: DepGraphEdge[]): string[][] {
  const adj = new Map<string, string[]>();
  for (const id of ids) adj.set(id, []);
  for (const e of edges) adj.get(e.source)?.push(e.target);

  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  let counter = 0;
  const sccs: string[][] = [];

  for (const start of ids) {
    if (index.has(start)) continue;
    // work stack of [node, neighbourCursor]
    const work: { node: string; i: number }[] = [{ node: start, i: 0 }];
    while (work.length) {
      const frame = work[work.length - 1];
      const { node } = frame;
      if (frame.i === 0) {
        index.set(node, counter);
        low.set(node, counter);
        counter++;
        stack.push(node);
        onStack.add(node);
      }
      const neighbours = adj.get(node)!;
      if (frame.i < neighbours.length) {
        const nb = neighbours[frame.i];
        frame.i++;
        if (!index.has(nb)) {
          work.push({ node: nb, i: 0 });
        } else if (onStack.has(nb)) {
          low.set(node, Math.min(low.get(node)!, index.get(nb)!));
        }
      } else {
        if (low.get(node) === index.get(node)) {
          const comp: string[] = [];
          let w: string;
          do {
            w = stack.pop()!;
            onStack.delete(w);
            comp.push(w);
          } while (w !== node);
          if (comp.length > 1) sccs.push(comp); // size >= 2 == a cycle
        }
        work.pop();
        if (work.length) {
          const parent = work[work.length - 1].node;
          low.set(parent, Math.min(low.get(parent)!, low.get(node)!));
        }
      }
    }
  }
  return sccs;
}

// ── Community detection: single-level Louvain (local moving) ──
// Deterministic (fixed node order); treats imports as an undirected weighted graph.
function detectCommunities(ids: string[], edges: DepGraphEdge[]): Map<string, number> {
  const adj = new Map<string, Map<string, number>>();
  for (const id of ids) adj.set(id, new Map());
  const bump = (a: string, b: string) => {
    const m = adj.get(a);
    if (m) m.set(b, (m.get(b) ?? 0) + 1);
  };
  for (const e of edges) {
    if (e.source === e.target) continue;
    bump(e.source, e.target);
    bump(e.target, e.source);
  }

  const k = new Map<string, number>(); // weighted degree
  let m2 = 0; // 2m
  for (const id of ids) {
    let deg = 0;
    for (const w of adj.get(id)!.values()) deg += w;
    k.set(id, deg);
    m2 += deg;
  }
  if (m2 === 0) return new Map(ids.map((id) => [id, 0]));

  const comm = new Map<string, number>(ids.map((id, i) => [id, i]));
  const sigmaTot = new Map<number, number>(ids.map((id, i) => [i, k.get(id)!]));

  let improved = true;
  let passes = 0;
  while (improved && passes < 20) {
    improved = false;
    passes++;
    for (const node of ids) {
      const ki = k.get(node)!;
      const cOld = comm.get(node)!;
      sigmaTot.set(cOld, (sigmaTot.get(cOld) ?? 0) - ki);

      // sum of weights from node to each neighbouring community
      const toComm = new Map<number, number>();
      for (const [nb, w] of adj.get(node)!) {
        if (nb === node) continue;
        const c = comm.get(nb)!;
        toComm.set(c, (toComm.get(c) ?? 0) + w);
      }

      let bestComm = cOld;
      let bestGain = (toComm.get(cOld) ?? 0) - ((sigmaTot.get(cOld) ?? 0) * ki) / m2;
      for (const [c, kIn] of toComm) {
        const gain = kIn - ((sigmaTot.get(c) ?? 0) * ki) / m2;
        if (gain > bestGain) {
          bestGain = gain;
          bestComm = c;
        }
      }

      comm.set(node, bestComm);
      sigmaTot.set(bestComm, (sigmaTot.get(bestComm) ?? 0) + ki);
      if (bestComm !== cOld) improved = true;
    }
  }

  // Relabel to dense 0..n-1
  const relabel = new Map<number, number>();
  let next = 0;
  const result = new Map<string, number>();
  for (const id of ids) {
    const c = comm.get(id)!;
    if (!relabel.has(c)) relabel.set(c, next++);
    result.set(id, relabel.get(c)!);
  }
  return result;
}
