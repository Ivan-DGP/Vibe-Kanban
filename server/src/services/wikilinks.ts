/**
 * Wikilink resolution + artifact→node mirroring.
 *
 * Authoring an artifact whose markdown contains `[[target]]` creates a real
 * graph edge (type `wikilink`) plus a backlink. Edges only connect graph
 * nodes, while artifacts live in their own table, so every artifact is
 * mirrored to a `project_graph_nodes` row (type `concept`, with
 * `metadata = { kind: 'artifact', artifactId, slug }`). A resolved `[[target]]`
 * upserts one node→node edge between the source artifact's node and the
 * target's node. Unresolved targets are parked in `artifact_pending_links`
 * (never written as half-edges, which the canvas would drop).
 *
 * Resolution is in-DB only and project-scoped: a target is matched against the
 * SAME project's artifacts/nodes. A target that looks like a filesystem path
 * (separators or `..`) NEVER touches the disk — it resolves to unresolved.
 *
 * Rename semantics: when a target artifact is renamed its mirror node's label
 * is updated and inbound wikilink edges are re-resolved. Refs that pointed at
 * the OLD name no longer resolve and fall back to pending-links (documented).
 */

import type { DatabaseHandle } from "../lib/runtime";
import { parseWikilinks, slugify, isEscapingTarget } from "../lib/wikilinks";
import { log } from "../lib/logger";

const ARTIFACT_NODE_TYPE = "concept";

interface ArtifactRow {
  id: string;
  projectId: string;
  filename: string;
  updatedAt: string;
}

interface NodeRow {
  id: string;
  projectId: string;
  label: string;
  type: string;
  metadata: string;
  updatedAt: string;
}

interface EdgeRow {
  id: string;
  projectId: string;
  sourceNodeId: string;
  targetNodeId: string;
  label: string | null;
  type: string;
  createdAt: string;
}

interface PendingRow {
  id: string;
  projectId: string;
  sourceArtifactId: string;
  rawTarget: string;
}

export interface ResolvedLink {
  rawTarget: string;
  edgeId: string;
  targetArtifactId: string;
  targetNodeId: string;
  targetFilename: string;
}

export interface SyncResult {
  nodeId: string;
  resolved: ResolvedLink[];
  unresolved: string[];
}

/** Marker stored in a mirror node's metadata so it is resolvable to an artifact. */
interface ArtifactNodeMeta {
  kind: "artifact";
  artifactId: string;
  slug: string;
}

function nowIso(): string {
  return new Date().toISOString();
}

/**
 * Ensure a graph node mirrors the given artifact. Creates it on first call,
 * otherwise updates its label/slug to track filename renames. Returns nodeId.
 */
export function mirrorArtifactToNode(
  db: DatabaseHandle,
  artifact: ArtifactRow,
): { nodeId: string; created: boolean } {
  const existing = findArtifactNode(db, artifact.projectId, artifact.id);
  const slug = slugify(artifact.filename);
  const metadata: ArtifactNodeMeta = { kind: "artifact", artifactId: artifact.id, slug };
  const now = nowIso();

  if (existing) {
    db.prepare(
      "UPDATE project_graph_nodes SET label = ?, metadata = ?, updatedAt = ? WHERE id = ?",
    ).run(artifact.filename, JSON.stringify(metadata), now, existing.id);
    return { nodeId: existing.id, created: false };
  }

  const id = crypto.randomUUID();
  db.prepare(
    `INSERT INTO project_graph_nodes (id, projectId, label, type, description, x, y, metadata, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    artifact.projectId,
    artifact.filename,
    ARTIFACT_NODE_TYPE,
    null,
    null,
    null,
    JSON.stringify(metadata),
    now,
    now,
  );
  // Not embedded for knowledge search: mirror nodes duplicate the artifact,
  // which is already indexed on its own. They are excluded from indexing/stats
  // (see knowledge route's MIRROR_NODE_EXCLUSION).
  return { nodeId: id, created: true };
}

function findArtifactNode(
  db: DatabaseHandle,
  projectId: string,
  artifactId: string,
): NodeRow | undefined {
  // metadata is JSON; match on the embedded artifactId. LIKE is a cheap
  // pre-filter; we still confirm via JSON parse to avoid false positives.
  const rows = db
    .prepare("SELECT * FROM project_graph_nodes WHERE projectId = ? AND metadata LIKE ?")
    .all(projectId, `%"artifactId":"${artifactId}"%`) as NodeRow[];
  for (const row of rows) {
    const meta = parseMeta(row.metadata);
    if (meta?.kind === "artifact" && meta.artifactId === artifactId) return row;
  }
  return undefined;
}

function parseMeta(raw: string): ArtifactNodeMeta | null {
  try {
    const obj = JSON.parse(raw || "{}") as Partial<ArtifactNodeMeta>;
    if (obj && obj.kind === "artifact" && typeof obj.artifactId === "string") {
      return { kind: "artifact", artifactId: obj.artifactId, slug: obj.slug ?? "" };
    }
  } catch {
    /* ignore malformed metadata */
  }
  return null;
}

/**
 * Resolve a raw target to a target artifact within the SAME project.
 * Precedence: exact filename-slug match, then graph-node label match.
 * Ties broken by most-recently-updated (logged). Returns null if unresolved
 * or if the target looks like a filesystem path (never escapes project scope).
 */
export function resolveTarget(
  db: DatabaseHandle,
  projectId: string,
  rawTarget: string,
  excludeArtifactId?: string,
): ArtifactRow | null {
  if (isEscapingTarget(rawTarget)) return null;
  const slug = slugify(rawTarget);
  if (!slug) return null;

  const artifacts = db
    .prepare("SELECT id, projectId, filename, updatedAt FROM project_artifacts WHERE projectId = ?")
    .all(projectId) as ArtifactRow[];

  // 1) exact filename-slug match
  const bySlug = artifacts
    .filter((a) => a.id !== excludeArtifactId && slugify(a.filename) === slug)
    .sort(byUpdatedDesc);
  if (bySlug.length > 0) {
    if (bySlug.length > 1) {
      log(
        "info",
        "server",
        `wikilink "${rawTarget}" matched ${bySlug.length} filenames; picked most-recent ${bySlug[0].id}`,
      );
    }
    return bySlug[0];
  }

  // 2) graph-node label match → map node back to its mirrored artifact
  const nodes = db
    .prepare("SELECT * FROM project_graph_nodes WHERE projectId = ?")
    .all(projectId) as NodeRow[];
  const labelMatches: ArtifactRow[] = [];
  for (const node of nodes) {
    if (slugify(node.label) !== slug) continue;
    const meta = parseMeta(node.metadata);
    if (!meta) continue;
    const art = artifacts.find((a) => a.id === meta.artifactId && a.id !== excludeArtifactId);
    if (art) labelMatches.push(art);
  }
  const byLabel = labelMatches.sort(byUpdatedDesc);
  if (byLabel.length > 0) {
    if (byLabel.length > 1) {
      log(
        "info",
        "server",
        `wikilink "${rawTarget}" matched ${byLabel.length} node labels; picked most-recent ${byLabel[0].id}`,
      );
    }
    return byLabel[0];
  }

  return null;
}

function byUpdatedDesc(a: ArtifactRow, b: ArtifactRow): number {
  return a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0;
}

/** Idempotent upsert of one wikilink edge. Returns the edge id. */
function upsertWikilinkEdge(
  db: DatabaseHandle,
  projectId: string,
  sourceNodeId: string,
  targetNodeId: string,
): string {
  const existing = db
    .prepare(
      "SELECT id FROM project_graph_edges WHERE projectId = ? AND sourceNodeId = ? AND targetNodeId = ? AND type = 'wikilink'",
    )
    .get(projectId, sourceNodeId, targetNodeId) as { id: string } | undefined;
  if (existing) return existing.id;

  const id = crypto.randomUUID();
  // UNIQUE(projectId, sourceNodeId, targetNodeId, type) makes this safe under races.
  db.prepare(
    `INSERT OR IGNORE INTO project_graph_edges (id, projectId, sourceNodeId, targetNodeId, label, type, createdAt)
     VALUES (?, ?, ?, ?, ?, 'wikilink', ?)`,
  ).run(id, projectId, sourceNodeId, targetNodeId, "wikilink", nowIso());

  const row = db
    .prepare(
      "SELECT id FROM project_graph_edges WHERE projectId = ? AND sourceNodeId = ? AND targetNodeId = ? AND type = 'wikilink'",
    )
    .get(projectId, sourceNodeId, targetNodeId) as { id: string };
  return row.id;
}

function recordPending(
  db: DatabaseHandle,
  projectId: string,
  sourceArtifactId: string,
  rawTarget: string,
): void {
  db.prepare(
    `INSERT OR IGNORE INTO artifact_pending_links (id, projectId, sourceArtifactId, rawTarget, createdAt)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(crypto.randomUUID(), projectId, sourceArtifactId, rawTarget, nowIso());
}

/**
 * Synchronously (within the request) parse `markdown` for [[targets]], mirror
 * the source artifact to a node, upsert resolved wikilink edges, and park
 * unresolved targets in pending-links. Replaces this artifact's previous
 * wikilink edges + pending rows so re-saving with changed content is clean and
 * idempotent. Returns the per-link outcome.
 */
export function syncArtifactWikilinks(
  db: DatabaseHandle,
  artifact: ArtifactRow,
  markdown: string,
): SyncResult {
  const { nodeId } = mirrorArtifactToNode(db, artifact);
  const targets = parseWikilinks(markdown);

  return db.transaction(() => {
    // Clear this source's prior wikilink edges + pending rows; re-derive fresh.
    db.prepare(
      "DELETE FROM project_graph_edges WHERE projectId = ? AND sourceNodeId = ? AND type = 'wikilink'",
    ).run(artifact.projectId, nodeId);
    db.prepare("DELETE FROM artifact_pending_links WHERE sourceArtifactId = ?").run(artifact.id);

    const resolved: ResolvedLink[] = [];
    const unresolved: string[] = [];

    for (const rawTarget of targets) {
      const target = resolveTarget(db, artifact.projectId, rawTarget, artifact.id);
      if (!target) {
        recordPending(db, artifact.projectId, artifact.id, rawTarget);
        unresolved.push(rawTarget);
        continue;
      }
      const { nodeId: targetNodeId } = mirrorArtifactToNode(db, target);
      const edgeId = upsertWikilinkEdge(db, artifact.projectId, nodeId, targetNodeId);
      resolved.push({
        rawTarget,
        edgeId,
        targetArtifactId: target.id,
        targetNodeId,
        targetFilename: target.filename,
      });
    }

    return { nodeId, resolved, unresolved };
  })();
}

/**
 * Re-resolve project-wide pending links that might now point at `artifact`
 * (newly created or renamed). For each matching pending row, upsert the edge
 * and clear the pending row. Called after an artifact is created/renamed so
 * previously-dangling refs heal.
 */
export function reresolvePendingForArtifact(db: DatabaseHandle, artifact: ArtifactRow): void {
  const targetSlug = slugify(artifact.filename);
  if (!targetSlug) return;
  const { nodeId: targetNodeId } = mirrorArtifactToNode(db, artifact);

  const pending = db
    .prepare("SELECT * FROM artifact_pending_links WHERE projectId = ?")
    .all(artifact.projectId) as PendingRow[];

  db.transaction(() => {
    for (const row of pending) {
      if (row.sourceArtifactId === artifact.id) continue; // self-links never resolve
      if (isEscapingTarget(row.rawTarget)) continue;
      if (slugify(row.rawTarget) !== targetSlug) continue;

      const sourceNode = findArtifactNode(db, artifact.projectId, row.sourceArtifactId);
      if (!sourceNode) continue; // source vanished; leave pending row, harmless
      upsertWikilinkEdge(db, artifact.projectId, sourceNode.id, targetNodeId);
      db.prepare("DELETE FROM artifact_pending_links WHERE id = ?").run(row.id);
    }
  })();
}

/**
 * Remove the mirror node for a deleted artifact. The node's ON DELETE CASCADE
 * removes every edge that references it (inbound + outbound), so no edge can
 * reference a missing node id afterwards. Also drops this artifact's own
 * pending-links (cascade covers it too; explicit for clarity).
 */
export function removeArtifactMirror(
  db: DatabaseHandle,
  projectId: string,
  artifactId: string,
): void {
  const node = findArtifactNode(db, projectId, artifactId);
  db.transaction(() => {
    if (node) {
      db.prepare("DELETE FROM project_graph_nodes WHERE id = ?").run(node.id);
    }
    db.prepare("DELETE FROM artifact_pending_links WHERE sourceArtifactId = ?").run(artifactId);
  })();
}

export interface ArtifactLinks {
  artifactId: string;
  nodeId: string | null;
  outbound: {
    resolved: ResolvedLink[];
    unresolved: { rawTarget: string }[];
    resolvedCount: number;
    unresolvedCount: number;
  };
  inbound: {
    backlinks: {
      edgeId: string;
      sourceArtifactId: string | null;
      sourceNodeId: string;
      sourceLabel: string;
    }[];
    backlinkCount: number;
    unresolvedCount: number;
  };
}

/** Build the outbound-links + inbound-backlinks view for one artifact. */
export function getArtifactLinks(
  db: DatabaseHandle,
  projectId: string,
  artifactId: string,
): ArtifactLinks {
  const node = findArtifactNode(db, projectId, artifactId);
  const nodeId = node?.id ?? null;

  const resolved: ResolvedLink[] = [];
  if (nodeId) {
    const outEdges = db
      .prepare(
        "SELECT * FROM project_graph_edges WHERE projectId = ? AND sourceNodeId = ? AND type = 'wikilink'",
      )
      .all(projectId, nodeId) as EdgeRow[];
    for (const edge of outEdges) {
      const targetNode = db
        .prepare("SELECT * FROM project_graph_nodes WHERE id = ?")
        .get(edge.targetNodeId) as NodeRow | undefined;
      const meta = targetNode ? parseMeta(targetNode.metadata) : null;
      resolved.push({
        rawTarget: targetNode?.label ?? "",
        edgeId: edge.id,
        targetArtifactId: meta?.artifactId ?? "",
        targetNodeId: edge.targetNodeId,
        targetFilename: targetNode?.label ?? "",
      });
    }
  }

  const pending = db
    .prepare("SELECT rawTarget FROM artifact_pending_links WHERE sourceArtifactId = ?")
    .all(artifactId) as { rawTarget: string }[];

  const backlinks: ArtifactLinks["inbound"]["backlinks"] = [];
  if (nodeId) {
    const inEdges = db
      .prepare(
        "SELECT * FROM project_graph_edges WHERE projectId = ? AND targetNodeId = ? AND type = 'wikilink'",
      )
      .all(projectId, nodeId) as EdgeRow[];
    for (const edge of inEdges) {
      const sourceNode = db
        .prepare("SELECT * FROM project_graph_nodes WHERE id = ?")
        .get(edge.sourceNodeId) as NodeRow | undefined;
      const meta = sourceNode ? parseMeta(sourceNode.metadata) : null;
      backlinks.push({
        edgeId: edge.id,
        sourceArtifactId: meta?.artifactId ?? null,
        sourceNodeId: edge.sourceNodeId,
        sourceLabel: sourceNode?.label ?? "",
      });
    }
  }

  // Inbound "unresolved" = project pending rows that name this artifact but
  // somehow weren't healed (e.g. source node missing). Usually 0.
  const slug = node ? slugify(node.label) : "";
  const inboundUnresolved = slug
    ? (
        db
          .prepare(
            "SELECT rawTarget, sourceArtifactId FROM artifact_pending_links WHERE projectId = ?",
          )
          .all(projectId) as { rawTarget: string; sourceArtifactId: string }[]
      ).filter((p) => p.sourceArtifactId !== artifactId && slugify(p.rawTarget) === slug).length
    : 0;

  return {
    artifactId,
    nodeId,
    outbound: {
      resolved,
      unresolved: pending,
      resolvedCount: resolved.length,
      unresolvedCount: pending.length,
    },
    inbound: {
      backlinks,
      backlinkCount: backlinks.length,
      unresolvedCount: inboundUnresolved,
    },
  };
}
