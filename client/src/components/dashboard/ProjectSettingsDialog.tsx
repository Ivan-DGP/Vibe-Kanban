import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Loader2, Trash2, Plus, X } from "lucide-react";
import {
  useUpdateProject,
  useDeleteProject,
  useNotionStatus,
  useNotionDatabases,
  useGitHubAccounts,
  useGitHubMapping,
  useSetGitHubMapping,
  useClearGitHubMapping,
} from "@/hooks";
import { useConfirm } from "@/hooks/useConfirm";
import type { Project, ExternalLink } from "@vibe-kanban/shared";
import { useNavigate } from "react-router-dom";

interface ProjectSettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  project: Project;
}

export default function ProjectSettingsDialog({
  open,
  onOpenChange,
  project,
}: ProjectSettingsDialogProps) {
  const [name, setName] = useState(project.name);
  const [category, setCategory] = useState(project.category ?? "");
  const [aiCommitMode, setAiCommitMode] = useState(project.aiCommitMode);
  const [treeDepth, setTreeDepth] = useState(project.treeDepth ?? 3);
  const [aiInstructions, setAiInstructions] = useState(project.aiInstructions ?? "");
  const [links, setLinks] = useState<ExternalLink[]>(project.externalLinks);
  const [notionDatabaseId, setNotionDatabaseId] = useState(project.notionDatabaseId ?? "");
  const [autoSpawnEnabled, setAutoSpawnEnabled] = useState(project.autoSpawnEnabled);
  const [qaAgentPath, setQaAgentPath] = useState(project.qaAgentPath ?? "");
  const [qaAgentPython, setQaAgentPython] = useState(project.qaAgentPython ?? "");
  const [githubAccountId, setGithubAccountId] = useState<string>("");
  const [newLinkLabel, setNewLinkLabel] = useState("");
  const [newLinkUrl, setNewLinkUrl] = useState("");
  const updateProject = useUpdateProject();
  const deleteProject = useDeleteProject();
  const confirm = useConfirm();
  const { data: notionStatus } = useNotionStatus();
  const { data: notionDbs } = useNotionDatabases(notionStatus?.connected ?? false);
  const { data: githubAccounts } = useGitHubAccounts();
  const { data: githubMappings } = useGitHubMapping(open ? project.id : undefined);
  const setGithubMapping = useSetGitHubMapping();
  const clearGithubMapping = useClearGitHubMapping();
  const navigate = useNavigate();

  useEffect(() => {
    setName(project.name);
    setCategory(project.category ?? "");
    setAiCommitMode(project.aiCommitMode);
    setTreeDepth(project.treeDepth ?? 3);
    setAiInstructions(project.aiInstructions ?? "");
    setLinks(project.externalLinks);
    setNotionDatabaseId(project.notionDatabaseId ?? "");
    setAutoSpawnEnabled(project.autoSpawnEnabled);
    setQaAgentPath(project.qaAgentPath ?? "");
    setQaAgentPython(project.qaAgentPython ?? "");
  }, [project, open]);

  useEffect(() => {
    const rootMapping = githubMappings?.find((m) => m.subPath === "");
    setGithubAccountId(rootMapping?.githubAccountId ?? "");
  }, [githubMappings]);

  const handleSave = async () => {
    const currentMappingId = githubMappings?.find((m) => m.subPath === "")?.githubAccountId ?? "";
    if (githubAccountId !== currentMappingId) {
      if (githubAccountId) {
        await setGithubMapping.mutateAsync({ projectId: project.id, githubAccountId });
      } else {
        await clearGithubMapping.mutateAsync({ projectId: project.id });
      }
    }
    updateProject.mutate(
      {
        id: project.id,
        input: {
          name: name.trim(),
          category: category.trim() || null,
          aiCommitMode,
          treeDepth,
          aiInstructions: aiInstructions.trim() || null,
          externalLinks: links,
          notionDatabaseId: notionDatabaseId || null,
          autoSpawnEnabled,
          qaAgentPath: qaAgentPath.trim() || null,
          qaAgentPython: qaAgentPython.trim() || null,
        },
      },
      { onSuccess: () => onOpenChange(false) },
    );
  };

  const handleDelete = async () => {
    if (
      !(await confirm({
        title: "Delete Project",
        description: `Delete project "${project.name}"? Tasks will also be deleted.`,
      }))
    )
      return;
    deleteProject.mutate(project.id, {
      onSuccess: () => {
        onOpenChange(false);
        navigate("/");
      },
    });
  };

  const addLink = () => {
    if (!newLinkLabel.trim() || !newLinkUrl.trim()) return;
    setLinks([...links, { label: newLinkLabel.trim(), url: newLinkUrl.trim() }]);
    setNewLinkLabel("");
    setNewLinkUrl("");
  };

  const removeLink = (i: number) => setLinks(links.filter((_, idx) => idx !== i));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Project Settings</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 flex-1 overflow-y-auto pr-1 -mr-1">
          <div className="space-y-2">
            <Label>Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>

          <div className="space-y-2">
            <Label>Category</Label>
            <Input
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              placeholder="Work, Personal, etc."
            />
          </div>

          <div className="space-y-2">
            <Label>AI Commit Mode</Label>
            <Select
              value={aiCommitMode}
              onValueChange={(v) => setAiCommitMode(v as typeof aiCommitMode)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="commit">Auto Commit</SelectItem>
                <SelectItem value="stage">Stage Only</SelectItem>
                <SelectItem value="none">No Commit</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-[10px] text-muted-foreground">
              How AI handles git after resolving tasks
            </p>
          </div>

          <div className="space-y-2">
            <Label>GitHub Account</Label>
            <Select
              value={githubAccountId || "__none__"}
              onValueChange={(v) => setGithubAccountId(v === "__none__" ? "" : v)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Use system git credentials" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">None (system git credentials)</SelectItem>
                {githubAccounts?.map((acct) => (
                  <SelectItem key={acct.id} value={acct.id}>
                    {acct.name}
                    {acct.username ? ` — @${acct.username}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[10px] text-muted-foreground">
              Used for push/pull/commit on this project. Token authenticates HTTPS pushes; SSH
              remotes still use system keys.
            </p>
          </div>

          <div className="space-y-2">
            <Label>Directory Tree Depth</Label>
            <Select value={String(treeDepth)} onValueChange={(v) => setTreeDepth(Number(v))}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[2, 3, 4, 5, 6].map((d) => (
                  <SelectItem key={d} value={String(d)}>
                    {d} levels{d === 3 ? " (default)" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[10px] text-muted-foreground">
              Depth of the project tree included in AI context
            </p>
          </div>

          <div className="space-y-2">
            <Label>AI Instructions</Label>
            <textarea
              value={aiInstructions}
              onChange={(e) => setAiInstructions(e.target.value)}
              placeholder="Custom instructions for AI when working on this project...&#10;e.g., coding style, test commands, forbidden patterns"
              className="w-full min-h-[80px] rounded-md border bg-background px-3 py-2 text-xs resize-y"
              rows={3}
            />
            <p className="text-[10px] text-muted-foreground">
              Injected into AI resolve and analyze prompts for all tasks in this project
            </p>
          </div>

          <div className="space-y-2">
            <Label>External Links</Label>
            {links.map((link, i) => (
              <div key={i} className="flex items-center gap-2 text-xs">
                <span className="font-medium">{link.label}</span>
                <span className="text-muted-foreground truncate flex-1">{link.url}</span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  onClick={() => removeLink(i)}
                >
                  <X className="h-3 w-3" />
                </Button>
              </div>
            ))}
            <div className="flex gap-1.5">
              <Input
                value={newLinkLabel}
                onChange={(e) => setNewLinkLabel(e.target.value)}
                placeholder="Label"
                className="h-7 text-xs"
              />
              <Input
                value={newLinkUrl}
                onChange={(e) => setNewLinkUrl(e.target.value)}
                placeholder="URL"
                className="h-7 text-xs flex-1"
              />
              <Button size="icon" variant="ghost" className="h-7 w-7 shrink-0" onClick={addLink}>
                <Plus className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>

          {notionStatus?.connected && (
            <div className="space-y-2">
              <Label>Notion Database</Label>
              <Select
                value={notionDatabaseId || "__none__"}
                onValueChange={(v) => setNotionDatabaseId(v === "__none__" ? "" : v)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select a database..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">None</SelectItem>
                  {notionDbs?.databases.map((db) => (
                    <SelectItem key={db.id} value={db.id}>
                      {db.icon ? `${db.icon} ` : ""}
                      {db.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[10px] text-muted-foreground">
                Link a Notion database to view its pages as project context
              </p>
            </div>
          )}

          <div className="space-y-2 rounded-md border p-3">
            <div className="flex items-center justify-between">
              <div>
                <Label className="text-sm">Auto-spawn Claude sessions</Label>
                <p className="text-[10px] text-muted-foreground">
                  When a task is created with <code>metadata.type</code> = <code>qa-test</code> or{" "}
                  <code>dev-fix</code>, dispatch a headless Claude session automatically.
                </p>
              </div>
              <Switch checked={autoSpawnEnabled} onCheckedChange={setAutoSpawnEnabled} />
            </div>

            {autoSpawnEnabled && (
              <div className="space-y-2 pt-2">
                <div className="space-y-1">
                  <Label className="text-xs">qa-agent path</Label>
                  <Input
                    value={qaAgentPath}
                    onChange={(e) => setQaAgentPath(e.target.value)}
                    placeholder="/abs/path/to/qa-agent"
                    className="h-8 text-xs font-mono"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">qa-agent python</Label>
                  <Input
                    value={qaAgentPython}
                    onChange={(e) => setQaAgentPython(e.target.value)}
                    placeholder="/abs/path/to/qa-agent/.venv/bin/python"
                    className="h-8 text-xs font-mono"
                  />
                </div>
                <p className="text-[10px] text-muted-foreground">
                  Required for <code>qa-test</code> tasks. Leave blank for <code>dev-fix</code>-only
                  flows.
                </p>
              </div>
            )}
          </div>

          <div className="text-xs text-muted-foreground">
            <span className="font-medium">Path:</span> {project.path}
          </div>
        </div>

        <DialogFooter className="flex justify-between">
          <Button variant="destructive" size="sm" onClick={handleDelete}>
            <Trash2 className="h-3.5 w-3.5 mr-1" />
            Delete Project
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={updateProject.isPending || !name.trim()}>
              {updateProject.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
              Save
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
