import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { useConsole } from "../hooks/useConsole";
import "@xterm/xterm/css/xterm.css";
import { X } from "lucide-react";

type ConsoleProps = {
  sessionId: string;
  sessionName: string;
  onClose: () => void;
}

export function Console({ sessionId, sessionName, onClose }: ConsoleProps) {
  const terminalRef = useRef<HTMLDivElement>(null);
  const terminalInstanceRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const { client, isConnected } = useConsole(sessionId);
  const [error, setError] = useState<string | null>(null);

  // Track current client and connection state for terminal input handler
  const clientRef = useRef({ client, isConnected });

  // Update ref whenever client or connection state changes
  useEffect(() => {
    clientRef.current = { client, isConnected };
  }, [client, isConnected]);

  // Initialize terminal
  useEffect(() => {
    if (!terminalRef.current) {
      return;
    }

    const terminal = new Terminal({
      cursorBlink: true,
      fontSize: 14,
      fontFamily: '"Berkeley Mono", Menlo, Monaco, "Courier New", monospace',
      theme: {
        background: "#1e1e1e",
        foreground: "#d4d4d4",
        cursor: "#d4d4d4",
        selectionBackground: "#264f78",
      },
      scrollback: 10000,
    });

    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);

    terminal.open(terminalRef.current);
    fitAddon.fit();

    terminalInstanceRef.current = terminal;
    fitAddonRef.current = fitAddon;

    // Handle terminal input
    terminal.onData((data) => {
      const { client: currentClient, isConnected: currentConnected } = clientRef.current;
      if (currentClient && currentConnected) {
        currentClient.write(data);
      }
    });

    // Handle window resize
    const handleResize = () => {
      fitAddon.fit();
      if (client && isConnected) {
        client.resize(terminal.rows, terminal.cols);
      }
    };

    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
      terminal.dispose();
    };
  }, []);

  // Handle WebSocket data
  useEffect(() => {
    if (!client || !terminalInstanceRef.current) {
      return;
    }

    const unsubscribe = client.onData((data) => {
      terminalInstanceRef.current?.write(data);
    });

    const unsubscribeError = client.onError((err) => {
      setError(err.message);
    });

    return () => {
      unsubscribe();
      unsubscribeError();
    };
  }, [client]);

  // Handle connection status changes
  useEffect(() => {
    if (isConnected && terminalInstanceRef.current && client) {
      // Notify backend of terminal size
      client.resize(
        terminalInstanceRef.current.rows,
        terminalInstanceRef.current.cols
      );
    }
  }, [isConnected, client]);

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
      <div className="bg-card rounded-lg max-w-6xl w-full h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b">
          <div className="flex items-center gap-3">
            <h2 className="text-xl font-bold">{sessionName}</h2>
            <div className="flex items-center gap-2">
              <div
                className={`w-2 h-2 rounded-full ${
                  isConnected ? "bg-green-500" : "bg-red-500"
                }`}
              />
              <span className="text-sm text-muted-foreground">
                {isConnected ? "Connected" : "Disconnected"}
              </span>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-secondary rounded-md transition-colors"
            title="Close console"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Error display */}
        {error && (
          <div className="p-4 bg-destructive/10 text-destructive border-b">
            Error: {error}
          </div>
        )}

        {/* Terminal */}
        <div className="flex-1 p-4 overflow-hidden">
          <div
            ref={terminalRef}
            className="w-full h-full rounded-md overflow-hidden"
          />
        </div>

        {/* Footer */}
        <div className="p-4 border-t text-sm text-muted-foreground">
          <p>
            Press <kbd className="px-2 py-1 bg-secondary rounded">Ctrl+C</kbd>{" "}
            to send interrupt signal. Close this window to detach (session
            continues running).
          </p>
        </div>
      </div>
    </div>
  );
}
