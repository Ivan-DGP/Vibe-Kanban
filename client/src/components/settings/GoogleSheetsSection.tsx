import { Label } from "@/components/ui/label";

export default function GoogleSheetsSection() {
  return (
    <div className="space-y-3">
      <Label>Google Sheets Sync</Label>
      <p className="text-xs text-muted-foreground">
        Configure sync URLs per project in each project's settings. The sync URL must match the
        pattern:
        <code className="mx-1 px-1 bg-muted rounded text-[10px]">
          https://script.google.com/macros/s/...
        </code>
      </p>
    </div>
  );
}
