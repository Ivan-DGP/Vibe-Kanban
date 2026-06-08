import { useState, useMemo, useCallback } from "react";
import { useProjects } from "@/hooks";
import {
  useApiCollections,
  useCreateApiCollection,
  useDeleteApiCollection,
  useProjectApiRequests,
  useCreateApiRequest,
  useDeleteApiRequest,
  useUpdateApiRequest,
  useExecuteRequest,
} from "@/hooks/useApiClient";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Send } from "lucide-react";
import CollectionsSidebar from "@/components/api-client/CollectionsSidebar";
import RequestBuilder from "@/components/api-client/RequestBuilder";
import type { ApiRequest, HttpMethod } from "@vibe-kanban/shared";

export default function ApiClient() {
  const { data: projects } = useProjects();
  const [projectId, setProjectId] = useState<string>("");
  const [selectedRequest, setSelectedRequest] = useState<ApiRequest | null>(null);
  const [expandedCollections, setExpandedCollections] = useState<Set<string>>(new Set());

  // Auto-select first project
  const activeProjectId = projectId || projects?.[0]?.id || "";

  const { data: collections = [] } = useApiCollections(activeProjectId || undefined);
  const { data: allRequests = [] } = useProjectApiRequests(activeProjectId || undefined);
  const createCollection = useCreateApiCollection(activeProjectId);
  const deleteCollection = useDeleteApiCollection(activeProjectId);
  const createRequest = useCreateApiRequest(activeProjectId);
  const updateRequest = useUpdateApiRequest(activeProjectId);
  const deleteRequest = useDeleteApiRequest(activeProjectId);
  const executeRequest = useExecuteRequest();

  const requestsMap = useMemo(() => {
    const map: Record<string, ApiRequest[]> = {};
    for (const req of allRequests) {
      if (!map[req.collectionId]) map[req.collectionId] = [];
      map[req.collectionId].push(req);
    }
    return map;
  }, [allRequests]);

  const handleToggleCollection = (id: string) => {
    setExpandedCollections((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleCreateCollection = (name: string) => {
    createCollection.mutate(
      { name },
      {
        onSuccess: (col) => {
          setExpandedCollections((prev) => new Set(prev).add(col.id));
        },
      },
    );
  };

  const handleCreateRequest = (collectionId: string) => {
    createRequest.mutate(
      { collectionId, name: "New Request" },
      {
        onSuccess: (req) => {
          setSelectedRequest(req);
          setExpandedCollections((prev) => new Set(prev).add(collectionId));
        },
      },
    );
  };

  const handleDeleteCollection = (id: string) => {
    if (selectedRequest && requestsMap[id]?.some((r) => r.id === selectedRequest.id)) {
      setSelectedRequest(null);
    }
    deleteCollection.mutate(id);
  };

  const handleDeleteRequest = (id: string) => {
    if (selectedRequest?.id === id) setSelectedRequest(null);
    deleteRequest.mutate(id);
  };

  const handleSave = useCallback(
    (updates: Record<string, unknown>) => {
      if (!selectedRequest) return;
      updateRequest.mutate({ id: selectedRequest.id, input: updates as any });
    },
    [selectedRequest, updateRequest],
  );

  const handleExecute = useCallback(
    async (params: {
      method: HttpMethod;
      url: string;
      headers: Record<string, string>;
      body?: string;
    }) => {
      const result = await executeRequest.mutateAsync(params);
      return result;
    },
    [executeRequest],
  );

  return (
    <div className="flex flex-col h-full">
      {/* Top bar with project selector */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border/50 bg-secondary/20">
        <Send className="h-4 w-4 text-primary" />
        <h1 className="text-sm font-semibold">API Client</h1>
        <Select value={activeProjectId} onValueChange={setProjectId}>
          <SelectTrigger className="w-48 h-8 text-xs">
            <SelectValue placeholder="Select project" />
          </SelectTrigger>
          <SelectContent>
            {projects?.map((p) => (
              <SelectItem key={p.id} value={p.id} className="text-xs">
                {p.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Main content */}
      <div className="flex-1 flex overflow-hidden">
        <CollectionsSidebar
          collections={collections}
          requests={requestsMap}
          selectedRequestId={selectedRequest?.id ?? null}
          expandedCollections={expandedCollections}
          onToggleCollection={handleToggleCollection}
          onSelectRequest={setSelectedRequest}
          onCreateCollection={handleCreateCollection}
          onDeleteCollection={handleDeleteCollection}
          onCreateRequest={handleCreateRequest}
          onDeleteRequest={handleDeleteRequest}
        />

        <RequestBuilder
          request={selectedRequest}
          onSave={handleSave}
          onExecute={handleExecute}
          executing={executeRequest.isPending}
        />
      </div>
    </div>
  );
}
