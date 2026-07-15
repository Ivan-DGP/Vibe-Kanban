#!/usr/bin/env python3
"""graphify AST import/dependency-graph driver (Linux/bash adaptation of /graphify).
Usage: gfy_driver.py <out_dir> <input_path> [<input_path> ...]
"""
import sys, json, re
from pathlib import Path
from collections import Counter
from graphify.extract import collect_files, extract
from graphify.build import build_from_json
from graphify.cluster import cluster, score_all
from graphify.analyze import god_nodes, surprising_connections
from graphify.report import generate
from graphify.export import to_json
from graphify.exporters.html import to_html

out_dir = Path(sys.argv[1]); out_dir.mkdir(parents=True, exist_ok=True)
inputs = sys.argv[2:]

# collect code files across all inputs
files = []
for p in inputs:
    pth = Path(p)
    files.extend(collect_files(pth) if pth.is_dir() else [pth])
files = sorted(set(files))
print(f"[{out_dir.name}] {len(files)} code files")

extraction = extract(files)
print(f"[{out_dir.name}] AST: {len(extraction['nodes'])} nodes, {len(extraction['edges'])} edges")

# directed import graph if supported; fall back to undirected for robustness
try:
    G = build_from_json(extraction, directed=True)
except Exception as e:
    print(f"[{out_dir.name}] directed build failed ({e}); undirected"); G = build_from_json(extraction)

if G.number_of_nodes() == 0:
    print(f"[{out_dir.name}] ERROR: empty graph"); sys.exit(1)

communities = cluster(G)
cohesion = score_all(G, communities)
gods = god_nodes(G)
surprises = surprising_connections(G, communities)

# auto-label each community by most common top-2 path segments of member source files
def seg_label(members):
    segs = Counter()
    for nid in members:
        sf = G.nodes[nid].get("source_file", "") or ""
        parts = [x for x in re.split(r"[\\/]", sf) if x and x not in (".", "..")]
        # drop leading repo/package dirs, keep meaningful mid segments
        for s in parts[:-1][-3:]:
            segs[s] += 1
    common = [s for s, _ in segs.most_common(2)]
    return "/".join(common) if common else "misc"

labels = {cid: (seg_label(mem) if len(mem) >= 3 else f"Community {cid}") for cid, mem in communities.items()}

detection = {"total_files": len(files), "total_words": len(extraction["nodes"]) * 50,
             "needs_graph": True, "warning": None,
             "files": {"code": [str(f) for f in files], "document": [], "paper": []}}
tokens = {"input": 0, "output": 0}

report = generate(G, communities, cohesion, labels, gods, surprises, detection, tokens, str(out_dir))
(out_dir / "GRAPH_REPORT.md").write_text(report)
to_json(G, communities, str(out_dir / "graph.json"), community_labels=labels)
try:
    if G.number_of_nodes() <= 5000:
        to_html(G, communities, str(out_dir / "graph.html"), community_labels=labels)
        print(f"[{out_dir.name}] graph.html written")
except Exception as e:
    print(f"[{out_dir.name}] html export failed: {e}")

# compact summary for orchestration
summary = {
    "unit": out_dir.name, "files": len(files),
    "nodes": G.number_of_nodes(), "edges": G.number_of_edges(),
    "communities": len(communities),
    "labels": {str(k): v for k, v in labels.items()},
    "cohesion": {str(k): round(v, 3) for k, v in cohesion.items()},
    "god_nodes": [{"label": g.get("label"), "degree": g.get("degree"),
                   "source": g.get("source_file")} for g in gods[:10]],
    "surprises": surprises[:5],
}
(out_dir / "summary.json").write_text(json.dumps(summary, indent=2))
print(f"[{out_dir.name}] {G.number_of_nodes()} nodes, {G.number_of_edges()} edges, {len(communities)} communities")
