import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Search, FileCode } from "lucide-react";
import { useAppStore } from "@/stores/appStore";
import { useFileSearch } from "@/hooks";

interface FileContentSearchProps {
  projectId?: string;
}

export default function FileContentSearch({ projectId }: FileContentSearchProps) {
  const { fileSearchOpen, setFileSearchOpen } = useAppStore();
  const [query, setQuery] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);

  const { data: results } = useFileSearch(
    fileSearchOpen ? projectId : undefined,
    query,
    caseSensitive,
  );

  return (
    <Dialog
      open={fileSearchOpen}
      onOpenChange={(v) => {
        setFileSearchOpen(v);
        if (!v) setQuery("");
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>File Content Search</DialogTitle>
        </DialogHeader>

        {!projectId ? (
          <p className="text-sm text-muted-foreground">
            Open a project first to search file contents.
          </p>
        ) : (
          <>
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search in files..."
                  className="pl-9"
                  autoFocus
                />
              </div>
              <div className="flex items-center gap-1.5">
                <Switch
                  id="case-sensitive"
                  checked={caseSensitive}
                  onCheckedChange={setCaseSensitive}
                  className="h-4 w-8"
                />
                <Label htmlFor="case-sensitive" className="text-xs">
                  Aa
                </Label>
              </div>
            </div>

            <ScrollArea className="h-[300px]">
              {Array.isArray(results) && results.length > 0 ? (
                <div className="space-y-1">
                  {(results as Array<{ file: string; line: number; content: string }>).map(
                    (result, i) => (
                      <div
                        key={i}
                        className="flex items-start gap-2 px-2 py-1 text-xs rounded hover:bg-accent cursor-pointer"
                      >
                        <FileCode className="h-3.5 w-3.5 mt-0.5 shrink-0 text-muted-foreground" />
                        <div className="min-w-0 flex-1">
                          <div className="font-medium truncate">
                            {result.file}:{result.line}
                          </div>
                          <div className="text-muted-foreground truncate">{result.content}</div>
                        </div>
                      </div>
                    ),
                  )}
                </div>
              ) : query.length >= 2 ? (
                <p className="text-sm text-muted-foreground text-center py-8">No results found</p>
              ) : null}
            </ScrollArea>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
