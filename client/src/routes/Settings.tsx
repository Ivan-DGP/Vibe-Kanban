import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useSettings, useUpdateSettings } from "@/hooks";
import ProjectScanSection from "@/components/settings/ProjectScanSection";
import ClaudeConfigSection from "@/components/settings/ClaudeConfigSection";
import GitHubAccountsSection from "@/components/settings/GitHubAccountsSection";
import DataExportSection from "@/components/settings/DataExportSection";
import GoogleSheetsSection from "@/components/settings/GoogleSheetsSection";
import NotionConfigSection from "@/components/settings/NotionConfigSection";

export default function Settings() {
  const { data: settings } = useSettings();
  const updateSettings = useUpdateSettings();

  return (
    <div className="p-6 max-w-3xl">
      <h1 className="text-2xl font-bold mb-6">Settings</h1>

      <Tabs defaultValue="projects">
        <TabsList>
          <TabsTrigger value="projects">Projects</TabsTrigger>
          <TabsTrigger value="ai">Claude AI</TabsTrigger>
          <TabsTrigger value="github">GitHub</TabsTrigger>
          <TabsTrigger value="general">General</TabsTrigger>
          <TabsTrigger value="notion">Notion</TabsTrigger>
          <TabsTrigger value="data">Data</TabsTrigger>
        </TabsList>

        <TabsContent value="projects" className="mt-6 space-y-6">
          <ProjectScanSection />
          <Separator />
          <GoogleSheetsSection />
        </TabsContent>

        <TabsContent value="ai" className="mt-6 space-y-6">
          <ClaudeConfigSection />
          <Separator />
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <Label>MCP Server</Label>
                <p className="text-xs text-muted-foreground">Expose data via Model Context Protocol</p>
              </div>
              <Switch
                checked={settings?.mcpEnabled ?? false}
                onCheckedChange={(v) => updateSettings.mutate({ mcpEnabled: v })}
              />
            </div>
            {settings?.mcpEnabled && (
              <>
                <div className="flex items-center justify-between">
                  <div>
                    <Label>Require Auth</Label>
                    <p className="text-xs text-muted-foreground">Require OAuth for MCP connections</p>
                  </div>
                  <Switch
                    checked={settings?.mcpAuthRequired ?? false}
                    onCheckedChange={(v) => updateSettings.mutate({ mcpAuthRequired: v })}
                  />
                </div>
                <div className="rounded border p-3 text-xs space-y-2">
                  <div className="font-medium">MCP Endpoint</div>
                  <code className="block bg-muted px-2 py-1 rounded text-[11px]">POST http://localhost:3001/mcp</code>
                  <p className="text-muted-foreground">
                    Register OAuth clients via <code className="bg-muted px-1 rounded">POST /mcp/oauth/register</code> with a <code className="bg-muted px-1 rounded">redirect_uri</code>.
                    Get tokens via <code className="bg-muted px-1 rounded">POST /mcp/oauth/token</code>.
                  </p>
                </div>
              </>
            )}
          </div>
        </TabsContent>

        <TabsContent value="github" className="mt-6">
          <GitHubAccountsSection />
        </TabsContent>

        <TabsContent value="general" className="mt-6 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <Label>Sound Notifications</Label>
              <p className="text-xs text-muted-foreground">Play sound on AI completion</p>
            </div>
            <Switch
              checked={settings?.soundEnabled ?? false}
              onCheckedChange={(v) => updateSettings.mutate({ soundEnabled: v })}
            />
          </div>
          <Separator />
          <div className="flex items-center justify-between">
            <div>
              <Label>Terminal Shell</Label>
              <p className="text-xs text-muted-foreground">Shell used for terminal sessions</p>
            </div>
            <Select
              value={settings?.terminalShell ?? "cmd"}
              onValueChange={(v) => updateSettings.mutate({ terminalShell: v as any })}
            >
              <SelectTrigger className="w-[160px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="powershell">PowerShell</SelectItem>
                <SelectItem value="cmd">CMD</SelectItem>
                <SelectItem value="bash">Bash</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </TabsContent>

        <TabsContent value="notion" className="mt-6">
          <NotionConfigSection />
        </TabsContent>

        <TabsContent value="data" className="mt-6">
          <DataExportSection />
        </TabsContent>
      </Tabs>
    </div>
  );
}
