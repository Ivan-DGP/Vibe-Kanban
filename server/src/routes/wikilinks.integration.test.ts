import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { buildApp } from "../app";
import { getDb } from "../db";
import type { ArtifactLinksResponse } from "@vibe-kanban/shared";

let app: Awaited<ReturnType<typeof buildApp>>;
let projectId: string;

async function createArtifact(filename: string, content: string): Promise<string> {
  const res = await app.inject({
    method: "POST",
    url: `/api/projects/${projectId}/artifacts`,
    headers: { "Content-Type": "application/json" },
    payload: { filename, content },
  });
  expect(res.statusCode).toBe(200);
  return res.json().id as string;
}

async function getLinks(artifactId: string): Promise<ArtifactLinksResponse> {
  const res = await app.inject({
    method: "GET",
    url: `/api/projects/${projectId}/artifacts/${artifactId}/links`,
  });
  expect(res.statusCode).toBe(200);
  return res.json() as ArtifactLinksResponse;
}

function nodeIdFor(artifactId: string): string | undefined {
  const rows = getDb()
    .prepare("SELECT id, metadata FROM project_graph_nodes WHERE projectId = ?")
    .all(projectId) as { id: string; metadata: string }[];
  for (const r of rows) {
    try {
      const meta = JSON.parse(r.metadata || "{}") as { kind?: string; artifactId?: string };
      if (meta.kind === "artifact" && meta.artifactId === artifactId) return r.id;
    } catch {
      /* skip */
    }
  }
  return undefined;
}

function wikilinkEdges(): { id: string; sourceNodeId: string; targetNodeId: string }[] {
  return getDb()
    .prepare(
      "SELECT id, sourceNodeId, targetNodeId FROM project_graph_edges WHERE projectId = ? AND type = 'wikilink'",
    )
    .all(projectId) as { id: string; sourceNodeId: string; targetNodeId: string }[];
}

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
  const res = await app.inject({
    method: "POST",
    url: "/api/projects",
    headers: { "Content-Type": "application/json" },
    payload: { name: `Wikilink Test ${Date.now()}`, path: `/tmp/wikilink-test-${Date.now()}` },
  });
  projectId = res.json().id;
});

afterAll(async () => {
  if (projectId) {
    await app.inject({ method: "DELETE", url: `/api/projects/${projectId}` });
  }
});

describe("Wikilinks API", () => {
  // Criterion 1+2+3 (resolve)
  test("resolve → edge A→B exists, A.outbound has B, B.inbound has A", async () => {
    const bId = await createArtifact("target-doc.md", "# Target");
    const aId = await createArtifact("source-doc.md", "see [[target-doc]] and [[Target Doc]]");

    const aNode = nodeIdFor(aId);
    const bNode = nodeIdFor(bId);
    expect(aNode).toBeTruthy();
    expect(bNode).toBeTruthy();

    // Edge A→B exists immediately (queryable within the request lifecycle)
    const edges = wikilinkEdges().filter(
      (e) => e.sourceNodeId === aNode && e.targetNodeId === bNode,
    );
    expect(edges.length).toBe(1);

    const aLinks = await getLinks(aId);
    expect(aLinks.outbound.resolvedCount).toBe(1);
    expect(aLinks.outbound.resolved.some((r) => r.targetArtifactId === bId)).toBe(true);

    const bLinks = await getLinks(bId);
    expect(bLinks.inbound.backlinkCount).toBe(1);
    expect(bLinks.inbound.backlinks.some((bl) => bl.sourceArtifactId === aId)).toBe(true);
  });

  // Criterion 1+3 (unresolved → pending-links, no edge, no throw)
  test("unresolved → recorded in pending-links, no edge, no throw", async () => {
    const aId = await createArtifact("orphan-source.md", "ref [[does-not-exist-anywhere]]");
    const aLinks = await getLinks(aId);
    expect(aLinks.outbound.resolvedCount).toBe(0);
    expect(aLinks.outbound.unresolvedCount).toBe(1);

    const pending = getDb()
      .prepare("SELECT COUNT(*) AS c FROM artifact_pending_links WHERE sourceArtifactId = ?")
      .get(aId) as { c: number };
    expect(pending.c).toBe(1);

    const aNode = nodeIdFor(aId);
    const edges = wikilinkEdges().filter((e) => e.sourceNodeId === aNode);
    expect(edges.length).toBe(0);
  });

  // Criterion 3 (idempotent re-save)
  test("re-save same content → no duplicate edge", async () => {
    const bId = await createArtifact("idem-target.md", "# B");
    const aId = await createArtifact("idem-source.md", "link [[idem-target]]");

    const aNode = nodeIdFor(aId);
    const beforeCount = wikilinkEdges().filter((e) => e.sourceNodeId === aNode).length;
    expect(beforeCount).toBe(1);

    // Re-save identical content via PATCH
    const res = await app.inject({
      method: "PATCH",
      url: `/api/projects/${projectId}/artifacts/${aId}`,
      headers: { "Content-Type": "application/json" },
      payload: { content: "link [[idem-target]]" },
    });
    expect(res.statusCode).toBe(200);

    const afterCount = wikilinkEdges().filter((e) => e.sourceNodeId === aNode).length;
    expect(afterCount).toBe(1);
    void bId;
  });

  // Criterion 1 (path-escape never resolves, stays in project scope)
  test("[[../../x]] → unresolved, never escapes project scope", async () => {
    // Even if a real file-like target exists by basename, the path form must not resolve.
    await createArtifact("x.md", "# X file that path-target must NOT reach");
    const aId = await createArtifact("escape-source.md", "danger [[../../x]] and [[../x]]");

    const aLinks = await getLinks(aId);
    expect(aLinks.outbound.resolvedCount).toBe(0);
    expect(aLinks.outbound.unresolvedCount).toBe(2);

    const aNode = nodeIdFor(aId);
    const edges = wikilinkEdges().filter((e) => e.sourceNodeId === aNode);
    expect(edges.length).toBe(0);
  });

  // Criterion 5 (rename target → inbound edges re-resolve, zero dangling)
  test("rename target → inbound edges re-resolve, zero dangling", async () => {
    const tId = await createArtifact("rename-target.md", "# T");
    const sId = await createArtifact("rename-src.md", "points to [[renamed-target]]");

    // Initially unresolved (no artifact named "renamed-target")
    let sLinks = await getLinks(sId);
    expect(sLinks.outbound.resolvedCount).toBe(0);
    expect(sLinks.outbound.unresolvedCount).toBe(1);

    // Rename the target to match the pending ref
    const res = await app.inject({
      method: "PATCH",
      url: `/api/projects/${projectId}/artifacts/${tId}`,
      headers: { "Content-Type": "application/json" },
      payload: { filename: "renamed-target.md" },
    });
    expect(res.statusCode).toBe(200);

    // Inbound ref now resolves to the renamed target
    sLinks = await getLinks(sId);
    expect(sLinks.outbound.resolvedCount).toBe(1);
    expect(sLinks.outbound.resolved[0].targetArtifactId).toBe(tId);

    const tLinks = await getLinks(tId);
    expect(tLinks.inbound.backlinkCount).toBe(1);

    // Zero dangling: every wikilink edge references existing nodes
    expectNoDanglingEdges();
  });

  // Criterion 5 (delete target → zero edges reference a missing node)
  test("delete target → wikilink edge removed, zero edges reference a missing node", async () => {
    const tId = await createArtifact("del-target.md", "# D");
    const sId = await createArtifact("del-src.md", "to [[del-target]]");

    let sLinks = await getLinks(sId);
    expect(sLinks.outbound.resolvedCount).toBe(1);

    const tNode = nodeIdFor(tId);
    expect(wikilinkEdges().some((e) => e.targetNodeId === tNode)).toBe(true);

    const del = await app.inject({
      method: "DELETE",
      url: `/api/projects/${projectId}/artifacts/${tId}`,
    });
    expect(del.statusCode).toBe(204);

    // Edge gone; no wikilink edge references the deleted node
    expect(wikilinkEdges().some((e) => e.targetNodeId === tNode)).toBe(false);
    expectNoDanglingEdges();

    sLinks = await getLinks(sId);
    expect(sLinks.outbound.resolvedCount).toBe(0);
  });

  // Criterion 4 (response shape + counts)
  test("links endpoint returns outbound + inbound with resolved/unresolved counts", async () => {
    const t1 = await createArtifact("shape-t1.md", "# T1");
    const aId = await createArtifact("shape-a.md", "link [[shape-t1]] and [[missing-thing]]");

    const links = await getLinks(aId);
    expect(links.artifactId).toBe(aId);
    expect(typeof links.nodeId).toBe("string");
    expect(links.outbound.resolvedCount).toBe(1);
    expect(links.outbound.unresolvedCount).toBe(1);
    expect(links.outbound.resolved[0].targetArtifactId).toBe(t1);
    expect(links.outbound.unresolved[0].rawTarget).toBe("missing-thing");
    expect(links.inbound.backlinkCount).toBe(0);

    const t1Links = await getLinks(t1);
    expect(t1Links.inbound.backlinkCount).toBe(1);
    expect(t1Links.inbound.backlinks[0].sourceArtifactId).toBe(aId);
  });

  test("links endpoint 404 for unknown artifact", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/projects/${projectId}/artifacts/nope/links`,
    });
    expect(res.statusCode).toBe(404);
  });

  // Precedence: filename-slug match beats graph-node label match.
  // Seed a real artifact whose filename slugifies to "prec-foo" (the slug
  // winner) plus a SEPARATE artifact whose mirror node's label is mutated to
  // "prec-foo" (a label-only match that is NOT the slug winner's mirror). The
  // label-only artifact is made strictly NEWER so that if precedence were
  // (wrongly) ignored, the newer label match would win. Correct behavior:
  // [[prec-foo]] must resolve to the filename-slug winner's mirror node.
  test("precedence → filename-slug match beats node-label match", async () => {
    // Slug winner: filename slugifies to "prec-foo".
    const winnerId = await createArtifact("prec-foo.md", "# slug winner");
    const winnerNode = nodeIdFor(winnerId);
    expect(winnerNode).toBeTruthy();

    // Label-only decoy: a different artifact (filename slug "prec-decoy") whose
    // mirror node label we mutate to "prec-foo" and bump strictly newer.
    const decoyId = await createArtifact("prec-decoy.md", "# label decoy");
    const decoyNode = nodeIdFor(decoyId);
    expect(decoyNode).toBeTruthy();
    expect(decoyNode).not.toBe(winnerNode);
    getDb()
      .prepare("UPDATE project_graph_nodes SET label = ?, updatedAt = ? WHERE id = ?")
      .run("prec-foo", "2999-01-01T00:00:00.000Z", decoyNode as string);
    // Make the decoy ARTIFACT strictly newer too, so a broken tie-break that
    // merged both candidate sets could not pick the winner by recency.
    getDb()
      .prepare("UPDATE project_artifacts SET updatedAt = ? WHERE id = ?")
      .run("2999-01-01T00:00:00.000Z", decoyId);

    const srcId = await createArtifact("prec-src.md", "ref [[prec-foo]]");
    const srcNode = nodeIdFor(srcId);
    expect(srcNode).toBeTruthy();

    const edges = wikilinkEdges().filter((e) => e.sourceNodeId === srcNode);
    expect(edges.length).toBe(1);
    // Resolved edge must target the filename-slug winner's mirror node, NOT the
    // label-matched decoy node.
    expect(edges[0].targetNodeId).toBe(winnerNode as string);
    expect(edges[0].targetNodeId).not.toBe(decoyNode as string);

    const srcLinks = await getLinks(srcId);
    expect(srcLinks.outbound.resolvedCount).toBe(1);
    expect(srcLinks.outbound.resolved[0].targetArtifactId).toBe(winnerId);
  });

  // Tie-break: when two artifacts in the same project share a filename-slug
  // ("tb-dup"), [[tb-dup]] resolves to the MOST-RECENTLY-UPDATED duplicate's
  // mirror node. Both mirrors exist; only updatedAt differs.
  test("tie-break → most-recently-updated duplicate wins", async () => {
    const olderId = await createArtifact("tb-dup.md", "# older dup");
    const newerId = await createArtifact("tb-dup.md", "# newer dup");
    expect(olderId).not.toBe(newerId);

    const olderNode = nodeIdFor(olderId);
    const newerNode = nodeIdFor(newerId);
    expect(olderNode).toBeTruthy();
    expect(newerNode).toBeTruthy();
    expect(olderNode).not.toBe(newerNode);

    // Force deterministic ordering on the column the tie-break reads (updatedAt):
    // older strictly precedes newer regardless of insertion timing.
    getDb()
      .prepare("UPDATE project_artifacts SET updatedAt = ? WHERE id = ?")
      .run("2000-01-01T00:00:00.000Z", olderId);
    getDb()
      .prepare("UPDATE project_artifacts SET updatedAt = ? WHERE id = ?")
      .run("2000-01-02T00:00:00.000Z", newerId);

    const srcId = await createArtifact("tb-src.md", "ref [[tb-dup]]");
    const srcNode = nodeIdFor(srcId);
    expect(srcNode).toBeTruthy();

    const edges = wikilinkEdges().filter((e) => e.sourceNodeId === srcNode);
    expect(edges.length).toBe(1);
    // The single resolved edge targets the NEWER duplicate's mirror node.
    expect(edges[0].targetNodeId).toBe(newerNode as string);
    expect(edges[0].targetNodeId).not.toBe(olderNode as string);

    const srcLinks = await getLinks(srcId);
    expect(srcLinks.outbound.resolvedCount).toBe(1);
    expect(srcLinks.outbound.resolved[0].targetArtifactId).toBe(newerId);
  });
});

function expectNoDanglingEdges(): void {
  const dangling = getDb()
    .prepare(
      `SELECT COUNT(*) AS c FROM project_graph_edges e
       WHERE e.projectId = ?
         AND (e.sourceNodeId NOT IN (SELECT id FROM project_graph_nodes)
              OR e.targetNodeId NOT IN (SELECT id FROM project_graph_nodes))`,
    )
    .get(projectId) as { c: number };
  expect(dangling.c).toBe(0);
}
