import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import ArtifactsTab from "./ArtifactsTab";
import RoadmapTab from "./RoadmapTab";
import GraphTab from "./GraphTab";
import SearchTab from "./SearchTab";

interface KnowledgePanelProps {
  projectId: string;
}

export default function KnowledgePanel({ projectId }: KnowledgePanelProps) {
  return (
    <Tabs defaultValue="artifacts" className="h-full flex flex-col">
      <TabsList className="w-fit">
        <TabsTrigger value="artifacts">Artifacts</TabsTrigger>
        <TabsTrigger value="search">Search</TabsTrigger>
        <TabsTrigger value="roadmap">Roadmap</TabsTrigger>
        <TabsTrigger value="graph">Graph</TabsTrigger>
      </TabsList>
      <TabsContent value="artifacts" className="flex-1 mt-4 overflow-auto">
        <ArtifactsTab projectId={projectId} />
      </TabsContent>
      <TabsContent value="search" className="flex-1 mt-4 overflow-auto">
        <SearchTab projectId={projectId} />
      </TabsContent>
      <TabsContent value="roadmap" className="flex-1 mt-4 overflow-auto">
        <RoadmapTab projectId={projectId} />
      </TabsContent>
      <TabsContent value="graph" className="flex-1 mt-4 overflow-hidden">
        <GraphTab projectId={projectId} />
      </TabsContent>
    </Tabs>
  );
}
