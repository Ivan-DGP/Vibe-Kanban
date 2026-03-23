import { useState } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useAppStore } from "@/stores/appStore";
import { useScanProjects, useCreateProject } from "@/hooks";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2, Rocket, FolderSearch, Keyboard, Sparkles } from "lucide-react";
import OnboardingStep from "./OnboardingStep";
import type { ScannedProject } from "@vibe-kanban/shared";

export default function OnboardingWizard() {
  const { onboardingComplete, setOnboardingComplete } = useAppStore();
  const [step, setStep] = useState(0);
  const [dirs, setDirs] = useState("");
  const [scanned, setScanned] = useState<ScannedProject[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const scan = useScanProjects();
  const create = useCreateProject();

  if (onboardingComplete) return null;

  const handleScan = () => {
    const list = dirs.split("\n").map((d) => d.trim()).filter(Boolean);
    if (list.length === 0) return;
    scan.mutate(list, {
      onSuccess: (results) => { setScanned(results); setSelected(new Set(results.map((_, i) => i))); },
    });
  };

  const handleImport = async () => {
    for (const [i, p] of scanned.entries()) {
      if (selected.has(i)) await create.mutateAsync({ name: p.name, path: p.path });
    }
    setStep(2);
  };

  const handleFinish = () => setOnboardingComplete(true);

  return (
    <Dialog open={!onboardingComplete} onOpenChange={() => {}}>
      <DialogContent className="sm:max-w-md" onPointerDownOutside={(e) => e.preventDefault()}>
        <DialogTitle className="sr-only">Welcome to Vibe Kanban</DialogTitle>
        {step === 0 && (
          <OnboardingStep step={0} totalSteps={3} title="Welcome to Vibe Kanban!">
            <div className="flex justify-center py-4">
              <Rocket className="h-16 w-16 text-primary" />
            </div>
            <p className="text-sm text-muted-foreground">
              Your local development dashboard for managing projects, tasks, git, terminals, and AI — all in one place.
            </p>
            <Button className="w-full mt-4" onClick={() => setStep(1)}>Get Started</Button>
          </OnboardingStep>
        )}

        {step === 1 && (
          <OnboardingStep step={1} totalSteps={3} title="Find Your Projects">
            <p className="text-sm text-muted-foreground mb-3">
              Enter directories to scan for projects (one per line):
            </p>
            <textarea
              value={dirs}
              onChange={(e) => setDirs(e.target.value)}
              placeholder={"C:/Users/me/projects\nC:/Users/me/work"}
              className="w-full min-h-[60px] rounded-md border bg-background px-3 py-2 text-sm"
              rows={3}
            />
            <Button variant="outline" onClick={handleScan} disabled={scan.isPending} className="w-full mt-2">
              {scan.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <FolderSearch className="h-4 w-4 mr-1" />}
              Scan
            </Button>

            {scanned.length > 0 && (
              <ScrollArea className="h-[150px] border rounded-md p-2 mt-2">
                {scanned.map((p, i) => (
                  <label key={i} className="flex items-start gap-2 p-1 rounded hover:bg-accent cursor-pointer">
                    <Checkbox checked={selected.has(i)} onCheckedChange={() => {
                      const s = new Set(selected); s.has(i) ? s.delete(i) : s.add(i); setSelected(s);
                    }} />
                    <div>
                      <div className="text-sm font-medium">{p.name}</div>
                      <div className="flex gap-1">{p.techStack.slice(0, 3).map((t) => <Badge key={t} variant="outline" className="text-[10px] px-1 py-0">{t}</Badge>)}</div>
                    </div>
                  </label>
                ))}
              </ScrollArea>
            )}

            <div className="flex gap-2 mt-4">
              <Button variant="outline" onClick={() => setStep(2)} className="flex-1">Skip</Button>
              {scanned.length > 0 && (
                <Button onClick={handleImport} disabled={selected.size === 0} className="flex-1">
                  Add {selected.size} Projects
                </Button>
              )}
            </div>
          </OnboardingStep>
        )}

        {step === 2 && (
          <OnboardingStep step={2} totalSteps={3} title="You're Ready!">
            <div className="space-y-3 text-sm text-muted-foreground">
              <div className="flex items-start gap-2">
                <Keyboard className="h-4 w-4 mt-0.5 shrink-0" />
                <span><strong>Ctrl+K</strong> — Command Palette for quick navigation</span>
              </div>
              <div className="flex items-start gap-2">
                <FolderSearch className="h-4 w-4 mt-0.5 shrink-0" />
                <span><strong>Ctrl+Shift+F</strong> — Global search across projects and tasks</span>
              </div>
              <div className="flex items-start gap-2">
                <Sparkles className="h-4 w-4 mt-0.5 shrink-0" />
                <span>Use <strong>AI Resolve</strong> on tasks to let Claude implement them</span>
              </div>
            </div>
            <Button className="w-full mt-6" onClick={handleFinish}>Start Using Vibe Kanban</Button>
          </OnboardingStep>
        )}
      </DialogContent>
    </Dialog>
  );
}
