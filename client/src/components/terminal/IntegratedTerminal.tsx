import { useEffect, useRef, useCallback } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { getWebSocketUrl } from "@/hooks/useTerminal";
import "@xterm/xterm/css/xterm.css";

interface IntegratedTerminalProps {
  sessionId: string;
  onExit?: (exitCode: number) => void;
}

const MAX_RECONNECT_ATTEMPTS = 5;
const BASE_RECONNECT_DELAY = 500;

export default function IntegratedTerminal({ sessionId, onExit }: IntegratedTerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectAttemptRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout>>();
  const disposedRef = useRef(false);
  const connectionGenRef = useRef(0);
  // Keystrokes typed while the socket is (re)connecting — buffered here and
  // flushed on open, so no input is lost during a reconnect.
  const pendingInputRef = useRef<string[]>([]);

  const safeFit = useCallback(() => {
    if (disposedRef.current || !fitRef.current || !termRef.current) return;
    try {
      fitRef.current.fit();
    } catch {}
  }, []);

  // Send input if the socket is open; otherwise buffer it for the next open.
  const sendInput = useCallback((data: string) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "input", data }));
    } else {
      pendingInputRef.current.push(data);
    }
  }, []);

  const connectWs = useCallback(() => {
    if (disposedRef.current) return;

    // Track connection generation to prevent stale reconnects
    const gen = ++connectionGenRef.current;

    const ws = new WebSocket(getWebSocketUrl(sessionId));
    wsRef.current = ws;

    ws.onopen = () => {
      if (gen !== connectionGenRef.current) {
        ws.close();
        return;
      }
      reconnectAttemptRef.current = 0;
      // Send initial resize so server knows our dimensions
      if (termRef.current) {
        const { cols, rows } = termRef.current;
        ws.send(JSON.stringify({ type: "resize", cols, rows }));
      }
      // Flush any keystrokes buffered while (re)connecting.
      if (pendingInputRef.current.length) {
        const pending = pendingInputRef.current;
        pendingInputRef.current = [];
        for (const data of pending) ws.send(JSON.stringify({ type: "input", data }));
      }
    };

    ws.onmessage = (event) => {
      try {
        if (gen !== connectionGenRef.current) return;
        const msg = JSON.parse(event.data);
        if (!termRef.current || disposedRef.current) return;

        switch (msg.type) {
          case "output":
            termRef.current.write(msg.data);
            break;
          case "exit":
            termRef.current.writeln(`\r\n[Process exited with code ${msg.exitCode}]`);
            onExit?.(msg.exitCode);
            break;
          case "error":
            termRef.current.writeln(`\r\n[Error: ${msg.message}]`);
            break;
        }
      } catch {}
    };

    ws.onclose = () => {
      // Only reconnect if this is still the current connection generation
      if (disposedRef.current || gen !== connectionGenRef.current) return;
      // Exponential backoff reconnection
      if (reconnectAttemptRef.current < MAX_RECONNECT_ATTEMPTS) {
        const delay = BASE_RECONNECT_DELAY * Math.pow(2, reconnectAttemptRef.current);
        reconnectAttemptRef.current++;
        reconnectTimerRef.current = setTimeout(connectWs, delay);
      }
    };

    ws.onerror = () => {
      // onclose will fire after this, triggering reconnect
    };
  }, [sessionId, onExit]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    disposedRef.current = false;
    let resizeObserver: ResizeObserver | null = null;
    let waitObserver: ResizeObserver | null = null;

    const initTerminal = () => {
      const term = new Terminal({
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
      termRef.current = term;

      const fitAddon = new FitAddon();
      fitRef.current = fitAddon;
      term.loadAddon(fitAddon);
      term.loadAddon(new WebLinksAddon());

      term.open(container);
      requestAnimationFrame(safeFit);

      // Input → WebSocket (buffered across reconnects)
      term.onData((data) => sendInput(data));

      // Binary mouse reports
      term.onBinary((data) => {
        const ws = wsRef.current;
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "binary", data }));
        }
      });

      // Clipboard: Ctrl+C to copy selection or send SIGINT, Ctrl+V to paste
      term.attachCustomKeyEventHandler((ev) => {
        if (ev.type !== "keydown") return true;

        if (ev.ctrlKey && ev.key === "c") {
          const selection = term.getSelection();
          if (selection) {
            navigator.clipboard.writeText(selection);
            term.clearSelection();
            return false; // prevent sending to PTY
          }
          // No selection → send SIGINT (let it through)
          return true;
        }

        if (ev.ctrlKey && ev.key === "v") {
          navigator.clipboard
            .readText()
            .then((text) => sendInput(text))
            .catch(() => {});
          return false;
        }

        return true;
      });

      // Resize → WebSocket
      term.onResize(({ cols, rows }) => {
        const ws = wsRef.current;
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "resize", cols, rows }));
        }
      });

      // ResizeObserver → FitAddon
      resizeObserver = new ResizeObserver(() => safeFit());
      resizeObserver.observe(container);

      // Connect WebSocket
      connectWs();

      term.focus();
    };

    // Wait for container to have dimensions before initializing
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
      disposedRef.current = true;
      connectionGenRef.current++; // invalidate any in-flight WS callbacks
      clearTimeout(reconnectTimerRef.current);
      waitObserver?.disconnect();
      resizeObserver?.disconnect();
      wsRef.current?.close();
      wsRef.current = null;
      termRef.current?.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
  }, [sessionId, connectWs, safeFit, sendInput]);

  return <div ref={containerRef} className="h-full w-full" />;
}
