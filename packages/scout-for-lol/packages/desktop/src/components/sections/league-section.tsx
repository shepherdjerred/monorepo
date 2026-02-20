import { Link2, Unlink, User } from "lucide-react";
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

type LcuStatus = {
  connected: boolean;
  summonerName: string | null;
  inGame: boolean;
};

type LeagueSectionProps = {
  lcuStatus: LcuStatus;
  loading: string | null;
  onConnect: () => void;
  onDisconnect: () => void;
};

export function LeagueSection({
  lcuStatus,
  loading,
  onConnect,
  onDisconnect,
}: LeagueSectionProps) {
  const isConnecting = loading?.includes("League");

  return (
    <div className="space-y-8 animate-fade-in">
      {/* Header */}
      <div className="space-y-2">
        <h2 className="text-2xl font-bold text-gray-100">League Client</h2>
        <p className="text-gray-400">
          Connect to your League of Legends client to enable game monitoring
        </p>
      </div>

      {/* Main Card */}
      <Card variant="glass">
        <CardHeader>
          <CardTitle>Connection Status</CardTitle>
          <CardDescription>
            <div className="mt-2">
              <StatusIndicator
                status={
                  isConnecting === true
                    ? "connecting"
                    : lcuStatus.connected
                      ? "connected"
                      : "disconnected"
                }
              />
            </div>
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-8">
          {/* Summoner Info */}
          {lcuStatus.connected &&
            lcuStatus.summonerName !== null &&
            lcuStatus.summonerName.length > 0 && (
              <div className="flex items-center gap-4 rounded-lg bg-gray-900/50 p-5">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-lol-gold/20 to-lol-accent/20 ring-2 ring-lol-gold/30">
                  <User className="h-6 w-6 text-lol-gold" />
                </div>
                <div className="flex-1">
                  <p className="text-sm text-gray-400">Logged in as</p>
                  <p className="text-lg font-semibold text-gray-100">
                    {lcuStatus.summonerName}
                  </p>
                </div>
                {lcuStatus.inGame && (
                  <Badge variant="success" dot pulse>
                    In Game
                  </Badge>
                )}
              </div>
            )}

          {/* Connection Info */}
          {!lcuStatus.connected && (
            <div className="rounded-lg border border-gray-700/50 bg-gray-900/30 p-6">
              <h4 className="mb-4 text-sm font-medium text-gray-200">
                How it works
              </h4>
              <ul className="space-y-4 text-sm text-gray-400">
                <li className="flex items-start gap-3">
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-discord-blurple" />
                  <span>Make sure League of Legends is running</span>
                </li>
                <li className="flex items-start gap-3">
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-discord-blurple" />
                  <span>Scout will auto-detect the client and connect</span>
                </li>
                <li className="flex items-start gap-3">
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-discord-blurple" />
                  <span>
                    Enable &quot;Live Client Data API&quot; in League settings
                    for full features
                  </span>
                </li>
              </ul>
            </div>
          )}

          {/* Action Button */}
          <div className="pt-4">
            {lcuStatus.connected ? (
              <Button
                variant="outline"
                size="lg"
                className="w-full"
                onClick={onDisconnect}
                loading={isConnecting}
                icon={<Unlink className="h-5 w-5" />}
              >
                Disconnect
              </Button>
            ) : (
              <Button
                size="lg"
                className="w-full"
                onClick={onConnect}
                loading={isConnecting}
                icon={<Link2 className="h-5 w-5" />}
              >
                Connect to League Client
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
