import { PanelGroup, Panel, PanelResizeHandle } from "react-resizable-panels";
import IntegratedTerminal from "./IntegratedTerminal";

interface TerminalSplitViewProps {
  primarySessionId: string;
  splitSessionId: string;
}

export default function TerminalSplitView({
  primarySessionId,
  splitSessionId,
}: TerminalSplitViewProps) {
  return (
    <PanelGroup direction="horizontal">
      <Panel minSize={20}>
        <IntegratedTerminal key={primarySessionId} sessionId={primarySessionId} />
      </Panel>
      <PanelResizeHandle className="w-1 bg-border hover:bg-primary/50 transition-colors" />
      <Panel minSize={20}>
        <IntegratedTerminal key={splitSessionId} sessionId={splitSessionId} />
      </Panel>
    </PanelGroup>
  );
}
