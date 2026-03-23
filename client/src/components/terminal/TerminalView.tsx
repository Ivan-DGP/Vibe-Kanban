import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { useTerminalStore } from "@/hooks/useTerminal";
import "@xterm/xterm/css/xterm.css";

interface TerminalViewProps {
  sessionId: string;
}

export default function TerminalView({ sessionId }: TerminalViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const { sendInput, resizeSession, onMessage, offMessage } = useTerminalStore();

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let term: Terminal | null = null;
    let fitAddon: FitAddon | null = null;
    let resizeObserver: ResizeObserver | null = null;
    let waitObserver: ResizeObserver | null = null;

    let disposed = false;

    const safeFit = () => {
      if (disposed || !fitAddon || !term) return;
      try { fitAddon.fit(); } catch {}
    };

    const initTerminal = () => {
      term = new Terminal({
        fontSize: 13,
        fontFamily: "Consolas, 'Courier New', monospace",
        theme: {
          background: "#1a1a2e",
          foreground: "#e0e0e0",
          cursor: "#e0e0e0",
          selectionBackground: "#44475a",
        },
        cursorBlink: true,
        convertEol: true,
      });

      fitAddon = new FitAddon();
      term.loadAddon(fitAddon);
      term.loadAddon(new WebLinksAddon());

      term.open(container);
      // Delay first fit() to let the renderer initialize
      requestAnimationFrame(safeFit);

      term.onData((data) => sendInput(sessionId, data));
      term.onResize(({ cols, rows }) => resizeSession(sessionId, cols, rows));

      onMessage(sessionId, (msg) => {
        if (disposed || !term) return;
        if (msg.type === "output") {
          term.write(msg.data);
        } else if (msg.type === "exit") {
          term.writeln(`\r\n[Process exited with code ${msg.exitCode}]`);
        } else if (msg.type === "error") {
          term.writeln(`\r\n[Error: ${msg.message}]`);
        }
      });

      resizeObserver = new ResizeObserver(() => {
        safeFit();
      });
      resizeObserver.observe(container);

      term.focus();
    };

    // xterm.js crashes if the container has zero dimensions when open() is called.
    // Wait for the container to have real size before initializing.
    if (container.clientWidth > 0 && container.clientHeight > 0) {
      initTerminal();
    } else {
      waitObserver = new ResizeObserver((entries) => {
        const rect = entries[0]?.contentRect;
        if (rect && rect.width > 0 && rect.height > 0) {
          waitObserver!.disconnect();
          waitObserver = null;
          initTerminal();
        }
      });
      waitObserver.observe(container);
    }

    return () => {
      disposed = true;
      waitObserver?.disconnect();
      resizeObserver?.disconnect();
      offMessage(sessionId);
      term?.dispose();
    };
  }, [sessionId]);

  return <div ref={containerRef} className="h-full w-full" />;
}
