import { useState, useEffect } from "react";
import { authUser, updatePreferences } from "../lib/api";

export default function SettingsForm() {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [userId, setUserId] = useState<string | null>(null);
  const [emailNotifications, setEmailNotifications] = useState(true);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const storedUserId = localStorage.getItem("userId");
    const storedEmail = localStorage.getItem("userEmail");
    const storedName = localStorage.getItem("userName");

    if (storedUserId) {
      setUserId(storedUserId);
    }
    if (storedEmail) {
      setEmail(storedEmail);
    }
    if (storedName) {
      setName(storedName);
    }
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;

    setLoading(true);
    setError(null);
    setSuccess(null);

    try {
      const user = await authUser(email, name || undefined);

      // Store user info locally
      localStorage.setItem("userId", user.id);
      localStorage.setItem("userEmail", user.email);
      if (user.name) {
        localStorage.setItem("userName", user.name);
      }

      setUserId(user.id);
      setSuccess("Settings saved successfully!");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save settings");
    } finally {
      setLoading(false);
    }
  };

  const handlePreferencesUpdate = async () => {
    if (!userId) return;

    setLoading(true);
    setError(null);
    setSuccess(null);

    try {
      await updatePreferences(userId, {
        email: emailNotifications,
        emailAddress: email,
      });
      setSuccess("Preferences updated!");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to update preferences"
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-2xl space-y-8">
      <div className="bg-white rounded-lg shadow-md p-6">
        <h2 className="text-xl font-semibold text-forest-800 mb-4">
          Account Information
        </h2>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label
              htmlFor="email"
              className="block text-sm font-medium text-gray-700 mb-1"
            >
              Email Address *
            </label>
            <input
              type="email"
              id="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              placeholder="your@email.com"
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-forest-500"
            />
            <p className="text-sm text-gray-500 mt-1">
              Used for notifications and account identification
            </p>
          </div>

          <div>
            <label
              htmlFor="name"
              className="block text-sm font-medium text-gray-700 mb-1"
            >
              Name (optional)
            </label>
            <input
              type="text"
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Your name"
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-forest-500"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="px-6 py-2 bg-forest-600 text-white rounded-lg hover:bg-forest-700 transition-colors disabled:opacity-50"
          >
            {loading ? "Saving..." : userId ? "Update Account" : "Create Account"}
          </button>
        </form>
      </div>

      {userId && (
        <div className="bg-white rounded-lg shadow-md p-6">
          <h2 className="text-xl font-semibold text-forest-800 mb-4">
            Notification Preferences
          </h2>

          <div className="space-y-4">
            <label className="flex items-center gap-3">
              <input
                type="checkbox"
                checked={emailNotifications}
                onChange={(e) => setEmailNotifications(e.target.checked)}
                className="w-5 h-5 text-forest-600 rounded focus:ring-forest-500"
              />
              <span className="text-gray-700">
                Email notifications when campsites become available
              </span>
            </label>

            <button
              onClick={handlePreferencesUpdate}
              disabled={loading}
              className="px-6 py-2 bg-forest-600 text-white rounded-lg hover:bg-forest-700 transition-colors disabled:opacity-50"
            >
              {loading ? "Saving..." : "Save Preferences"}
            </button>
          </div>
        </div>
      )}

      {success && (
        <div className="bg-green-50 text-green-700 p-4 rounded-lg">
          {success}
        </div>
      )}

      {error && (
        <div className="bg-red-50 text-red-700 p-4 rounded-lg">{error}</div>
      )}

      {userId && (
        <div className="bg-gray-50 rounded-lg p-4 text-sm text-gray-600">
          <p>
            <strong>User ID:</strong> {userId}
          </p>
          <p className="mt-1">
            This is stored locally in your browser. Your watches and alerts are
            associated with this ID.
          </p>
        </div>
      )}
    </div>
  );
}
