import { useState, useRef, useEffect } from "react";
import { useGraph, useCreateGraphNode, useUpdateGraphNode, useDeleteGraphNode, useCreateGraphEdge, useDeleteGraphEdge } from "@/hooks";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, Trash2, Link2, Unlink, Network } from "lucide-react";
import type { GraphNode, GraphEdge, GraphNodeType } from "@vibe-kanban/shared";

const NODE_COLORS: Record<GraphNodeType, string> = {
  concept: "#60a5fa",    // blue
  system: "#a78bfa",     // purple
  person: "#34d399",     // green
  decision: "#fbbf24",   // amber
  technology: "#22d3ee",  // cyan
  risk: "#f87171",       // red
};

const NODE_RADIUS = 24;

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

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const animRef = useRef<number>(0);

  const [nodes, setNodes] = useState<SimNode[]>([]);
  const [edges, setEdges] = useState<GraphEdge[]>([]);
  const [dragging, setDragging] = useState<string | null>(null);
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [linkingFrom, setLinkingFrom] = useState<string | null>(null);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);

  const offsetRef = useRef({ x: 0, y: 0 });

  // Sync data from API
  useEffect(() => {
    if (!graph) return;
    setNodes(graph.nodes.map((n) => ({
      ...n,
      x: n.x ?? 200 + Math.random() * 400,
      y: n.y ?? 200 + Math.random() * 300,
      vx: 0,
      vy: 0,
    })));
    setEdges(graph.edges);
  }, [graph]);

  // Force simulation + render loop
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const tick = () => {
      const w = container.clientWidth;
      const h = container.clientHeight;
      canvas.width = w;
      canvas.height = h;

      // Simple force-directed layout
      setNodes((prevNodes) => {
        const ns = [...prevNodes];
        const damping = 0.9;
        const repulsion = 3000;
        const attraction = 0.005;
        const centerForce = 0.01;

        for (let i = 0; i < ns.length; i++) {
          if (ns[i].id === dragging) continue;
          let fx = 0, fy = 0;

          // Center gravity
          fx += (w / 2 - (ns[i].x ?? 0)) * centerForce;
          fy += (h / 2 - (ns[i].y ?? 0)) * centerForce;

          // Node repulsion
          for (let j = 0; j < ns.length; j++) {
            if (i === j) continue;
            const dx = (ns[i].x ?? 0) - (ns[j].x ?? 0);
            const dy = (ns[i].y ?? 0) - (ns[j].y ?? 0);
            const dist = Math.max(1, Math.sqrt(dx * dx + dy * dy));
            fx += (dx / dist) * (repulsion / (dist * dist));
            fy += (dy / dist) * (repulsion / (dist * dist));
          }

          // Edge attraction
          for (const edge of edges) {
            let other: SimNode | undefined;
            if (edge.sourceNodeId === ns[i].id) other = ns.find((n) => n.id === edge.targetNodeId);
            if (edge.targetNodeId === ns[i].id) other = ns.find((n) => n.id === edge.sourceNodeId);
            if (!other) continue;
            const dx = (other.x ?? 0) - (ns[i].x ?? 0);
            const dy = (other.y ?? 0) - (ns[i].y ?? 0);
            fx += dx * attraction;
            fy += dy * attraction;
          }

          ns[i] = {
            ...ns[i],
            vx: (ns[i].vx + fx) * damping,
            vy: (ns[i].vy + fy) * damping,
            x: (ns[i].x ?? 0) + (ns[i].vx + fx) * damping,
            y: (ns[i].y ?? 0) + (ns[i].vy + fy) * damping,
          };
        }
        return ns;
      });

      // Draw
      ctx.clearRect(0, 0, w, h);

      // Edges
      ctx.lineWidth = 1.5;
      for (const edge of edges) {
        const source = nodes.find((n) => n.id === edge.sourceNodeId);
        const target = nodes.find((n) => n.id === edge.targetNodeId);
        if (!source || !target) continue;

        ctx.strokeStyle = edge.id === selectedNode ? "#fff" : "rgba(148, 163, 184, 0.3)";
        ctx.beginPath();
        ctx.moveTo(source.x ?? 0, source.y ?? 0);
        ctx.lineTo(target.x ?? 0, target.y ?? 0);
        ctx.stroke();

        // Edge label
        if (edge.label) {
          const mx = ((source.x ?? 0) + (target.x ?? 0)) / 2;
          const my = ((source.y ?? 0) + (target.y ?? 0)) / 2;
          ctx.font = "10px sans-serif";
          ctx.fillStyle = "rgba(148, 163, 184, 0.6)";
          ctx.textAlign = "center";
          ctx.fillText(edge.label, mx, my - 4);
        }

        // Arrow
        const dx = (target.x ?? 0) - (source.x ?? 0);
        const dy = (target.y ?? 0) - (source.y ?? 0);
        const len = Math.sqrt(dx * dx + dy * dy);
        if (len > 0) {
          const ux = dx / len, uy = dy / len;
          const ax = (target.x ?? 0) - ux * NODE_RADIUS;
          const ay = (target.y ?? 0) - uy * NODE_RADIUS;
          ctx.fillStyle = "rgba(148, 163, 184, 0.4)";
          ctx.beginPath();
          ctx.moveTo(ax, ay);
          ctx.lineTo(ax - ux * 8 + uy * 4, ay - uy * 8 - ux * 4);
          ctx.lineTo(ax - ux * 8 - uy * 4, ay - uy * 8 + ux * 4);
          ctx.fill();
        }
      }

      // Nodes
      for (const node of nodes) {
        const isSelected = selectedNode === node.id;
        const isHovered = hoveredNode === node.id;
        const isLinking = linkingFrom === node.id;
        const color = NODE_COLORS[node.type] || "#94a3b8";
        const x = node.x ?? 0, y = node.y ?? 0;

        // Glow for selected/hovered
        if (isSelected || isHovered) {
          ctx.shadowColor = color;
          ctx.shadowBlur = 12;
        }

        // Circle
        ctx.fillStyle = isLinking ? "#fff" : color;
        ctx.globalAlpha = isSelected ? 1 : 0.85;
        ctx.beginPath();
        ctx.arc(x, y, NODE_RADIUS, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.shadowBlur = 0;

        // Border
        if (isSelected) {
          ctx.strokeStyle = "#fff";
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(x, y, NODE_RADIUS + 2, 0, Math.PI * 2);
          ctx.stroke();
        }

        // Label
        ctx.fillStyle = "#fff";
        ctx.font = "bold 11px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";

        // Type icon (first letter)
        ctx.font = "bold 9px sans-serif";
        ctx.fillStyle = "rgba(0,0,0,0.4)";
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
  }, [edges, dragging, selectedNode, hoveredNode, linkingFrom]);

  // Mouse interactions
  const findNode = (x: number, y: number): SimNode | undefined => {
    return nodes.find((n) => {
      const dx = (n.x ?? 0) - x;
      const dy = (n.y ?? 0) - y;
      return dx * dx + dy * dy < NODE_RADIUS * NODE_RADIUS;
    });
  };

  const onMouseDown = (e: React.MouseEvent) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const node = findNode(x, y);

    if (linkingFrom && node && node.id !== linkingFrom) {
      createEdge.mutate({ sourceNodeId: linkingFrom, targetNodeId: node.id });
      setLinkingFrom(null);
      return;
    }

    if (node) {
      setDragging(node.id);
      setSelectedNode(node.id);
      offsetRef.current = { x: x - (node.x ?? 0), y: y - (node.y ?? 0) };
    } else {
      setSelectedNode(null);
      setLinkingFrom(null);
    }
  };

  const onMouseMove = (e: React.MouseEvent) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const hovered = findNode(x, y);
    setHoveredNode(hovered?.id ?? null);

    if (dragging) {
      setNodes((prev) => prev.map((n) =>
        n.id === dragging ? { ...n, x: x - offsetRef.current.x, y: y - offsetRef.current.y, vx: 0, vy: 0 } : n
      ));
    }
  };

  const onMouseUp = () => {
    if (dragging) {
      const node = nodes.find((n) => n.id === dragging);
      if (node) {
        updateNode.mutate({ id: node.id, input: { x: node.x ?? 0, y: node.y ?? 0 } });
      }
      setDragging(null);
    }
  };

  const selectedNodeData = nodes.find((n) => n.id === selectedNode);

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
              onClick={() => { deleteNode.mutate(selectedNode); setSelectedNode(null); }}
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
        <div className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
          <span>{nodes.length} nodes</span>
          <span>{edges.length} edges</span>
        </div>
      </div>

      {/* Canvas or empty state */}
      {nodes.length === 0 ? (
        <div className="flex-1 flex items-center justify-center text-muted-foreground">
          <div className="text-center">
            <Network className="h-12 w-12 mx-auto mb-3 opacity-30" />
            <p className="text-sm">No nodes yet</p>
            <p className="text-xs mt-1">Add concepts, systems, people, and decisions to build your knowledge graph</p>
          </div>
        </div>
      ) : (
        <div ref={containerRef} className="flex-1 min-h-0 border rounded-lg overflow-hidden bg-background/50 cursor-crosshair">
          <canvas
            ref={canvasRef}
            className="w-full h-full"
            onMouseDown={onMouseDown}
            onMouseMove={onMouseMove}
            onMouseUp={onMouseUp}
            onMouseLeave={onMouseUp}
          />
        </div>
      )}

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
            <span className="text-muted-foreground truncate"> — {selectedNodeData.description}</span>
          )}
          {/* Show connected edges */}
          {edges
            .filter((e) => e.sourceNodeId === selectedNode || e.targetNodeId === selectedNode)
            .map((e) => (
              <Button
                key={e.id}
                variant="ghost"
                size="icon"
                className="h-6 w-6 text-muted-foreground hover:text-destructive"
                title="Remove edge"
                onClick={() => deleteEdge.mutate(e.id)}
              >
                <Unlink className="h-3 w-3" />
              </Button>
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
            <Button variant="outline" onClick={onClose}>Cancel</Button>
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
