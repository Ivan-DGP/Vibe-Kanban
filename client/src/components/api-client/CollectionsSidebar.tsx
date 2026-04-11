import { useState } from "react";
import { cn } from "@/lib/utils";
import { FolderOpen, Plus, Trash2, ChevronRight, ChevronDown, FileJson } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ApiCollection, ApiRequest, HttpMethod } from "@vibe-kanban/shared";

const METHOD_COLORS: Record<HttpMethod, string> = {
  GET: "text-green-400",
  POST: "text-yellow-400",
  PUT: "text-blue-400",
  PATCH: "text-orange-400",
  DELETE: "text-red-400",
  HEAD: "text-purple-400",
  OPTIONS: "text-gray-400",
};

interface CollectionsSidebarProps {
  collections: ApiCollection[];
  requests: Record<string, ApiRequest[]>;
  selectedRequestId: string | null;
  expandedCollections: Set<string>;
  onToggleCollection: (id: string) => void;
  onSelectRequest: (request: ApiRequest) => void;
  onCreateCollection: (name: string) => void;
  onDeleteCollection: (id: string) => void;
  onCreateRequest: (collectionId: string) => void;
  onDeleteRequest: (id: string) => void;
}

export default function CollectionsSidebar({
  collections,
  requests,
  selectedRequestId,
  expandedCollections,
  onToggleCollection,
  onSelectRequest,
  onCreateCollection,
  onDeleteCollection,
  onCreateRequest,
  onDeleteRequest,
}: CollectionsSidebarProps) {
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);

  const handleCreate = () => {
    if (!newName.trim()) return;
    onCreateCollection(newName.trim());
    setNewName("");
    setCreating(false);
  };

  return (
    <div className="w-64 border-r border-border/50 flex flex-col bg-card/30">
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-border/40">
        <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground/60">Collections</span>
        <Button
          size="icon"
          variant="ghost"
          className="h-6 w-6"
          onClick={() => setCreating(!creating)}
        >
          <Plus className="h-3.5 w-3.5" />
        </Button>
      </div>

      {creating && (
        <div className="px-2 py-2 border-b border-border/40">
          <form onSubmit={(e) => { e.preventDefault(); handleCreate(); }} className="flex gap-1">
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Collection name..."
              className="h-7 text-xs"
              autoFocus
            />
            <Button size="sm" className="h-7 text-xs px-2" type="submit">Add</Button>
          </form>
        </div>
      )}

      <div className="flex-1 overflow-auto py-1">
        {collections.length === 0 && !creating && (
          <div className="flex flex-col items-center justify-center py-8 text-muted-foreground/40">
            <FolderOpen className="h-6 w-6 mb-2" />
            <p className="text-xs">No collections</p>
          </div>
        )}

        {collections.map((col) => {
          const expanded = expandedCollections.has(col.id);
          const colRequests = requests[col.id] || [];

          return (
            <div key={col.id}>
              <div
                className="flex items-center gap-1 px-2 py-1.5 hover:bg-accent/50 cursor-pointer group"
                onClick={() => onToggleCollection(col.id)}
              >
                {expanded ? (
                  <ChevronDown className="h-3 w-3 text-muted-foreground/60 shrink-0" />
                ) : (
                  <ChevronRight className="h-3 w-3 text-muted-foreground/60 shrink-0" />
                )}
                <FolderOpen className="h-3.5 w-3.5 text-muted-foreground/60 shrink-0" />
                <span className="text-xs font-medium truncate flex-1">{col.name}</span>
                <span className="text-[10px] text-muted-foreground/40">{colRequests.length}</span>
                <button
                  onClick={(e) => { e.stopPropagation(); onCreateRequest(col.id); }}
                  className="hidden group-hover:block p-0.5 rounded hover:bg-accent text-muted-foreground/60"
                  title="Add request"
                >
                  <Plus className="h-3 w-3" />
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); onDeleteCollection(col.id); }}
                  className="hidden group-hover:block p-0.5 rounded hover:bg-red-500/15 text-red-400/60"
                  title="Delete collection"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>

              {expanded && (
                <div className="ml-3">
                  {colRequests.map((req) => (
                    <div
                      key={req.id}
                      className={cn(
                        "flex items-center gap-1.5 px-2 py-1 cursor-pointer group/req rounded-sm mx-1",
                        selectedRequestId === req.id
                          ? "bg-accent text-accent-foreground"
                          : "hover:bg-accent/50",
                      )}
                      onClick={() => onSelectRequest(req)}
                    >
                      <FileJson className="h-3 w-3 text-muted-foreground/50 shrink-0" />
                      <span className={cn("text-[10px] font-mono font-bold shrink-0 w-8", METHOD_COLORS[req.method])}>
                        {req.method.slice(0, 3)}
                      </span>
                      <span className="text-xs truncate flex-1">{req.name}</span>
                      {req.lastResponseStatus && (
                        <span className={cn(
                          "text-[10px] font-mono",
                          req.lastResponseStatus >= 200 && req.lastResponseStatus < 300 ? "text-green-400" :
                          req.lastResponseStatus >= 400 ? "text-red-400" : "text-yellow-400",
                        )}>
                          {req.lastResponseStatus}
                        </span>
                      )}
                      <button
                        onClick={(e) => { e.stopPropagation(); onDeleteRequest(req.id); }}
                        className="hidden group-hover/req:block p-0.5 rounded hover:bg-red-500/15 text-red-400/60"
                      >
                        <Trash2 className="h-2.5 w-2.5" />
                      </button>
                    </div>
                  ))}

                  {colRequests.length === 0 && (
                    <div className="px-3 py-2 text-[10px] text-muted-foreground/40">
                      No requests
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
