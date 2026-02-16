import { Play, Square, AlertTriangle, CheckCircle2 } from "lucide-react";
import { Button } from "@scout-for-lol/desktop/components/ui/button.tsx";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@scout-for-lol/desktop/components/ui/card.tsx";
import {
  StatusIndicator,
  Badge,
} from "@scout-for-lol/desktop/components/ui/badge.tsx";

type MonitorSectionProps = {
  isMonitoring: boolean;
  loading: string | null;
  lcuConnected: boolean;
  backendConnected: boolean;
  inGame: boolean;
  onStart: () => void;
  onStop: () => void;
  onTest?: () => void;
};

type MonitoringState = "starting" | "active" | "ready" | "setup-required";

function getMonitoringState(
  isStarting: boolean,
  isMonitoring: boolean,
  canMonitor: boolean,
): MonitoringState {
  if (isStarting) {
    return "starting";
  }
  if (isMonitoring) {
    return "active";
  }
  if (canMonitor) {
    return "ready";
  }
  return "setup-required";
}

function getStatusIndicatorProps(state: MonitoringState): {
  status: "connecting" | "active" | "idle" | "disconnected";
  label: string;
} {
  switch (state) {
    case "starting":
      return { status: "connecting", label: "Starting..." };
    case "active":
      return { status: "active", label: "Active" };
    case "ready":
      return { status: "idle", label: "Ready" };
    case "setup-required":
      return { status: "disconnected", label: "Setup Required" };
  }
}

const TRACKED_EVENTS = [
  "Kills",
  "Multi-kills",
  "First Blood",
  "Objectives",
  "Aces",
  "Game End",
];

export function MonitorSection({
  isMonitoring,
  loading,
  lcuConnected,
  backendConnected,
  inGame,
  onStart,
  onStop,
  onTest,
}: MonitorSectionProps) {
  const isStarting = loading?.includes("Starting") ?? false;
  const isStopping = loading?.includes("Stopping");
  const isTesting = loading?.includes("Testing") ?? loading?.includes("event");
  const canMonitor = lcuConnected && backendConnected;

  const monitoringState = getMonitoringState(
    isStarting,
    isMonitoring,
    canMonitor,
  );
  const statusProps = getStatusIndicatorProps(monitoringState);

  return (
    <div className="space-y-8 animate-fade-in">
      {/* Header */}
      <div className="space-y-2">
        <h2 className="text-2xl font-bold text-gray-100">Game Monitoring</h2>
        <p className="text-gray-400">
          Track in-game events and send real-time updates to Discord
        </p>
      </div>

      {/* Prerequisites Check */}
      {!canMonitor && (
        <Card
          variant="bordered"
          className="border-discord-yellow/30 bg-discord-yellow/5"
        >
          <CardContent className="flex items-start gap-5">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-discord-yellow/20">
              <AlertTriangle className="h-5 w-5 text-discord-yellow" />
            </div>
            <div>
              <h3 className="font-medium text-discord-yellow">
                Complete Setup Required
              </h3>
              <p className="mt-2 text-sm text-gray-400">
                Connect to both League Client and Discord before starting
                monitoring.
              </p>
              <div className="mt-4 flex flex-wrap gap-3">
                <PrerequisiteBadge
                  label="League Client"
                  fulfilled={lcuConnected}
                />
                <PrerequisiteBadge
                  label="Backend"
                  fulfilled={backendConnected}
                />
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Main Monitoring Card */}
      <Card variant="glass">
        <CardHeader>
          <CardTitle>Monitoring Status</CardTitle>
          <CardDescription>
            <div className="mt-2">
              <StatusIndicator
                status={statusProps.status}
                label={statusProps.label}
              />
            </div>
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-8">
          {/* Game Status */}
          {canMonitor && (
            <div className="flex items-center gap-4 rounded-lg bg-gray-900/50 p-5">
              <div className="flex-1">
                <p className="text-sm text-gray-400">Game Status</p>
                <p className="text-lg font-semibold text-gray-100">
                  {inGame ? "In Game" : "Not in Game"}
                </p>
              </div>
              {inGame && (
                <Badge variant="success" dot pulse>
                  Live
                </Badge>
              )}
            </div>
          )}

          {/* What Gets Tracked */}
          {isMonitoring && (
            <div className="rounded-lg border border-gray-700/50 bg-gray-900/30 p-5">
              <h4 className="mb-4 text-sm font-medium text-gray-200">
                Events Being Tracked
              </h4>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {TRACKED_EVENTS.map((event) => (
                  <div
                    key={event}
                    className="flex items-center gap-2 rounded-lg bg-gray-800/50 px-4 py-2.5 text-sm text-gray-300"
                  >
                    <span className="h-2 w-2 rounded-full bg-discord-green" />
                    {event}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex flex-wrap gap-3 pt-4">
            {!isMonitoring ? (
              <Button
                variant="success"
                size="lg"
                className="flex-1"
                onClick={onStart}
                loading={isStarting}
                disabled={!canMonitor}
                icon={<Play className="h-5 w-5" />}
              >
                Start Monitoring
              </Button>
            ) : (
              <>
                <Button
                  variant="destructive"
                  size="lg"
                  className="flex-1"
                  onClick={onStop}
                  loading={isStopping}
                  icon={<Square className="h-5 w-5" />}
                >
                  Stop Monitoring
                </Button>
                {onTest && (
                  <Button
                    variant="outline"
                    size="lg"
                    onClick={onTest}
                    loading={isTesting}
                  >
                    Test Events
                  </Button>
                )}
              </>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function PrerequisiteBadge({
  label,
  fulfilled,
}: {
  label: string;
  fulfilled: boolean;
}) {
  return (
    <div
      className={`flex items-center gap-2 rounded-full px-4 py-1.5 text-sm font-medium ${
        fulfilled
          ? "bg-discord-green/20 text-discord-green"
          : "bg-gray-700/50 text-gray-400"
      }`}
    >
      {fulfilled ? (
        <CheckCircle2 className="h-4 w-4" />
      ) : (
        <div className="h-4 w-4 rounded-full border-2 border-current" />
      )}
      {label}
    </div>
  );
}
