import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Trash2, Plus, X } from "lucide-react";
import { useUpdateProject, useDeleteProject, useNotionStatus, useNotionDatabases } from "@/hooks";
import type { Project, ExternalLink } from "@vibe-kanban/shared";
import { useNavigate } from "react-router-dom";

interface ProjectSettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  project: Project;
}

export default function ProjectSettingsDialog({ open, onOpenChange, project }: ProjectSettingsDialogProps) {
  const [name, setName] = useState(project.name);
  const [category, setCategory] = useState(project.category ?? "");
  const [aiCommitMode, setAiCommitMode] = useState(project.aiCommitMode);
  const [links, setLinks] = useState<ExternalLink[]>(project.externalLinks);
  const [notionDatabaseId, setNotionDatabaseId] = useState(project.notionDatabaseId ?? "");
  const [newLinkLabel, setNewLinkLabel] = useState("");
  const [newLinkUrl, setNewLinkUrl] = useState("");
  const updateProject = useUpdateProject();
  const deleteProject = useDeleteProject();
  const { data: notionStatus } = useNotionStatus();
  const { data: notionDbs } = useNotionDatabases(notionStatus?.connected ?? false);
  const navigate = useNavigate();

  useEffect(() => {
    setName(project.name);
    setCategory(project.category ?? "");
    setAiCommitMode(project.aiCommitMode);
    setLinks(project.externalLinks);
    setNotionDatabaseId(project.notionDatabaseId ?? "");
  }, [project, open]);

  const handleSave = () => {
    updateProject.mutate(
      {
        id: project.id,
        input: {
          name: name.trim(),
          category: category.trim() || null,
          aiCommitMode,
          externalLinks: links,
          notionDatabaseId: notionDatabaseId || null,
        },
      },
      { onSuccess: () => onOpenChange(false) },
    );
  };

  const handleDelete = () => {
    if (!confirm(`Delete project "${project.name}"? Tasks will also be deleted.`)) return;
    deleteProject.mutate(project.id, {
      onSuccess: () => { onOpenChange(false); navigate("/"); },
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
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Project Settings</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>

          <div className="space-y-2">
            <Label>Category</Label>
            <Input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="Work, Personal, etc." />
          </div>

          <div className="space-y-2">
            <Label>AI Commit Mode</Label>
            <Select value={aiCommitMode} onValueChange={(v) => setAiCommitMode(v as typeof aiCommitMode)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="commit">Auto Commit</SelectItem>
                <SelectItem value="stage">Stage Only</SelectItem>
                <SelectItem value="none">No Commit</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-[10px] text-muted-foreground">How AI handles git after resolving tasks</p>
          </div>

          <div className="space-y-2">
            <Label>External Links</Label>
            {links.map((link, i) => (
              <div key={i} className="flex items-center gap-2 text-xs">
                <span className="font-medium">{link.label}</span>
                <span className="text-muted-foreground truncate flex-1">{link.url}</span>
                <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => removeLink(i)}>
                  <X className="h-3 w-3" />
                </Button>
              </div>
            ))}
            <div className="flex gap-1.5">
              <Input value={newLinkLabel} onChange={(e) => setNewLinkLabel(e.target.value)} placeholder="Label" className="h-7 text-xs" />
              <Input value={newLinkUrl} onChange={(e) => setNewLinkUrl(e.target.value)} placeholder="URL" className="h-7 text-xs flex-1" />
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
                      {db.icon ? `${db.icon} ` : ""}{db.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[10px] text-muted-foreground">Link a Notion database to view its pages as project context</p>
            </div>
          )}

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
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
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
