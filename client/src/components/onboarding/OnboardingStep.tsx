import type { ReactNode } from "react";

interface OnboardingStepProps {
  step: number;
  totalSteps: number;
  title: string;
  children: ReactNode;
}

export default function OnboardingStep({ step, totalSteps, title, children }: OnboardingStepProps) {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 mb-2">
        <div className="flex gap-1">
          {Array.from({ length: totalSteps }).map((_, i) => (
            <div
              key={i}
              className={`h-1.5 w-8 rounded-full ${i <= step ? "bg-primary" : "bg-muted"}`}
            />
          ))}
        </div>
        <span className="text-xs text-muted-foreground ml-auto">
          {step + 1} / {totalSteps}
        </span>
      </div>
      <h2 className="text-lg font-semibold">{title}</h2>
      {children}
    </div>
  );
}
