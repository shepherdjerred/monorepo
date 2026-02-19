import { useState, useCallback, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Sidebar } from "./components/layout/sidebar.tsx";
import { LeagueSection } from "./components/sections/league-section.tsx";
import { BackendSection } from "./components/sections/backend-section.tsx";
import { MonitorSection } from "./components/sections/monitor-section.tsx";
import { DebugPanel } from "./components/sections/debug-panel.tsx";
import { Alert } from "./components/ui/alert.tsx";
import type {
  LcuStatus,
  BackendStatus,
  Config,
  LogEntry,
  LogPaths,
  Section,
} from "./types.ts";
import { getErrorMessage } from "./types.ts";

export default function App() {
  // Navigation state
  const [activeSection, setActiveSection] = useState<Section>("league");

  // Connection states
  const [lcuStatus, setLcuStatus] = useState<LcuStatus>({
    connected: false,
    summonerName: null,
    inGame: false,
  });

  const [backendStatus, setBackendStatus] = useState<BackendStatus>({
    connected: false,
    backendUrl: null,
    lastError: null,
  });

  // Form states
  const [apiToken, setApiToken] = useState("");
  const [backendUrl, setBackendUrl] = useState("");

  // App states
  const [isMonitoring, setIsMonitoring] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<string | null>(null);
  const [showDebug, setShowDebug] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [logPaths, setLogPaths] = useState<LogPaths | null>(null);

  const addLog = (level: LogEntry["level"], message: string) => {
    const timestamp = new Date().toLocaleTimeString();
    setLogs((prev) => [...prev.slice(-99), { timestamp, level, message }]);
  };

  const loadStatus = useCallback(async () => {
    try {
      const lcu = await invoke<LcuStatus>("get_lcu_status");
      setLcuStatus(lcu);

      const backend = await invoke<BackendStatus>("get_backend_status");
      setBackendStatus(backend);
    } catch (error_) {
      console.error("Failed to load status:", error_);
    }
  }, []);

  // Load config on mount
   
  useEffect(() => {
    const loadConfig = async () => {
      try {
        const config = await invoke<Config>("load_config");
        if (config.apiToken !== null && config.apiToken.length > 0) {
          setApiToken(config.apiToken);
        }
        if (config.backendUrl !== null && config.backendUrl.length > 0) {
          setBackendUrl(config.backendUrl);
        }
        if (config.apiToken !== null && config.apiToken.length > 0 || config.backendUrl !== null && config.backendUrl.length > 0) {
          addLog("info", "Loaded saved backend configuration");
        }

        // Fetch log paths for easier debugging
        try {
          const paths = await invoke<LogPaths>("get_log_paths");
          setLogPaths(paths);
          addLog(
            "info",
            `Log files: ${paths.logs_dir} (logs dir), ${paths.debug_log} (debug log)`,
          );
        } catch (error_) {
          console.error("Failed to load log paths:", error_);
        }
      } catch (error_) {
        console.error("Failed to load config:", error_);
      }
    };

    void loadConfig();
  }, []);

  // Load status on mount and setup polling
   
  useEffect(() => {
    void loadStatus();
    const interval = setInterval(() => {
      void loadStatus();
    }, 5000);
    return () => {
      clearInterval(interval);
    };
  }, [loadStatus]);

  // Listen for backend logs
   
  useEffect(() => {
    const unlisten = listen<string>("backend-log", (event) => {
      addLog("info", event.payload);
    });

    return () => {
      void (async () => {
        const fn = await unlisten;
        fn();
      })();
    };
  }, []);

  const handleConnectLcu = async () => {
    setError(null);
    setLoading("Connecting to League Client...");
    addLog("info", "Attempting to connect to League Client...");

    try {
      await invoke("connect_lcu");
      await loadStatus();
      addLog("info", "Successfully connected to League Client");
    } catch (error_) {
      const errorMsg = getErrorMessage(error_);
      setError(errorMsg);
      addLog("error", `Failed to connect to League Client: ${errorMsg}`);
    } finally {
      setLoading(null);
    }
  };

  const handleDisconnectLcu = async () => {
    setError(null);
    setLoading("Disconnecting from League Client...");
    addLog("info", "Disconnecting from League Client...");

    try {
      await invoke("disconnect_lcu");
      await loadStatus();
      addLog("info", "Disconnected from League Client");
    } catch (error_) {
      const errorMsg = getErrorMessage(error_);
      setError(errorMsg);
      addLog("error", `Failed to disconnect: ${errorMsg}`);
    } finally {
      setLoading(null);
    }
  };

  const handleConfigureBackend = async () => {
    if (!apiToken || !backendUrl) {
      setError("Please provide both API token and backend URL");
      return;
    }

    setError(null);
    setLoading("Configuring backend...");
    addLog("info", `Configuring backend at ${backendUrl}...`);

    try {
      await invoke("configure_backend", {
        apiToken,
        backendUrl,
      });
      await loadStatus();
      addLog("info", "Backend configured successfully");
    } catch (error_) {
      const errorMsg = getErrorMessage(error_);
      setError(errorMsg);
      addLog("error", `Failed to configure backend: ${errorMsg}`);
    } finally {
      setLoading(null);
    }
  };

  const handleTestBackendConnection = async () => {
    setError(null);
    setLoading("Testing connection...");
    addLog("info", "Testing backend connection...");

    try {
      await invoke("test_backend_connection");
      addLog("info", "Backend connection test successful");
    } catch (error_) {
      const errorMsg = getErrorMessage(error_);
      setError(errorMsg);
      addLog("error", `Backend connection test failed: ${errorMsg}`);
    } finally {
      setLoading(null);
    }
  };

  const handleStartMonitoring = async () => {
    setError(null);
    setLoading("Starting monitoring...");
    addLog("info", "Starting game monitoring...");

    try {
      await invoke("start_monitoring");
      setIsMonitoring(true);
      addLog("info", "Game monitoring started successfully");

      // Check diagnostics after starting
      try {
        const diagnostics = await invoke<{
          gameflow_phase: string;
          live_client_data_available: boolean;
          live_client_data_status: number | null;
          error_message: string | null;
        }>("get_diagnostics");

        addLog("info", `Gameflow phase: ${diagnostics.gameflow_phase}`);
        if (diagnostics.live_client_data_available) {
          addLog(
            "info",
            `Live Client Data API: Available (status: ${String(diagnostics.live_client_data_status)})`,
          );
        } else {
          addLog("error", `Live Client Data API: NOT AVAILABLE`);
          addLog(
            "error",
            `To enable: League Client → Settings → Game → Enable Live Client Data API`,
          );
          addLog("error", `Then restart League Client and reconnect.`);
          if (diagnostics.error_message !== null && diagnostics.error_message.length > 0) {
            addLog("error", `Error: ${diagnostics.error_message}`);
          }
        }
      } catch (error_) {
        addLog(
          "warning",
          `Could not get diagnostics: ${getErrorMessage(error_)}`,
        );
      }
    } catch (error_) {
      const errorMsg = getErrorMessage(error_);
      setError(errorMsg);
      addLog("error", `Failed to start monitoring: ${errorMsg}`);
    } finally {
      setLoading(null);
    }
  };

  const handleStopMonitoring = async () => {
    setError(null);
    setLoading("Stopping monitoring...");
    addLog("info", "Stopping game monitoring...");

    try {
      await invoke("stop_monitoring");
      setIsMonitoring(false);
      addLog("info", "Game monitoring stopped");
    } catch (error_) {
      const errorMsg = getErrorMessage(error_);
      setError(errorMsg);
      addLog("error", `Failed to stop monitoring: ${errorMsg}`);
    } finally {
      setLoading(null);
    }
  };

  const handleClearLogs = () => {
    setLogs([]);
  };

  // Render active section content
  const renderSection = () => {
    switch (activeSection) {
      case "league":
        return (
          <LeagueSection
            lcuStatus={lcuStatus}
            loading={loading}
            onConnect={() => void handleConnectLcu()}
            onDisconnect={() => void handleDisconnectLcu()}
          />
        );
      case "backend":
        return (
          <BackendSection
            backendStatus={backendStatus}
            loading={loading}
            apiToken={apiToken}
            backendUrl={backendUrl}
            onApiTokenChange={setApiToken}
            onBackendUrlChange={setBackendUrl}
            onConfigure={() => void handleConfigureBackend()}
            onTestConnection={() => void handleTestBackendConnection()}
          />
        );
      case "monitor":
        return (
          <MonitorSection
            isMonitoring={isMonitoring}
            loading={loading}
            lcuConnected={lcuStatus.connected}
            backendConnected={backendStatus.connected}
            inGame={lcuStatus.inGame}
            onStart={() => void handleStartMonitoring()}
            onStop={() => void handleStopMonitoring()}
          />
        );
    }
  };

  return (
    <div className="flex h-screen bg-gray-900">
      {/* Sidebar */}
      <Sidebar
        lcuConnected={lcuStatus.connected}
        backendConnected={backendStatus.connected}
        isMonitoring={isMonitoring}
        activeSection={activeSection}
        onSectionChange={setActiveSection}
        showDebug={showDebug}
        onToggleDebug={() => {
          setShowDebug(!showDebug);
        }}
      />

      {/* Main Content */}
      <main className="flex flex-1 flex-col overflow-hidden">
        {/* Error/Loading Alerts */}
        {(error !== null || loading !== null) && (
          <div className="border-b border-gray-800 px-8 py-5 space-y-4">
            {error !== null && error.length > 0 && (
              <Alert
                variant="error"
                onDismiss={() => {
                  setError(null);
                }}
              >
                {error}
              </Alert>
            )}
            {loading !== null && loading.length > 0 && <Alert variant="loading">{loading}</Alert>}
          </div>
        )}

        {/* Section Content */}
        <div className="flex-1 overflow-y-auto px-8 py-8">
          {renderSection()}
        </div>
      </main>

      {/* Debug Panel */}
      {showDebug && (
        <DebugPanel
          lcuStatus={lcuStatus}
          backendStatus={backendStatus}
          isMonitoring={isMonitoring}
          logs={logs}
          logPaths={logPaths}
          onClearLogs={handleClearLogs}
          onClose={() => {
            setShowDebug(false);
          }}
        />
      )}
    </div>
  );
}
