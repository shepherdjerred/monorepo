import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@scout-for-lol/desktop/components/ui/card.tsx";
import { Button } from "@scout-for-lol/desktop/components/ui/button.tsx";
import { Input } from "@scout-for-lol/desktop/components/ui/input.tsx";
import { Badge } from "@scout-for-lol/desktop/components/ui/badge.tsx";

type BackendStatus = {
  connected: boolean;
  backendUrl: string | null;
  lastError: string | null;
};

type BackendSectionProps = {
  backendStatus: BackendStatus;
  loading: string | null;
  apiToken: string;
  backendUrl: string;
  onApiTokenChange: (value: string) => void;
  onBackendUrlChange: (value: string) => void;
  onConfigure: () => void;
  onTestConnection: () => void;
};

export function BackendSection({
  backendStatus,
  loading,
  apiToken,
  backendUrl,
  onApiTokenChange,
  onBackendUrlChange,
  onConfigure,
  onTestConnection,
}: BackendSectionProps) {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-white">Backend Connection</h2>
        <p className="mt-1 text-gray-400">
          Configure the connection to the Scout backend service
        </p>
      </div>

      {/* Connection Status */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-3">
            Connection Status
            <Badge variant={backendStatus.connected ? "success" : "default"}>
              {backendStatus.connected ? "Connected" : "Not Connected"}
            </Badge>
          </CardTitle>
          <CardDescription>
            {backendStatus.connected
              ? `Connected to ${backendStatus.backendUrl ?? "backend"}`
              : "Configure your API token and backend URL to connect"}
          </CardDescription>
        </CardHeader>
        {backendStatus.lastError && (
          <CardContent>
            <p className="text-sm text-red-400">
              Last error: {backendStatus.lastError}
            </p>
          </CardContent>
        )}
      </Card>

      {/* Configuration Form */}
      <Card>
        <CardHeader>
          <CardTitle>Backend Configuration</CardTitle>
          <CardDescription>
            Enter your API token and backend URL. You can get these from the
            Scout web dashboard after logging in with Discord.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <label
              htmlFor="backend-url"
              className="mb-2 block text-sm font-medium text-gray-300"
            >
              Backend URL
            </label>
            <Input
              id="backend-url"
              type="text"
              placeholder="https://api.scoutforlol.com"
              value={backendUrl}
              onChange={(e) => {
                onBackendUrlChange(e.target.value);
              }}
            />
            <p className="mt-1 text-xs text-gray-500">
              The URL of the Scout backend service
            </p>
          </div>

          <div>
            <label
              htmlFor="api-token"
              className="mb-2 block text-sm font-medium text-gray-300"
            >
              API Token
            </label>
            <Input
              id="api-token"
              type="password"
              placeholder="Enter your API token"
              value={apiToken}
              onChange={(e) => {
                onApiTokenChange(e.target.value);
              }}
            />
            <p className="mt-1 text-xs text-gray-500">
              Your personal API token from the Scout dashboard
            </p>
          </div>

          <div className="flex gap-3">
            <Button
              onClick={onConfigure}
              disabled={loading !== null || !apiToken || !backendUrl}
            >
              {loading === "Configuring backend..."
                ? "Configuring..."
                : "Save Configuration"}
            </Button>
            <Button
              variant="secondary"
              onClick={onTestConnection}
              disabled={loading !== null || !backendStatus.connected}
            >
              {loading === "Testing connection..."
                ? "Testing..."
                : "Test Connection"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Help */}
      <Card>
        <CardHeader>
          <CardTitle>Getting Started</CardTitle>
          <CardDescription>
            How to set up your Scout backend connection
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-gray-400">
          <ol className="list-inside list-decimal space-y-2">
            <li>Visit the Scout web dashboard and log in with Discord</li>
            <li>Go to Settings and generate an API token</li>
            <li>Copy the backend URL and API token into the fields above</li>
            <li>Click &quot;Save Configuration&quot; to connect</li>
            <li>
              Configure your voice channel and sound pack in the web dashboard
            </li>
          </ol>
        </CardContent>
      </Card>
    </div>
  );
}
