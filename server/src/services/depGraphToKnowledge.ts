import path from "node:path";
import { generateDepGraph } from "./depGraph";
import { runAgentOneShot } from "./aiAgent";
import type { DepGraph, DepGraphNode } from "@vibe-kanban/shared";

// Turns the mechanical dependency graph into draft knowledge-graph content:
// each meaningful community (subsystem) becomes a suggested "system" node, and
// heavy cross-community imports become suggested "depends_on" edges. The route
// persists these as status:"suggested" / origin:"dep-graph" so they flow through
// the existing confirm-suggestions UI.
//
// Labels are derived from the community's common directory (reliable, offline).
// `labelCommunity` is deliberately isolated so an AI labeller can replace it.

const MIN_COMMUNITY = 4; // ignore tiny/noise clusters
const MIN_CROSS_EDGES = 3; // min imports between two subsystems to draw depends_on

export interface DepCommunity {
  community: number;
  label: string;
  description: string;
  group: string;
  fileCount: number;
  files: string[]; // top files by degree (node ids)
}
export interface DepCommunityEdge {
  source: number; // community index
  target: number;
  weight: number;
}
export interface DepKnowledge {
  communities: DepCommunity[];
  edges: DepCommunityEdge[];
  fileCount: number;
}

function mostCommon(xs: string[]): string {
  const c = new Map<string, number>();
  for (const x of xs) c.set(x, (c.get(x) ?? 0) + 1);
  return [...c.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
}

/** Longest common directory prefix across a set of file ids. */
function commonDir(ids: string[]): string {
  const dirs = ids.map((id) => id.split("/").slice(0, -1));
  if (dirs.length === 0) return "";
  let prefix = dirs[0];
  for (const d of dirs.slice(1)) {
    let i = 0;
    while (i < prefix.length && i < d.length && prefix[i] === d[i]) i++;
    prefix = prefix.slice(0, i);
    if (prefix.length === 0) break;
  }
  return prefix.join("/");
}

function humanize(dir: string): string {
  const segs = dir.split("/").filter((s) => s && s !== "src");
  const tail = segs.slice(-2).join(" / ");
  return tail || dir || "misc";
}

/** Derive a subsystem label + description from its members (dir-based, offline). */
function labelCommunity(members: DepGraphNode[]): {
  label: string;
  description: string;
  dir: string;
} {
  const ids = members.map((m) => m.id);
  // Dominant directory is more specific than the common prefix (which collapses
  // to "client"/"server" for a wide community). Fall back to prefix, then group.
  const dirs = ids.map((id) => id.split("/").slice(0, -1).join("/"));
  const dir = mostCommon(dirs) || commonDir(ids) || mostCommon(members.map((m) => m.group));
  const top = [...members].sort((a, b) => b.degree - a.degree).slice(0, 5);
  return {
    label: humanize(dir),
    description: `${members.length} files under ${dir || "(mixed)"} · key: ${top
      .map((t) => t.label)
      .join(", ")}`,
    dir,
  };
}

export function depGraphToKnowledge(projectPath: string): DepKnowledge {
  const graph: DepGraph = generateDepGraph(projectPath);

  const byComm = new Map<number, DepGraphNode[]>();
  for (const n of graph.nodes) {
    const arr = byComm.get(n.community) ?? [];
    arr.push(n);
    byComm.set(n.community, arr);
  }

  const communities: DepCommunity[] = [];
  for (const [community, members] of byComm) {
    if (members.length < MIN_COMMUNITY) continue;
    const { label, description } = labelCommunity(members);
    const top = [...members].sort((a, b) => b.degree - a.degree).slice(0, 8);
    communities.push({
      community,
      label,
      description,
      group: mostCommon(members.map((m) => m.group)),
      fileCount: members.length,
      files: top.map((t) => t.id),
    });
  }

  // Aggregate directed cross-community imports between kept subsystems.
  const kept = new Set(communities.map((c) => c.community));
  const commOf = new Map(graph.nodes.map((n) => [n.id, n.community]));
  const counts = new Map<string, number>();
  for (const e of graph.edges) {
    const cs = commOf.get(e.source);
    const ct = commOf.get(e.target);
    if (cs == null || ct == null || cs === ct) continue;
    if (!kept.has(cs) || !kept.has(ct)) continue;
    const key = `${cs}>${ct}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const edges: DepCommunityEdge[] = [];
  for (const [key, weight] of counts) {
    if (weight < MIN_CROSS_EDGES) continue;
    const [source, target] = key.split(">").map(Number);
    edges.push({ source, target, weight });
  }

  return { communities, edges, fileCount: graph.fileCount };
}

interface AiCommunityLabel {
  index: number;
  name: string;
  description: string;
}

function isAiCommunityLabel(v: unknown): v is AiCommunityLabel {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.index === "number" && typeof o.name === "string" && typeof o.description === "string"
  );
}

function buildLabelPrompt(knowledge: DepKnowledge): string {
  const listing = knowledge.communities
    .map((c) => {
      const basenames = c.files.map((f) => path.basename(f)).join(", ");
      return `- index=${c.community} label="${c.label}" files: ${basenames}`;
    })
    .join("\n");

  return `You label software subsystems from a dependency-graph community analysis.
For each community below, propose a short 2-4 word subsystem name and a one-sentence description.

Communities:
${listing}

Return ONLY a JSON array (no markdown, no commentary):
[{"index":<number>,"name":"<2-4 word subsystem name>","description":"<one sentence>"}]`;
}

/** Mutates `knowledge` in place, overwriting labels with any valid AI entries. */
function applyAiLabels(knowledge: DepKnowledge, text: string): void {
  try {
    let raw = text.trim();
    const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fence) raw = fence[1].trim();

    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return;

    const byIndex = new Map(knowledge.communities.map((c) => [c.community, c]));
    for (const entry of parsed) {
      if (!isAiCommunityLabel(entry)) continue;
      const c = byIndex.get(entry.index);
      if (!c) continue;
      c.label = entry.name;
      c.description = entry.description;
    }
  } catch {
    /* keep heuristic labels */
  }
}

// AI labelling is a nice-to-have refinement, not core to the draft. Cap it well
// below runAgentOneShot's 120s default so a slow CLI can't hang the POST request
// for two minutes — on timeout the heuristic (dir-based) labels are kept.
// Future improvement: fully background the drafting so labelling never blocks
// the request at all (return the heuristic draft immediately, refine async).
const AI_LABEL_TIMEOUT_MS = 45_000;

/**
 * Same as {@link depGraphToKnowledge}, then re-label communities via the
 * configured CLI agent, pinned to Opus. On any failure (unavailable CLI,
 * timeout, non-JSON output) keeps the heuristic labels, so the returned
 * {@link DepKnowledge} is always valid.
 */
export function depGraphToKnowledgeWithAI(
  projectPath: string,
  safeEnv: Record<string, string>,
  timeoutMs: number = AI_LABEL_TIMEOUT_MS,
): DepKnowledge {
  const knowledge = depGraphToKnowledge(projectPath);
  if (knowledge.communities.length === 0) return knowledge;

  const prompt = buildLabelPrompt(knowledge);
  const text = runAgentOneShot(prompt, safeEnv, undefined, "opus", timeoutMs);
  if (!text) return knowledge;

  applyAiLabels(knowledge, text);
  return knowledge;
}
