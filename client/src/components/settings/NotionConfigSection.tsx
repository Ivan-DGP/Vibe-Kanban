import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Loader2, Check, X, ExternalLink } from "lucide-react";
import { useNotionStatus, useSettings, useUpdateSettings } from "@/hooks";

export default function NotionConfigSection() {
  const { data: status, isLoading: statusLoading } = useNotionStatus();
  const { data: settings } = useSettings();
  const updateSettings = useUpdateSettings();
  const [apiKey, setApiKey] = useState("");

  const handleSaveKey = () => {
    if (!apiKey.trim()) return;
    updateSettings.mutate({ notionApiKey: apiKey.trim() }, {
      onSuccess: () => setApiKey(""),
    });
  };

  const handleClearKey = () => {
    updateSettings.mutate({ notionApiKey: "" });
  };

  const isConfigured = settings?.notionApiKey && settings.notionApiKey !== null;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Label className="text-base font-medium">Notion Integration</Label>
        {statusLoading ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
        ) : status?.connected ? (
          <Badge variant="outline" className="text-green-600 border-green-500/30">
            <Check className="h-3 w-3 mr-1" /> Connected{status.user ? ` as ${status.user}` : ""}
          </Badge>
        ) : isConfigured ? (
          <Badge variant="outline" className="text-amber-500 border-amber-500/30">
            <X className="h-3 w-3 mr-1" /> Invalid Token
          </Badge>
        ) : (
          <Badge variant="outline" className="text-muted-foreground">Not Configured</Badge>
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        Connect to Notion to pull databases and pages as context for your projects.
        Create an integration at{" "}
        <a
          href="https://www.notion.so/my-integrations"
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary underline underline-offset-2 inline-flex items-center gap-0.5"
        >
          notion.so/my-integrations
          <ExternalLink className="h-2.5 w-2.5" />
        </a>
        {" "}and paste the Internal Integration Token below.
      </p>

      <div className="flex gap-2">
        <Input
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder="ntn_..."
          className="flex-1"
        />
        <Button size="sm" onClick={handleSaveKey} disabled={!apiKey.trim() || updateSettings.isPending}>
          {updateSettings.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
          Save
        </Button>
        {isConfigured && (
          <Button size="sm" variant="outline" onClick={handleClearKey} disabled={updateSettings.isPending}>
            Clear
          </Button>
        )}
      </div>

      {status?.connected && (
        <p className="text-xs text-muted-foreground">
          Link Notion databases to projects via each project's settings dialog.
        </p>
      )}
    </div>
  );
}
