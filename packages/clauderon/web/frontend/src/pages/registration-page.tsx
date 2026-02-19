import { useState } from "react";
import { create } from "@github/webauthn-json";
import { useClauderonClient } from "@shepherdjerred/clauderon/web/frontend/src/hooks/useClauderonClient";
import { useAuth } from "@shepherdjerred/clauderon/web/frontend/src/contexts/AuthContext";

export function RegistrationPage() {
  const client = useClauderonClient();
  const { refreshAuthStatus } = useAuth();
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [deviceName, setDeviceName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleRegister = async (e: React.SyntheticEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    setIsLoading(true);

    try {
      // Start registration flow - options is typed as 'any' from TypeShare
      const trimmedDisplayName = displayName.trim();
      const response = await client.registerStart({
        username,
        ...(trimmedDisplayName && { display_name: trimmedDisplayName }),
      });

      // Trigger passkey creation
      // response.options is 'any' from the generated type, create() accepts CredentialCreationOptionsJSON
      const credential = await create(response.options);

      // Finish registration flow - credential field accepts 'any' in the generated type
      const trimmedDeviceName = deviceName.trim();
      await client.registerFinish({
        username,
        challenge_id: response.challenge_id,
        credential,
        ...(trimmedDeviceName && { device_name: trimmedDeviceName }),
      });

      // Refresh auth status
      await refreshAuthStatus();
    } catch (error_) {
      console.error("Registration error:", error_);
      setError(
        error_ instanceof Error
          ? error_.message
          : "Failed to create account. Please try again.",
      );
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex items-center justify-center min-h-screen bg-background">
      <div className="w-full max-w-md p-8 space-y-6 bg-card rounded-lg shadow-lg border">
        <div className="text-center">
          <h1 className="text-3xl font-bold">Welcome to Clauderon</h1>
          <p className="text-muted-foreground mt-2">
            Create your account with a passkey
          </p>
        </div>

        <form
          onSubmit={(e) => {
            void handleRegister(e);
          }}
          className="space-y-4"
        >
          <div>
            <label
              htmlFor="username"
              className="block text-sm font-medium mb-2"
            >
              Username *
            </label>
            <input
              id="username"
              type="text"
              value={username}
              onChange={(e) => {
                setUsername(e.target.value);
              }}
              required
              autoComplete="username webauthn"
              className="w-full px-3 py-2 border rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-primary"
              placeholder="Choose a username"
              disabled={isLoading}
            />
          </div>

          <div>
            <label
              htmlFor="displayName"
              className="block text-sm font-medium mb-2"
            >
              Display Name (optional)
            </label>
            <input
              id="displayName"
              type="text"
              value={displayName}
              onChange={(e) => {
                setDisplayName(e.target.value);
              }}
              className="w-full px-3 py-2 border rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-primary"
              placeholder="Your display name"
              disabled={isLoading}
            />
          </div>

          <div>
            <label
              htmlFor="deviceName"
              className="block text-sm font-medium mb-2"
            >
              Device Name (optional)
            </label>
            <input
              id="deviceName"
              type="text"
              value={deviceName}
              onChange={(e) => {
                setDeviceName(e.target.value);
              }}
              className="w-full px-3 py-2 border rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-primary"
              placeholder="e.g., MacBook Pro, iPhone"
              disabled={isLoading}
            />
            <p className="text-xs text-muted-foreground mt-1">
              Helps you identify this passkey later
            </p>
          </div>

          {error != null && error.length > 0 && (
            <div className="p-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded-md">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={isLoading || !username.trim()}
            className="w-full px-4 py-2 font-medium text-white bg-primary rounded-md hover:bg-primary/90 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isLoading ? (
              <span className="flex items-center justify-center">
                <span className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></span>
                Creating account...
              </span>
            ) : (
              "Create Account with Passkey"
            )}
          </button>
        </form>

        <div className="text-center text-sm text-muted-foreground space-y-2">
          <p>This will create a passkey on your device</p>
          <p>Use Face ID, Touch ID, Windows Hello, or a security key</p>
          <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded-md text-blue-900">
            <p className="font-medium">First-time setup</p>
            <p className="text-xs mt-1">
              You&apos;re creating the first account on this Clauderon instance
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
