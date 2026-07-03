import { useState, useRef, useEffect, useCallback } from "react";
import {
  useGraph,
  useCreateGraphNode,
  useUpdateGraphNode,
  useDeleteGraphNode,
  useCreateGraphEdge,
  useDeleteGraphEdge,
  useConfirmGraphNode,
  useConfirmGraphEdge,
  useConfirmGraphSuggestions,
} from "@/hooks";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, Trash2, Link2, Unlink, Network, Check, CheckCheck, X } from "lucide-react";
import type { GraphNode, GraphEdge, GraphNodeType } from "@vibe-kanban/shared";

const NODE_COLORS: Record<GraphNodeType, string> = {
  concept: "#60a5fa", // blue
  system: "#a78bfa", // purple
  person: "#34d399", // green
  decision: "#fbbf24", // amber
  technology: "#22d3ee", // cyan
  risk: "#f87171", // red
};

const NODE_RADIUS = 24;

// Physics constants
const DAMPING = 0.7;
const REPULSION = 2000;
const ATTRACTION = 0.008;
const CENTER_FORCE = 0.005;
const VELOCITY_THRESHOLD = 0.1;
const COOLING_DECAY = 0.999;

interface GraphTabProps {
  projectId: string;
}

interface SimNode extends GraphNode {
  vx: number;
  vy: number;
}

export default function GraphTab({ projectId }: GraphTabProps) {
  const { data: graph, isLoading } = useGraph(projectId);
  const createNode = useCreateGraphNode(projectId);
  const updateNode = useUpdateGraphNode(projectId);
  const deleteNode = useDeleteGraphNode(projectId);
  const createEdge = useCreateGraphEdge(projectId);
  const deleteEdge = useDeleteGraphEdge(projectId);
  const confirmNode = useConfirmGraphNode(projectId);
  const confirmEdge = useConfirmGraphEdge(projectId);
  const confirmSuggestions = useConfirmGraphSuggestions(projectId);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const animRef = useRef<number>(0);

  // Simulation state lives in refs — mutated directly by the animation loop
  const nodesRef = useRef<SimNode[]>([]);
  const edgesRef = useRef<GraphEdge[]>([]);
  const coolingRef = useRef(1.0);

  // React state only for things that trigger re-renders
  const [nodes, setNodes] = useState<SimNode[]>([]);
  const [edges, setEdges] = useState<GraphEdge[]>([]);
  const [dragging, setDragging] = useState<string | null>(null);
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [linkingFrom, setLinkingFrom] = useState<string | null>(null);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);

  const draggingRef = useRef<string | null>(null);
  const selectedNodeRef = useRef<string | null>(null);
  const hoveredNodeRef = useRef<string | null>(null);
  const linkingFromRef = useRef<string | null>(null);
  const offsetRef = useRef({ x: 0, y: 0 });

  // Keep refs in sync with state for values the render loop needs
  useEffect(() => {
    draggingRef.current = dragging;
  }, [dragging]);
  useEffect(() => {
    selectedNodeRef.current = selectedNode;
  }, [selectedNode]);
  useEffect(() => {
    hoveredNodeRef.current = hoveredNode;
  }, [hoveredNode]);
  useEffect(() => {
    linkingFromRef.current = linkingFrom;
  }, [linkingFrom]);

  // Sync data from API
  useEffect(() => {
    if (!graph) return;
    const simNodes = graph.nodes.map((n): SimNode => {
      // Preserve existing sim positions if the node already exists
      const existing = nodesRef.current.find((e) => e.id === n.id);
      return {
        ...n,
        x: existing?.x ?? n.x ?? 200 + Math.random() * 400,
        y: existing?.y ?? n.y ?? 200 + Math.random() * 300,
        vx: existing?.vx ?? 0,
        vy: existing?.vy ?? 0,
      };
    });
    nodesRef.current = simNodes;
    edgesRef.current = graph.edges;
    coolingRef.current = 1.0; // Reset cooling on data change
    setNodes(simNodes);
    setEdges(graph.edges);
  }, [graph]);

  // Force simulation + render loop — runs entirely from refs
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

      // Set canvas size with device pixel ratio for sharp rendering
      if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
        canvas.width = w * dpr;
        canvas.height = h * dpr;
        canvas.style.width = `${w}px`;
        canvas.style.height = `${h}px`;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      }

      ctx.imageSmoothingEnabled = true;

      const ns = nodesRef.current;
      const es = edgesRef.current;
      const cooling = coolingRef.current;
      const currentDragging = draggingRef.current;

      // Physics step
      if (cooling > 0.01) {
        for (let i = 0; i < ns.length; i++) {
          if (ns[i].id === currentDragging) continue;
          let fx = 0,
            fy = 0;

          const ix = ns[i].x ?? 0;
          const iy = ns[i].y ?? 0;

          // Center gravity
          fx += (w / 2 - ix) * CENTER_FORCE;
          fy += (h / 2 - iy) * CENTER_FORCE;

          // Node repulsion
          for (let j = 0; j < ns.length; j++) {
            if (i === j) continue;
            const dx = ix - (ns[j].x ?? 0);
            const dy = iy - (ns[j].y ?? 0);
            const distSq = dx * dx + dy * dy;
            const dist = Math.max(1, Math.sqrt(distSq));
            const force = REPULSION / (distSq + 1);
            fx += (dx / dist) * force;
            fy += (dy / dist) * force;
          }

          // Edge attraction
          for (const edge of es) {
            let other: SimNode | undefined;
            if (edge.sourceNodeId === ns[i].id) other = ns.find((n) => n.id === edge.targetNodeId);
            if (edge.targetNodeId === ns[i].id) other = ns.find((n) => n.id === edge.sourceNodeId);
            if (!other) continue;
            const dx = (other.x ?? 0) - ix;
            const dy = (other.y ?? 0) - iy;
            fx += dx * ATTRACTION;
            fy += dy * ATTRACTION;
          }

          // Apply forces with damping and cooling
          let vx = (ns[i].vx + fx) * DAMPING * cooling;
          let vy = (ns[i].vy + fy) * DAMPING * cooling;

          // Velocity threshold — stop micro-jitter
          if (Math.abs(vx) < VELOCITY_THRESHOLD && Math.abs(vy) < VELOCITY_THRESHOLD) {
            vx = 0;
            vy = 0;
          }

          ns[i].vx = vx;
          ns[i].vy = vy;
          ns[i].x = ix + vx;
          ns[i].y = iy + vy;
        }

        coolingRef.current *= COOLING_DECAY;
      }

      // Draw
      ctx.clearRect(0, 0, w, h);

      const currentSelected = selectedNodeRef.current;
      const currentHovered = hoveredNodeRef.current;
      const currentLinking = linkingFromRef.current;

      // Edges
      ctx.lineWidth = 1.5;
      for (const edge of es) {
        const source = ns.find((n) => n.id === edge.sourceNodeId);
        const target = ns.find((n) => n.id === edge.targetNodeId);
        if (!source || !target) continue;

        const sx = source.x ?? 0,
          sy = source.y ?? 0;
        const tx = target.x ?? 0,
          ty = target.y ?? 0;

        const isWikilink = edge.type === "wikilink";
        const isSuggested = edge.status === "suggested";
        ctx.strokeStyle =
          edge.id === currentSelected
            ? "#fff"
            : isSuggested
              ? "rgba(251, 191, 36, 0.7)" // amber dashed for suggested
              : isWikilink
                ? "rgba(96, 165, 250, 0.55)" // blue dashed for [[wikilinks]]
                : "rgba(148, 163, 184, 0.3)";
        ctx.setLineDash(isSuggested ? [5, 4] : isWikilink ? [4, 3] : []);
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.lineTo(tx, ty);
        ctx.stroke();
        ctx.setLineDash([]);

        // Edge label
        if (edge.label) {
          const mx = (sx + tx) / 2;
          const my = (sy + ty) / 2;
          ctx.font = "10px sans-serif";
          ctx.fillStyle = "rgba(148, 163, 184, 0.6)";
          ctx.textAlign = "center";
          ctx.fillText(edge.label, mx, my - 4);
        }

        // Arrow
        const dx = tx - sx;
        const dy = ty - sy;
        const len = Math.sqrt(dx * dx + dy * dy);
        if (len > 0) {
          const ux = dx / len,
            uy = dy / len;
          const ax = tx - ux * NODE_RADIUS;
          const ay = ty - uy * NODE_RADIUS;
          ctx.fillStyle = "rgba(148, 163, 184, 0.4)";
          ctx.beginPath();
          ctx.moveTo(ax, ay);
          ctx.lineTo(ax - ux * 8 + uy * 4, ay - uy * 8 - ux * 4);
          ctx.lineTo(ax - ux * 8 - uy * 4, ay - uy * 8 + ux * 4);
          ctx.fill();
        }
      }

      // Nodes
      for (const node of ns) {
        const isSelected = currentSelected === node.id;
        const isHovered = currentHovered === node.id;
        const isLinking = currentLinking === node.id;
        const isSuggested = node.status === "suggested";
        const color = NODE_COLORS[node.type] || "#94a3b8";
        const x = node.x ?? 0,
          y = node.y ?? 0;

        // Glow for selected/hovered
        if (isSelected || isHovered) {
          ctx.shadowColor = color;
          ctx.shadowBlur = 12;
        }

        // Circle — suggested nodes are dimmed until confirmed
        ctx.fillStyle = isLinking ? "#fff" : color;
        ctx.globalAlpha = isSelected ? 1 : isSuggested ? 0.4 : 0.85;
        ctx.beginPath();
        ctx.arc(x, y, NODE_RADIUS, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.shadowBlur = 0;

        // Suggested nodes get a dashed ring in their type color
        if (isSuggested) {
          ctx.strokeStyle = color;
          ctx.lineWidth = 2;
          ctx.setLineDash([4, 3]);
          ctx.beginPath();
          ctx.arc(x, y, NODE_RADIUS + 2, 0, Math.PI * 2);
          ctx.stroke();
          ctx.setLineDash([]);
        }

        // Border
        if (isSelected) {
          ctx.strokeStyle = "#fff";
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(x, y, NODE_RADIUS + 2, 0, Math.PI * 2);
          ctx.stroke();
        }

        // Type icon (first letter)
        ctx.font = "bold 9px sans-serif";
        ctx.fillStyle = "rgba(0,0,0,0.4)";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(node.type[0].toUpperCase(), x, y - 6);

        // Node label
        ctx.fillStyle = "#fff";
        ctx.font = "11px sans-serif";
        const label = node.label.length > 12 ? node.label.slice(0, 11) + "..." : node.label;
        ctx.fillText(label, x, y + 6);
      }

      animRef.current = requestAnimationFrame(tick);
    };

    animRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animRef.current);
  }, []); // No deps — reads everything from refs

  // Mouse interactions — find node from ref
  const findNode = useCallback((x: number, y: number): SimNode | undefined => {
    return nodesRef.current.find((n) => {
      const dx = (n.x ?? 0) - x;
      const dy = (n.y ?? 0) - y;
      return dx * dx + dy * dy < NODE_RADIUS * NODE_RADIUS;
    });
  }, []);

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return;
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const node = findNode(x, y);

      if (linkingFromRef.current && node && node.id !== linkingFromRef.current) {
        createEdge.mutate({ sourceNodeId: linkingFromRef.current, targetNodeId: node.id });
        setLinkingFrom(null);
        return;
      }

      if (node) {
        setDragging(node.id);
        setSelectedNode(node.id);
        offsetRef.current = { x: x - (node.x ?? 0), y: y - (node.y ?? 0) };
        coolingRef.current = 1.0; // Reset cooling on drag start
      } else {
        setSelectedNode(null);
        setLinkingFrom(null);
      }
    },
    [findNode, createEdge],
  );

  const onMouseMove = useCallback(
    (e: React.MouseEvent) => {
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return;
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      const hovered = findNode(x, y);
      const hovId = hovered?.id ?? null;
      if (hovId !== hoveredNodeRef.current) {
        setHoveredNode(hovId);
      }

      const currentDragging = draggingRef.current;
      if (currentDragging) {
        // Update ref directly — no React state for position during drag
        const node = nodesRef.current.find((n) => n.id === currentDragging);
        if (node) {
          node.x = x - offsetRef.current.x;
          node.y = y - offsetRef.current.y;
          node.vx = 0;
          node.vy = 0;
        }
      }
    },
    [findNode],
  );

  const onMouseUp = useCallback(() => {
    const currentDragging = draggingRef.current;
    if (currentDragging) {
      const node = nodesRef.current.find((n) => n.id === currentDragging);
      if (node) {
        updateNode.mutate({ id: node.id, input: { x: node.x ?? 0, y: node.y ?? 0 } });
      }
      setDragging(null);
      coolingRef.current = 1.0; // Reset cooling after drag
      // Sync ref to state so UI re-renders with final positions
      setNodes([...nodesRef.current]);
    }
  }, [updateNode]);

  const selectedNodeData = nodes.find((n) => n.id === selectedNode);

  const suggestedNodes = nodes.filter((n) => n.status === "suggested");
  const suggestedEdges = edges.filter((e) => e.status === "suggested");
  const suggestedCount = suggestedNodes.length + suggestedEdges.length;

  const confirmAll = () =>
    confirmSuggestions.mutate({
      nodeIds: suggestedNodes.map((n) => n.id),
      edgeIds: suggestedEdges.map((e) => e.id),
    });

  const dismissAll = () => {
    if (!window.confirm(`Dismiss ${suggestedCount} suggested item(s)? This deletes them.`)) return;
    // Delete edges first, then nodes (node deletion also cascades its edges).
    suggestedEdges.forEach((e) => deleteEdge.mutate(e.id));
    suggestedNodes.forEach((n) => deleteNode.mutate(n.id));
  };

  if (isLoading) return <div className="text-sm text-muted-foreground">Loading...</div>;

  return (
    <div className="flex flex-col h-full gap-2">
      {/* Toolbar */}
      <div className="flex items-center gap-2">
        <Button size="sm" className="h-8 gap-1.5" onClick={() => setShowCreateDialog(true)}>
          <Plus className="h-4 w-4" /> Add Node
        </Button>
        {selectedNode && (
          <>
            <Button
              size="sm"
              variant="outline"
              className="h-8 gap-1.5"
              onClick={() => setLinkingFrom(selectedNode)}
            >
              <Link2 className="h-4 w-4" />
              {linkingFrom ? "Click target..." : "Link"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-8 gap-1.5 text-destructive"
              onClick={() => {
                deleteNode.mutate(selectedNode);
                setSelectedNode(null);
              }}
            >
              <Trash2 className="h-4 w-4" /> Delete
            </Button>
          </>
        )}
        {linkingFrom && (
          <Button size="sm" variant="ghost" className="h-8" onClick={() => setLinkingFrom(null)}>
            Cancel link
          </Button>
        )}
        {suggestedCount > 0 && (
          <div className="ml-auto flex items-center gap-1.5">
            <span className="px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-600 dark:text-amber-400 text-xs font-medium">
              {suggestedCount} suggested
            </span>
            <Button
              size="sm"
              variant="outline"
              className="h-8 gap-1.5"
              onClick={confirmAll}
              disabled={confirmSuggestions.isPending}
            >
              <CheckCheck className="h-4 w-4" /> Confirm all
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-8 gap-1.5 text-destructive"
              onClick={dismissAll}
            >
              <X className="h-4 w-4" /> Dismiss all
            </Button>
          </div>
        )}
        <div
          className={`${suggestedCount > 0 ? "" : "ml-auto"} flex items-center gap-2 text-xs text-muted-foreground`}
        >
          <span>{nodes.length} nodes</span>
          <span>{edges.length} edges</span>
        </div>
      </div>

      {/* Canvas — always mounted so the animation loop can find it */}
      <div
        ref={containerRef}
        className="flex-1 min-h-0 border rounded-lg overflow-hidden bg-background/50 cursor-crosshair relative"
      >
        <canvas
          ref={canvasRef}
          className="w-full h-full"
          onMouseDown={onMouseDown}
          onMouseMove={onMouseMove}
          onMouseUp={onMouseUp}
          onMouseLeave={onMouseUp}
        />
        {nodes.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center text-muted-foreground">
            <div className="text-center">
              <Network className="h-12 w-12 mx-auto mb-3 opacity-30" />
              <p className="text-sm">No nodes yet</p>
              <p className="text-xs mt-1">
                Add concepts, systems, people, and decisions to build your knowledge graph
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Selected node info */}
      {selectedNodeData && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-secondary/30 text-sm">
          <div
            className="h-3 w-3 rounded-full"
            style={{ backgroundColor: NODE_COLORS[selectedNodeData.type] }}
          />
          <span className="font-medium">{selectedNodeData.label}</span>
          <span className="text-muted-foreground capitalize">{selectedNodeData.type}</span>
          {selectedNodeData.description && (
            <span className="text-muted-foreground truncate">
              {" "}
              — {selectedNodeData.description}
            </span>
          )}
          {selectedNodeData.status === "suggested" && (
            <>
              <span className="text-amber-600 dark:text-amber-400 text-xs">
                suggested{selectedNodeData.origin ? ` · ${selectedNodeData.origin}` : ""}
              </span>
              <Button
                variant="outline"
                size="sm"
                className="h-6 gap-1 text-xs"
                onClick={() => confirmNode.mutate(selectedNodeData.id)}
              >
                <Check className="h-3 w-3" /> Confirm
              </Button>
            </>
          )}
          {/* Show connected edges — suggested ones can be confirmed */}
          {edges
            .filter((e) => e.sourceNodeId === selectedNode || e.targetNodeId === selectedNode)
            .map((e) => (
              <span key={e.id} className="flex items-center">
                {e.status === "suggested" && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 text-muted-foreground hover:text-foreground"
                    title="Confirm edge"
                    onClick={() => confirmEdge.mutate(e.id)}
                  >
                    <Check className="h-3 w-3" />
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 text-muted-foreground hover:text-destructive"
                  title="Remove edge"
                  onClick={() => deleteEdge.mutate(e.id)}
                >
                  <Unlink className="h-3 w-3" />
                </Button>
              </span>
            ))}
        </div>
      )}

      {/* Create Node Dialog */}
      <CreateNodeDialog
        open={showCreateDialog}
        onClose={() => setShowCreateDialog(false)}
        onCreate={(data) => {
          createNode.mutate(data);
          setShowCreateDialog(false);
        }}
      />
    </div>
  );
}

function CreateNodeDialog({
  open,
  onClose,
  onCreate,
}: {
  open: boolean;
  onClose: () => void;
  onCreate: (data: { label: string; type: GraphNodeType; description?: string }) => void;
}) {
  const [label, setLabel] = useState("");
  const [type, setType] = useState<GraphNodeType>("concept");
  const [description, setDescription] = useState("");

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New Graph Node</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <Input
            placeholder="Label"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            autoFocus
          />
          <Select value={type} onValueChange={(v) => setType(v as GraphNodeType)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="concept">Concept</SelectItem>
              <SelectItem value="system">System</SelectItem>
              <SelectItem value="person">Person</SelectItem>
              <SelectItem value="decision">Decision</SelectItem>
              <SelectItem value="technology">Technology</SelectItem>
              <SelectItem value="risk">Risk</SelectItem>
            </SelectContent>
          </Select>
          <Input
            placeholder="Description (optional)"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button
              disabled={!label.trim()}
              onClick={() => {
                onCreate({ label: label.trim(), type, description: description || undefined });
                setLabel("");
                setDescription("");
              }}
            >
              Create
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
