import { useState } from "react";
import { get, type CredentialRequestOptionsJSON, type PublicKeyCredentialWithAssertionJSON } from "@github/webauthn-json";
import { useClauderonClient } from "../hooks/useClauderonClient";
import { useAuth } from "../contexts/AuthContext";

export function LoginPage() {
  const client = useClauderonClient();
  const { refreshAuthStatus } = useAuth();
  const [username, setUsername] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleLogin = async (e: React.SyntheticEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    setIsLoading(true);

    try {
      // Start login flow
      const response: { challenge_id: string; options: CredentialRequestOptionsJSON } = await client.loginStart({ username }) as { challenge_id: string; options: CredentialRequestOptionsJSON };

      // Trigger passkey authentication
      const credential: PublicKeyCredentialWithAssertionJSON = await get(response.options);

      // Finish login flow
      await client.loginFinish({
        username,
        challenge_id: response.challenge_id,
        credential: credential as unknown as Record<string, unknown>,
      });

      // Refresh auth status
      await refreshAuthStatus();
    } catch (err) {
      console.error("Login error:", err);
      setError(err instanceof Error ? err.message : "Failed to sign in. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex items-center justify-center min-h-screen bg-background">
      <div className="w-full max-w-md p-8 space-y-6 bg-card rounded-lg shadow-lg border">
        <div className="text-center">
          <h1 className="text-3xl font-bold">Welcome Back</h1>
          <p className="text-muted-foreground mt-2">Sign in to Clauderon</p>
        </div>

        <form onSubmit={(e) => { void handleLogin(e); }} className="space-y-4">
          <div>
            <label htmlFor="username" className="block text-sm font-medium mb-2">
              Username
            </label>
            <input
              id="username"
              type="text"
              value={username}
              onChange={(e) => { setUsername(e.target.value); }}
              required
              autoComplete="username webauthn"
              className="w-full px-3 py-2 border rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-primary"
              placeholder="Enter your username"
              disabled={isLoading}
            />
          </div>

          {error && (
            <div className="p-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded-md">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={isLoading || !username.trim()}
            className="cursor-pointer w-full px-4 py-2 font-medium text-white bg-primary rounded-md hover:bg-primary/90 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 transition-colors duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isLoading ? (
              <span className="flex items-center justify-center">
                <span className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></span>
                Signing in...
              </span>
            ) : (
              "Sign In with Passkey"
            )}
          </button>
        </form>

        <div className="text-center text-sm text-muted-foreground">
          <p>Use your device's biometric authentication</p>
          <p className="mt-1">(Face ID, Touch ID, Windows Hello, etc.)</p>
        </div>
      </div>
    </div>
  );
}
