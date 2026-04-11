import { useState, useEffect, useCallback } from "react";
import { cn } from "@/lib/utils";
import { Send, Loader2, Plus, Trash2, Clock, Copy, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ApiRequest, HttpMethod, ApiRequestExecuteResult } from "@vibe-kanban/shared";

const METHODS: HttpMethod[] = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];

const METHOD_COLORS: Record<HttpMethod, string> = {
  GET: "text-green-400",
  POST: "text-yellow-400",
  PUT: "text-blue-400",
  PATCH: "text-orange-400",
  DELETE: "text-red-400",
  HEAD: "text-purple-400",
  OPTIONS: "text-gray-400",
};

interface HeaderRow {
  key: string;
  value: string;
}

interface RequestBuilderProps {
  request: ApiRequest | null;
  onSave: (updates: { name?: string; method?: HttpMethod; url?: string; headers?: string; body?: string; lastResponseStatus?: number | null; lastResponseTime?: number | null }) => void;
  onExecute: (params: { method: HttpMethod; url: string; headers: Record<string, string>; body?: string }) => Promise<ApiRequestExecuteResult>;
  executing: boolean;
}

function parseHeaders(jsonStr: string): HeaderRow[] {
  try {
    const obj = JSON.parse(jsonStr);
    const rows = Object.entries(obj).map(([key, value]) => ({ key, value: String(value) }));
    return rows.length > 0 ? rows : [{ key: "", value: "" }];
  } catch {
    return [{ key: "", value: "" }];
  }
}

function headersToJson(rows: HeaderRow[]): string {
  const obj: Record<string, string> = {};
  for (const row of rows) {
    if (row.key.trim()) obj[row.key.trim()] = row.value;
  }
  return JSON.stringify(obj);
}

function headersToRecord(rows: HeaderRow[]): Record<string, string> {
  const obj: Record<string, string> = {};
  for (const row of rows) {
    if (row.key.trim()) obj[row.key.trim()] = row.value;
  }
  return obj;
}

export default function RequestBuilder({ request, onSave, onExecute, executing }: RequestBuilderProps) {
  const [name, setName] = useState("");
  const [method, setMethod] = useState<HttpMethod>("GET");
  const [url, setUrl] = useState("");
  const [headers, setHeaders] = useState<HeaderRow[]>([{ key: "", value: "" }]);
  const [body, setBody] = useState("");
  const [response, setResponse] = useState<ApiRequestExecuteResult | null>(null);
  const [responseTab, setResponseTab] = useState("body");
  const [copied, setCopied] = useState(false);

  // Load request data
  useEffect(() => {
    if (request) {
      setName(request.name);
      setMethod(request.method);
      setUrl(request.url);
      setHeaders(parseHeaders(request.headers));
      setBody(request.body);
      setResponse(null);
    }
  }, [request?.id]);

  const saveTimeout = useCallback(() => {
    if (!request) return;
    const timer = setTimeout(() => {
      onSave({
        name,
        method,
        url,
        headers: headersToJson(headers),
        body,
      });
    }, 500);
    return () => clearTimeout(timer);
  }, [request, name, method, url, headers, body, onSave]);

  // Auto-save on changes (debounced)
  useEffect(() => {
    const cleanup = saveTimeout();
    return cleanup;
  }, [saveTimeout]);

  const handleExecute = async () => {
    if (!url.trim()) return;
    try {
      const result = await onExecute({
        method,
        url: url.trim(),
        headers: headersToRecord(headers),
        body: body || undefined,
      });
      setResponse(result);
      setResponseTab("body");
      // Save response info
      if (request) {
        onSave({
          lastResponseStatus: result.status,
          lastResponseTime: result.timeMs,
        });
      }
    } catch (err: any) {
      setResponse({
        status: 0,
        statusText: "Error",
        headers: {},
        body: err.message || "Request failed",
        timeMs: 0,
      });
    }
  };

  const handleAddHeader = () => {
    setHeaders([...headers, { key: "", value: "" }]);
  };

  const handleRemoveHeader = (index: number) => {
    setHeaders(headers.filter((_, i) => i !== index));
  };

  const handleHeaderChange = (index: number, field: "key" | "value", value: string) => {
    const newHeaders = [...headers];
    newHeaders[index] = { ...newHeaders[index], [field]: value };
    setHeaders(newHeaders);
  };

  const handleCopyResponse = () => {
    if (response?.body) {
      navigator.clipboard.writeText(response.body);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const statusColor = (status: number) => {
    if (status >= 200 && status < 300) return "text-green-400";
    if (status >= 300 && status < 400) return "text-yellow-400";
    if (status >= 400 && status < 500) return "text-orange-400";
    if (status >= 500) return "text-red-400";
    return "text-muted-foreground";
  };

  if (!request) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground/50">
        <div className="text-center">
          <Send className="h-10 w-10 mx-auto mb-3 opacity-50" />
          <p className="text-sm">Select or create a request</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Request name */}
      <div className="px-4 py-2 border-b border-border/40">
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="h-7 text-sm font-medium border-none shadow-none px-0 focus-visible:ring-0"
          placeholder="Request name..."
        />
      </div>

      {/* URL bar */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border/40 bg-secondary/20">
        <Select value={method} onValueChange={(v) => setMethod(v as HttpMethod)}>
          <SelectTrigger className={cn("w-28 h-9 text-xs font-bold font-mono", METHOD_COLORS[method])}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {METHODS.map((m) => (
              <SelectItem key={m} value={m} className={cn("text-xs font-mono font-bold", METHOD_COLORS[m])}>
                {m}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="http://localhost:3000/api/..."
          className="flex-1 h-9 font-mono text-sm"
          onKeyDown={(e) => { if (e.key === "Enter") handleExecute(); }}
        />

        <Button
          onClick={handleExecute}
          disabled={executing || !url.trim()}
          className="h-9 px-4 gap-2"
        >
          {executing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          Send
        </Button>
      </div>

      {/* Request body tabs */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <Tabs defaultValue="headers" className="flex-1 flex flex-col overflow-hidden">
          <TabsList className="mx-4 mt-2 w-fit">
            <TabsTrigger value="headers" className="text-xs">
              Headers
              {headers.filter((h) => h.key.trim()).length > 0 && (
                <span className="ml-1 text-[10px] text-muted-foreground">({headers.filter((h) => h.key.trim()).length})</span>
              )}
            </TabsTrigger>
            <TabsTrigger value="body" className="text-xs">Body</TabsTrigger>
          </TabsList>

          <TabsContent value="headers" className="flex-1 overflow-auto px-4 pb-2 mt-0">
            <div className="space-y-1.5 pt-2">
              {headers.map((h, i) => (
                <div key={i} className="flex items-center gap-2">
                  <Input
                    value={h.key}
                    onChange={(e) => handleHeaderChange(i, "key", e.target.value)}
                    placeholder="Header name"
                    className="h-8 text-xs font-mono flex-1"
                  />
                  <Input
                    value={h.value}
                    onChange={(e) => handleHeaderChange(i, "value", e.target.value)}
                    placeholder="Value"
                    className="h-8 text-xs font-mono flex-1"
                  />
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8 shrink-0"
                    onClick={() => handleRemoveHeader(i)}
                  >
                    <Trash2 className="h-3 w-3 text-muted-foreground/60" />
                  </Button>
                </div>
              ))}
              <Button size="sm" variant="ghost" className="h-7 text-xs gap-1" onClick={handleAddHeader}>
                <Plus className="h-3 w-3" /> Add Header
              </Button>
            </div>
          </TabsContent>

          <TabsContent value="body" className="flex-1 overflow-hidden px-4 pb-2 mt-0">
            <Textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder='{"key": "value"}'
              className="h-full min-h-[120px] font-mono text-xs resize-none mt-2"
            />
          </TabsContent>
        </Tabs>

        {/* Response section */}
        {response && (
          <div className="border-t border-border/50 flex flex-col overflow-hidden" style={{ maxHeight: "50%" }}>
            <div className="flex items-center gap-3 px-4 py-2 bg-secondary/30 border-b border-border/40">
              <span className="text-xs font-medium text-muted-foreground">Response</span>
              <span className={cn("text-sm font-bold font-mono", statusColor(response.status))}>
                {response.status} {response.statusText}
              </span>
              <div className="flex items-center gap-1 text-xs text-muted-foreground/60">
                <Clock className="h-3 w-3" />
                {response.timeMs}ms
              </div>
              <div className="ml-auto">
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-6 w-6"
                  onClick={handleCopyResponse}
                  title="Copy response"
                >
                  {copied ? <Check className="h-3 w-3 text-green-400" /> : <Copy className="h-3 w-3" />}
                </Button>
              </div>
            </div>

            <Tabs value={responseTab} onValueChange={setResponseTab} className="flex-1 flex flex-col overflow-hidden">
              <TabsList className="mx-4 mt-1 w-fit">
                <TabsTrigger value="body" className="text-xs">Body</TabsTrigger>
                <TabsTrigger value="headers" className="text-xs">
                  Headers ({Object.keys(response.headers).length})
                </TabsTrigger>
              </TabsList>

              <TabsContent value="body" className="flex-1 overflow-auto px-4 pb-2 mt-0">
                <pre className="text-xs font-mono whitespace-pre-wrap break-all pt-2 text-foreground/80">
                  {response.body}
                </pre>
              </TabsContent>

              <TabsContent value="headers" className="flex-1 overflow-auto px-4 pb-2 mt-0">
                <div className="space-y-1 pt-2">
                  {Object.entries(response.headers).map(([k, v]) => (
                    <div key={k} className="flex gap-2 text-xs font-mono">
                      <span className="text-muted-foreground/80 shrink-0">{k}:</span>
                      <span className="text-foreground/80 break-all">{v}</span>
                    </div>
                  ))}
                </div>
              </TabsContent>
            </Tabs>
          </div>
        )}
      </div>
    </div>
  );
}
