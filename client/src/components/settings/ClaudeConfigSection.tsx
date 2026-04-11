import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Loader2, Check, X } from "lucide-react";
import { useClaudeStatus, useSettings, useUpdateSettings } from "@/hooks";

export default function ClaudeConfigSection() {
  const { data: status } = useClaudeStatus();
  useSettings();
  const updateSettings = useUpdateSettings();
  const [apiKey, setApiKey] = useState("");

  const handleSaveKey = () => {
    if (!apiKey.trim()) return;
    updateSettings.mutate({ claudeApiKey: apiKey.trim() }, {
      onSuccess: () => setApiKey(""),
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Label>Claude CLI</Label>
        {status?.cliAvailable ? (
          <Badge variant="outline" className="text-green-600 border-green-500/30"><Check className="h-3 w-3 mr-1" /> Available</Badge>
        ) : (
          <Badge variant="outline" className="text-red-500 border-red-500/30"><X className="h-3 w-3 mr-1" /> Not Found</Badge>
        )}
      </div>

      <div className="flex items-center gap-3">
        <Label>API Key</Label>
        {status?.apiKeyConfigured ? (
          <Badge variant="outline" className="text-green-600 border-green-500/30"><Check className="h-3 w-3 mr-1" /> Configured</Badge>
        ) : (
          <Badge variant="outline" className="text-muted-foreground">Not Set</Badge>
        )}
      </div>

      <div className="flex gap-2">
        <Input
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder="sk-ant-..."
          className="flex-1"
        />
        <Button size="sm" onClick={handleSaveKey} disabled={!apiKey.trim() || updateSettings.isPending}>
          {updateSettings.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
          Save
        </Button>
      </div>
    </div>
  );
}
