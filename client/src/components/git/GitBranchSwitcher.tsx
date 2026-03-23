import { useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { GitBranch, Check, Loader2 } from "lucide-react";
import { useGitBranches, useCheckoutBranch } from "@/hooks";

interface GitBranchSwitcherProps {
  projectId: string;
  currentBranch: string;
  subPath?: string;
}

export default function GitBranchSwitcher({ projectId, currentBranch, subPath }: GitBranchSwitcherProps) {
  const { data: branches } = useGitBranches(projectId, subPath);
  const checkout = useCheckoutBranch();
  const [open, setOpen] = useState(false);

  const handleCheckout = (name: string) => {
    checkout.mutate({ projectId, branch: name, subPath }, {
      onSuccess: () => setOpen(false),
    });
  };

  const localBranches = branches?.filter((b) => !b.remote) ?? [];
  const remoteBranches = branches?.filter((b) => b.remote) ?? [];

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-7 text-xs gap-1.5">
          <GitBranch className="h-3.5 w-3.5" />
          {currentBranch}
          {checkout.isPending && <Loader2 className="h-3 w-3 animate-spin" />}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-2" align="start">
        <ScrollArea className="max-h-[300px]">
          {localBranches.length > 0 && (
            <div className="mb-2">
              <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider px-2 mb-1">
                Local
              </div>
              {localBranches.map((b) => (
                <button
                  key={b.name}
                  className="flex items-center gap-2 w-full px-2 py-1 text-xs rounded hover:bg-accent disabled:opacity-50"
                  onClick={() => handleCheckout(b.name)}
                  disabled={b.current || checkout.isPending}
                >
                  {b.current && <Check className="h-3 w-3" />}
                  <span className={b.current ? "font-medium" : "ml-5"}>{b.name}</span>
                </button>
              ))}
            </div>
          )}
          {remoteBranches.length > 0 && (
            <div>
              <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider px-2 mb-1">
                Remote
              </div>
              {remoteBranches.map((b) => (
                <button
                  key={b.name}
                  className="flex items-center gap-2 w-full px-2 py-1 text-xs rounded hover:bg-accent text-muted-foreground"
                  onClick={() => handleCheckout(b.name.replace(/^origin\//, ""))}
                  disabled={checkout.isPending}
                >
                  <span className="ml-5 truncate">{b.name}</span>
                </button>
              ))}
            </div>
          )}
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}
