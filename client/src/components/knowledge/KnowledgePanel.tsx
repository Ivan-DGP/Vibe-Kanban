import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import ArtifactsTab from "./ArtifactsTab";
import RoadmapTab from "./RoadmapTab";
import KnowledgeGraphPanel from "./KnowledgeGraphPanel";
import SearchTab from "./SearchTab";
import MemoryPanel from "./MemoryPanel";

interface KnowledgePanelProps {
  projectId: string;
}

export default function KnowledgePanel({ projectId }: KnowledgePanelProps) {
  return (
    <Tabs defaultValue="artifacts" className="h-full flex flex-col">
      <TabsList className="w-fit">
        <TabsTrigger value="artifacts">Artifacts</TabsTrigger>
        <TabsTrigger value="search">Search</TabsTrigger>
        <TabsTrigger value="memory">Memory</TabsTrigger>
        <TabsTrigger value="roadmap">Roadmap</TabsTrigger>
        <TabsTrigger value="graph">Graph</TabsTrigger>
      </TabsList>
      <TabsContent value="artifacts" className="flex-1 mt-4 overflow-auto">
        <ArtifactsTab projectId={projectId} />
      </TabsContent>
      <TabsContent value="search" className="flex-1 mt-4 overflow-auto">
        <SearchTab projectId={projectId} />
      </TabsContent>
      <TabsContent value="memory" className="flex-1 mt-4 overflow-auto">
        <MemoryPanel projectId={projectId} />
      </TabsContent>
      <TabsContent value="roadmap" className="flex-1 mt-4 overflow-auto">
        <RoadmapTab projectId={projectId} />
      </TabsContent>
      <TabsContent value="graph" className="flex-1 mt-4 overflow-hidden">
        <KnowledgeGraphPanel projectId={projectId} />
      </TabsContent>
    </Tabs>
  );
}
