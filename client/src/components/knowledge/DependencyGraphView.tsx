import { useRef, useEffect, useMemo } from "react";
import type { DepGraphNode, DepGraphEdge } from "@vibe-kanban/shared";

// Read-only canvas force-graph for a project's import/dependency structure.
// Mirrors the visual style of the knowledge GraphTab (dark canvas, glow on
// hover, curved edges) but is tuned for hundreds of nodes: O(edges) attraction,
// degree-scaled node size, group colouring, pan / zoom / drag.

interface SimNode extends DepGraphNode {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

const REPULSION = 2600;
const ATTRACTION = 0.012;
const CENTER_FORCE = 0.004;
const DAMPING = 0.75;
const COOLING_DECAY = 0.992;
const VELOCITY_THRESHOLD = 0.08;

// Brand-neutral categorical palette (assigned per group, stable by sort order).
const PALETTE = [
  "#60a5fa",
  "#f472b6",
  "#34d399",
  "#fbbf24",
  "#a78bfa",
  "#22d3ee",
  "#fb923c",
  "#4ade80",
  "#f87171",
  "#c084fc",
  "#2dd4bf",
  "#e879f9",
];

function radius(degree: number): number {
  return 4 + Math.sqrt(degree) * 1.6;
}

interface Props {
  nodes: DepGraphNode[];
  edges: DepGraphEdge[];
}

export default function DependencyGraphView({ nodes, edges }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const animRef = useRef(0);

  const nodesRef = useRef<SimNode[]>([]);
  const linksRef = useRef<{ s: SimNode; t: SimNode }[]>([]);
  const coolingRef = useRef(1);
  const viewRef = useRef({ x: 0, y: 0, k: 1 });
  const dragRef = useRef<SimNode | null>(null);
  const panRef = useRef<{ x: number; y: number } | null>(null);
  const pointerRef = useRef({ x: 0, y: 0, down: false });
  const hoverRef = useRef<SimNode | null>(null);

  const colorFor = useMemo(() => {
    const groups = [...new Set(nodes.map((n) => n.group))].sort();
    const map = new Map<string, string>();
    groups.forEach((g, i) => map.set(g, PALETTE[i % PALETTE.length]));
    return (g: string) => map.get(g) ?? "#94a3b8";
  }, [nodes]);

  const legend = useMemo(() => {
    const counts = new Map<string, number>();
    for (const n of nodes) counts.set(n.group, (counts.get(n.group) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [nodes]);

  // (Re)build the simulation whenever the graph data changes.
  useEffect(() => {
    const w = containerRef.current?.clientWidth ?? 800;
    const h = containerRef.current?.clientHeight ?? 600;
    const byId = new Map<string, SimNode>();
    const sim: SimNode[] = nodes.map((n) => {
      const angle = Math.random() * Math.PI * 2;
      const r = Math.random() * Math.min(w, h) * 0.4;
      const node: SimNode = {
        ...n,
        x: w / 2 + Math.cos(angle) * r,
        y: h / 2 + Math.sin(angle) * r,
        vx: 0,
        vy: 0,
      };
      byId.set(n.id, node);
      return node;
    });
    nodesRef.current = sim;
    linksRef.current = edges
      .map((e) => ({ s: byId.get(e.source), t: byId.get(e.target) }))
      .filter((l): l is { s: SimNode; t: SimNode } => !!l.s && !!l.t);
    coolingRef.current = 1;
    viewRef.current = { x: 0, y: 0, k: 1 };
  }, [nodes, edges]);

  // Simulation + render loop (reads refs; never re-subscribes).
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const tick = () => {
      const w = container.clientWidth;
      const h = container.clientHeight;
      const dpr = window.devicePixelRatio || 1;
      if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
        canvas.width = w * dpr;
        canvas.height = h * dpr;
        canvas.style.width = `${w}px`;
        canvas.style.height = `${h}px`;
      }

      const ns = nodesRef.current;
      const ls = linksRef.current;
      const cooling = coolingRef.current;
      const drag = dragRef.current;

      if (cooling > 0.02) {
        // Repulsion (O(n^2)) + center gravity
        for (let i = 0; i < ns.length; i++) {
          const a = ns[i];
          if (a === drag) continue;
          let fx = (w / 2 - a.x) * CENTER_FORCE;
          let fy = (h / 2 - a.y) * CENTER_FORCE;
          for (let j = 0; j < ns.length; j++) {
            if (i === j) continue;
            const b = ns[j];
            const dx = a.x - b.x;
            const dy = a.y - b.y;
            const d2 = dx * dx + dy * dy || 1;
            const f = REPULSION / d2;
            const d = Math.sqrt(d2);
            fx += (dx / d) * f;
            fy += (dy / d) * f;
          }
          a.vx = (a.vx + fx) * DAMPING * cooling;
          a.vy = (a.vy + fy) * DAMPING * cooling;
        }
        // Attraction along edges (O(edges))
        for (const { s, t } of ls) {
          const dx = t.x - s.x;
          const dy = t.y - s.y;
          if (s !== drag) {
            s.vx += dx * ATTRACTION * cooling;
            s.vy += dy * ATTRACTION * cooling;
          }
          if (t !== drag) {
            t.vx -= dx * ATTRACTION * cooling;
            t.vy -= dy * ATTRACTION * cooling;
          }
        }
        for (const n of ns) {
          if (n === drag) continue;
          if (Math.abs(n.vx) < VELOCITY_THRESHOLD) n.vx = 0;
          if (Math.abs(n.vy) < VELOCITY_THRESHOLD) n.vy = 0;
          n.x += n.vx;
          n.y += n.vy;
        }
        coolingRef.current *= COOLING_DECAY;
      }

      // ── draw ──
      const view = viewRef.current;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      ctx.translate(view.x, view.y);
      ctx.scale(view.k, view.k);

      const hovered = hoverRef.current;

      // edges
      ctx.lineWidth = 0.6 / view.k;
      ctx.strokeStyle = "rgba(148, 163, 184, 0.22)";
      ctx.beginPath();
      for (const { s, t } of ls) {
        ctx.moveTo(s.x, s.y);
        ctx.lineTo(t.x, t.y);
      }
      ctx.stroke();

      // cycle edges (both endpoints in an import cycle) — flagged red
      ctx.strokeStyle = "rgba(248, 113, 113, 0.85)";
      ctx.lineWidth = 1.6 / view.k;
      ctx.beginPath();
      for (const { s, t } of ls) {
        if (s.inCycle && t.inCycle) {
          ctx.moveTo(s.x, s.y);
          ctx.lineTo(t.x, t.y);
        }
      }
      ctx.stroke();

      // highlight hovered node's edges
      if (hovered) {
        ctx.strokeStyle = colorFor(hovered.group);
        ctx.lineWidth = 1.2 / view.k;
        ctx.beginPath();
        for (const { s, t } of ls) {
          if (s === hovered || t === hovered) {
            ctx.moveTo(s.x, s.y);
            ctx.lineTo(t.x, t.y);
          }
        }
        ctx.stroke();
      }

      // nodes
      for (const n of ns) {
        const r = radius(n.degree);
        const isHot = n === hovered;
        const color = colorFor(n.group);
        if (isHot) {
          ctx.shadowColor = color;
          ctx.shadowBlur = 14;
        }
        ctx.fillStyle = color;
        ctx.globalAlpha = hovered && !isHot ? 0.5 : 0.9;
        ctx.beginPath();
        ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.shadowBlur = 0;

        // red ring for nodes caught in an import cycle
        if (n.inCycle) {
          ctx.strokeStyle = "#f87171";
          ctx.lineWidth = 1.6 / view.k;
          ctx.beginPath();
          ctx.arc(n.x, n.y, r + 2 / view.k, 0, Math.PI * 2);
          ctx.stroke();
        }
      }

      // labels: hubs always, plus the hovered node's full path
      ctx.fillStyle = "#e5e7eb";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.font = `${11 / view.k}px sans-serif`;
      for (const n of ns) {
        if (n.degree >= 12 && n !== hovered) {
          ctx.fillText(n.label, n.x, n.y - radius(n.degree) - 5 / view.k);
        }
      }
      if (hovered) {
        ctx.font = `${12 / view.k}px sans-serif`;
        ctx.fillStyle = "#fff";
        const pad = radius(hovered.degree) + 8 / view.k;
        ctx.fillText(`${hovered.id}  ·  deg ${hovered.degree}`, hovered.x, hovered.y - pad);
      }

      animRef.current = requestAnimationFrame(tick);
    };

    animRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animRef.current);
  }, [colorFor]);

  // ── pointer interaction (pan / zoom / node drag / hover) ──
  function toWorld(clientX: number, clientY: number) {
    const rect = canvasRef.current!.getBoundingClientRect();
    const v = viewRef.current;
    return { x: (clientX - rect.left - v.x) / v.k, y: (clientY - rect.top - v.y) / v.k };
  }
  function pick(clientX: number, clientY: number): SimNode | null {
    const { x, y } = toWorld(clientX, clientY);
    let hit: SimNode | null = null;
    for (const n of nodesRef.current) {
      const r = radius(n.degree) + 3;
      if ((n.x - x) ** 2 + (n.y - y) ** 2 <= r * r) hit = n; // last match = topmost
    }
    return hit;
  }

  return (
    <div
      ref={containerRef}
      className="relative h-full w-full overflow-hidden rounded-lg bg-[#0b0f17]"
    >
      <canvas
        ref={canvasRef}
        className="block h-full w-full cursor-grab active:cursor-grabbing"
        onPointerDown={(e) => {
          (e.target as HTMLElement).setPointerCapture(e.pointerId);
          pointerRef.current.down = true;
          const node = pick(e.clientX, e.clientY);
          if (node) {
            dragRef.current = node;
            coolingRef.current = Math.max(coolingRef.current, 0.3);
          } else {
            panRef.current = { x: e.clientX - viewRef.current.x, y: e.clientY - viewRef.current.y };
          }
        }}
        onPointerMove={(e) => {
          if (dragRef.current) {
            const p = toWorld(e.clientX, e.clientY);
            dragRef.current.x = p.x;
            dragRef.current.y = p.y;
            dragRef.current.vx = 0;
            dragRef.current.vy = 0;
          } else if (panRef.current) {
            viewRef.current.x = e.clientX - panRef.current.x;
            viewRef.current.y = e.clientY - panRef.current.y;
          } else {
            hoverRef.current = pick(e.clientX, e.clientY);
          }
        }}
        onPointerUp={() => {
          dragRef.current = null;
          panRef.current = null;
          pointerRef.current.down = false;
        }}
        onPointerLeave={() => {
          hoverRef.current = null;
        }}
        onWheel={(e) => {
          const v = viewRef.current;
          const rect = canvasRef.current!.getBoundingClientRect();
          const mx = e.clientX - rect.left;
          const my = e.clientY - rect.top;
          const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
          const k = Math.min(4, Math.max(0.15, v.k * factor));
          v.x = mx - ((mx - v.x) * k) / v.k;
          v.y = my - ((my - v.y) * k) / v.k;
          v.k = k;
        }}
      />
      {/* legend */}
      <div className="pointer-events-none absolute bottom-2 left-2 flex flex-wrap gap-x-3 gap-y-1 rounded-md bg-black/40 px-2.5 py-1.5 text-[11px] backdrop-blur">
        {legend.map(([group, count]) => (
          <span key={group} className="flex items-center gap-1.5 text-slate-200">
            <span
              className="inline-block h-2 w-2 rounded-full"
              style={{ background: colorFor(group) }}
            />
            {group} <span className="text-slate-400">{count}</span>
          </span>
        ))}
      </div>
    </div>
  );
}
