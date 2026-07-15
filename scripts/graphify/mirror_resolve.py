#!/usr/bin/env python3
"""Mirror the monorepo src trees into a temp dir with imports resolved to relative
paths so graphify's relative-only AST extractor captures the real graph.
  dest/client  <- client/src   (@/ -> relative, @vibe-kanban/shared -> ../shared/types)
  dest/server  <- server/src
  dest/shared  <- shared/src
Usage: mirror_resolve.py <repo_root> <dest_root>
"""
import sys, re, shutil, os
from pathlib import Path

repo = Path(sys.argv[1]).resolve()
dest = Path(sys.argv[2]).resolve()
if dest.exists():
    shutil.rmtree(dest)

pkgs = {"client": repo / "client/src", "server": repo / "server/src", "shared": repo / "shared/src"}
for name, srcdir in pkgs.items():
    d = dest / name
    shutil.copytree(srcdir, d, ignore=shutil.ignore_patterns("graphify-out", "node_modules"))

alias_re = re.compile(r"""(from\s+|import\s*\(\s*)(['"])(@/[^'"]+|@vibe-kanban/shared[^'"]*)(['"])""")
exts = {".ts", ".tsx", ".js", ".jsx"}
shared_types = dest / "shared" / "types.ts"

total = 0
for name in pkgs:
    pkg_src = dest / name  # @/ within a package maps here
    for f in pkg_src.rglob("*"):
        if f.suffix not in exts or not f.is_file():
            continue
        text = f.read_text(encoding="utf-8", errors="ignore")
        def repl(m):
            global total
            pre, q1, spec, q2 = m.groups()
            if spec.startswith("@/"):
                target = pkg_src / spec[2:]
            else:  # @vibe-kanban/shared[...] -> shared/types.ts
                target = shared_types
            rel = os.path.relpath(target, f.parent)
            if not rel.startswith("."):
                rel = "./" + rel
            total += 1
            return f"{pre}{q1}{rel}{q2}"
        new = alias_re.sub(repl, text)
        if new != text:
            f.write_text(new, encoding="utf-8")
print(f"resolved {total} alias imports into {dest}")
