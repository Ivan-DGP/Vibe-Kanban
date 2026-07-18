import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface TaskEditorSpawnConfigProps {
  spawnType: "" | "qa-test" | "dev-fix";
  onSpawnTypeChange: (v: "" | "qa-test" | "dev-fix") => void;
  qaTargetUrl: string;
  onQaTargetUrlChange: (v: string) => void;
}

export default function TaskEditorSpawnConfig({
  spawnType,
  onSpawnTypeChange,
  qaTargetUrl,
  onQaTargetUrlChange,
}: TaskEditorSpawnConfigProps) {
  return (
    <div className="space-y-2 rounded-md border p-3">
      <div className="space-y-1">
        <Label className="text-sm">Auto-spawn type</Label>
        <Select
          value={spawnType || "__none__"}
          onValueChange={(v) =>
            onSpawnTypeChange(v === "__none__" ? "" : (v as "qa-test" | "dev-fix"))
          }
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__none__">None (manual task)</SelectItem>
            <SelectItem value="qa-test">qa-test — run browser QA via qa-agent</SelectItem>
            <SelectItem value="dev-fix">dev-fix — Claude session writes the code</SelectItem>
          </SelectContent>
        </Select>
        <p className="text-[10px] text-muted-foreground">
          Triggers a headless Claude session when the task is created. Project must have auto-spawn
          enabled.
        </p>
      </div>
      {spawnType === "qa-test" && (
        <div className="space-y-1 pt-1">
          <Label className="text-xs">Target URL</Label>
          <Input
            value={qaTargetUrl}
            onChange={(e) => onQaTargetUrlChange(e.target.value)}
            placeholder="https://app.example.com/page"
            className="h-8 text-xs font-mono"
          />
        </div>
      )}
    </div>
  );
}
