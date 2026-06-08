import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Download, Upload, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";

export default function DataExportSection() {
  const [importing, setImporting] = useState(false);

  const handleExport = async () => {
    try {
      const [settings, projects] = await Promise.all([api.settings.get(), api.projects.list()]);
      const data = { settings, projects, exportedAt: new Date().toISOString() };
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `vibe-kanban-export-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast.error("Export failed");
    }
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      if (data.settings) {
        // Exported secrets are server-redacted to a placeholder ("••••••••").
        // Strip any such values so a backup/restore round-trip never overwrites
        // the real API keys with the redaction placeholder.
        const REDACTION_PLACEHOLDER = "••••••••";
        const settings = Object.fromEntries(
          Object.entries(data.settings).filter(([, v]) => v !== REDACTION_PLACEHOLDER),
        );
        await api.settings.update(settings);
      }
      toast.success("Import successful");
    } catch {
      toast.error("Import failed - invalid file");
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="space-y-4">
      <Label>Data Management</Label>
      <div className="flex gap-2">
        <Button variant="outline" size="sm" onClick={handleExport}>
          <Download className="h-4 w-4 mr-1" />
          Export JSON
        </Button>
        <label>
          <Button variant="outline" size="sm" asChild disabled={importing}>
            <span>
              {importing ? (
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
              ) : (
                <Upload className="h-4 w-4 mr-1" />
              )}
              Import JSON
            </span>
          </Button>
          <Input type="file" accept=".json" onChange={handleImport} className="hidden" />
        </label>
      </div>
    </div>
  );
}
