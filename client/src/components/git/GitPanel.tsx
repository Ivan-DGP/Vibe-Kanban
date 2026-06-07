import { useState, useMemo } from "react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { ChevronDown, ChevronRight, GitFork } from "lucide-react";
import {
  useGitStatus,
  useStageFiles,
  useUnstageFiles,
  useGitSubRepos,
  useGitDivergence,
} from "@/hooks";
import GitBranchSwitcher from "./GitBranchSwitcher";
import GitFileList from "./GitFileList";
import GitCommitForm from "./GitCommitForm";
import GitActions from "./GitActions";
import GitLogPanel from "./GitLogPanel";
import GitDiffViewer from "./GitDiffViewer";

interface GitPanelProps {
  projectId: string;
  subPath?: string;
}

function GitPanelContent({ projectId, subPath }: GitPanelProps) {
  const { data: status, isLoading } = useGitStatus(projectId, subPath);
  const { data: divergence } = useGitDivergence(projectId, subPath);
  const stageFiles = useStageFiles();
  const unstageFiles = useUnstageFiles();

  const [selectedStaged, setSelectedStaged] = useState<Set<string>>(new Set());
  const [selectedUnstaged, setSelectedUnstaged] = useState<Set<string>>(new Set());
  const [selectedUntracked, setSelectedUntracked] = useState<Set<string>>(new Set());
  const [diffFile, setDiffFile] = useState<string | undefined>(undefined);
  const [logOpen, setLogOpen] = useState(false);

  const untrackedAsFileChanges = useMemo(
    () => (status?.untracked ?? []).map((path) => ({ path, status: "A" })),
    [status?.untracked],
  );

  if (isLoading || !status) {
    return <div className="text-xs text-muted-foreground p-2">Loading git status...</div>;
  }

  const toggleSet = (set: Set<string>, path: string) => {
    const next = new Set(set);
    if (next.has(path)) next.delete(path);
    else next.add(path);
    return next;
  };

  const handleStage = () => {
    const files = [...selectedUnstaged, ...selectedUntracked];
    if (files.length === 0) {
      stageFiles.mutate({ projectId, files: ["--all"], subPath });
    } else {
      stageFiles.mutate({ projectId, files, subPath });
    }
    setSelectedUnstaged(new Set());
    setSelectedUntracked(new Set());
  };

  const handleUnstage = () => {
    const files = [...selectedStaged];
    if (files.length === 0) return;
    unstageFiles.mutate({ projectId, files, subPath });
    setSelectedStaged(new Set());
  };

  return (
    <div className="space-y-3 text-sm">
      <div className="flex items-center gap-2 flex-wrap">
        <GitBranchSwitcher projectId={projectId} currentBranch={status.branch} subPath={subPath} />
        {divergence?.mainBranch && (divergence.ahead > 0 || divergence.behind > 0) && (
          <Badge variant="outline" className="text-[10px] gap-1">
            <GitFork className="h-3 w-3" />
            {divergence.mainBranch}: {divergence.ahead > 0 && `${divergence.ahead}↑`}
            {divergence.behind > 0 && ` ${divergence.behind}↓`}
          </Badge>
        )}
      </div>

      <GitFileList
        files={status.staged}
        selected={selectedStaged}
        onToggle={(p) => setSelectedStaged((s) => toggleSet(s, p))}
        onSelectAll={() => setSelectedStaged(new Set(status.staged.map((f) => f.path)))}
        onDeselectAll={() => setSelectedStaged(new Set())}
        onFileClick={(p) => setDiffFile(p)}
        type="staged"
      />

      {selectedStaged.size > 0 && (
        <button
          onClick={handleUnstage}
          className="text-[10px] text-muted-foreground hover:text-foreground underline"
        >
          Unstage selected ({selectedStaged.size})
        </button>
      )}

      <GitFileList
        files={[...status.unstaged, ...untrackedAsFileChanges]}
        selected={new Set([...selectedUnstaged, ...selectedUntracked])}
        onToggle={(p) => {
          if (status.untracked.includes(p)) {
            setSelectedUntracked((s) => toggleSet(s, p));
          } else {
            setSelectedUnstaged((s) => toggleSet(s, p));
          }
        }}
        onSelectAll={() => {
          setSelectedUnstaged(new Set(status.unstaged.map((f) => f.path)));
          setSelectedUntracked(new Set(status.untracked));
        }}
        onDeselectAll={() => {
          setSelectedUnstaged(new Set());
          setSelectedUntracked(new Set());
        }}
        onFileClick={(p) => setDiffFile(p)}
        type="unstaged"
      />

      {(selectedUnstaged.size > 0 || selectedUntracked.size > 0) && (
        <button
          onClick={handleStage}
          className="text-[10px] text-muted-foreground hover:text-foreground underline"
        >
          Stage selected ({selectedUnstaged.size + selectedUntracked.size})
        </button>
      )}

      <Separator />

      <GitCommitForm
        projectId={projectId}
        subPath={subPath}
        hasStagedFiles={status.staged.length > 0}
      />

      <GitActions
        projectId={projectId}
        subPath={subPath}
        selectedUnstaged={[...selectedUnstaged]}
        ahead={status.ahead}
        behind={status.behind}
      />

      {diffFile && (
        <>
          <Separator />
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-medium">{diffFile}</span>
              <button
                onClick={() => setDiffFile(undefined)}
                className="text-[10px] text-muted-foreground hover:text-foreground"
              >
                Close
              </button>
            </div>
            <GitDiffViewer projectId={projectId} file={diffFile} subPath={subPath} />
          </div>
        </>
      )}

      <Separator />

      <Collapsible open={logOpen} onOpenChange={setLogOpen}>
        <CollapsibleTrigger className="flex items-center gap-1 text-xs font-medium w-full hover:text-foreground text-muted-foreground">
          {logOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          Commit History
        </CollapsibleTrigger>
        <CollapsibleContent>
          <GitLogPanel projectId={projectId} subPath={subPath} />
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}

export default function GitPanel({ projectId }: GitPanelProps) {
  const { data: subRepos } = useGitSubRepos(projectId);

  // If multiple sub-repos, show tabs
  if (subRepos && subRepos.length > 1) {
    return (
      <Tabs defaultValue={subRepos[0]} className="space-y-3">
        <TabsList className="w-full">
          {subRepos.map((repo) => (
            <TabsTrigger key={repo} value={repo} className="flex-1 text-xs">
              {repo || "Root"}
            </TabsTrigger>
          ))}
        </TabsList>
        {subRepos.map((repo) => (
          <TabsContent key={repo} value={repo}>
            <GitPanelContent projectId={projectId} subPath={repo || undefined} />
          </TabsContent>
        ))}
      </Tabs>
    );
  }

  return <GitPanelContent projectId={projectId} />;
}
