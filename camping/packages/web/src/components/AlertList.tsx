import { useState, useEffect } from "react";
import type { Alert } from "../lib/api";
import { getAlerts, dismissAlert } from "../lib/api";

export default function AlertList() {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const userId = localStorage.getItem("userId") || "";

  useEffect(() => {
    if (!userId) {
      setLoading(false);
      return;
    }

    loadAlerts();
  }, [userId]);

  const loadAlerts = async () => {
    try {
      const data = await getAlerts(userId);
      setAlerts(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load alerts");
    } finally {
      setLoading(false);
    }
  };

  const handleDismiss = async (alertId: string) => {
    try {
      await dismissAlert(alertId);
      loadAlerts();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to dismiss alert");
    }
  };

  if (!userId) {
    return (
      <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-6 text-center">
        <p className="text-yellow-800">
          Please{" "}
          <a href="/settings" className="text-forest-600 underline">
            set up your account
          </a>{" "}
          to view alerts.
        </p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="text-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-forest-600 mx-auto"></div>
        <p className="mt-4 text-gray-500">Loading alerts...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 text-red-700 p-4 rounded-lg">{error}</div>
    );
  }

  const activeAlerts = alerts.filter(
    (a) => a.status === "pending" || a.status === "sent"
  );
  const dismissedAlerts = alerts.filter((a) => a.status === "dismissed");

  if (alerts.length === 0) {
    return (
      <div className="bg-white rounded-lg shadow-md p-8 text-center">
        <div className="text-4xl mb-4">🔔</div>
        <h2 className="text-xl font-semibold text-gray-800 mb-2">
          No Alerts Yet
        </h2>
        <p className="text-gray-600">
          When campsites matching your watches become available, you'll see
          alerts here.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {activeAlerts.length > 0 && (
        <div className="space-y-4">
          <h2 className="text-lg font-semibold text-gray-800">
            Active Alerts ({activeAlerts.length})
          </h2>
          {activeAlerts.map((alert) => (
            <AlertCard
              key={alert.id}
              alert={alert}
              onDismiss={handleDismiss}
            />
          ))}
        </div>
      )}

      {dismissedAlerts.length > 0 && (
        <div className="space-y-4">
          <h2 className="text-lg font-semibold text-gray-500">
            Dismissed ({dismissedAlerts.length})
          </h2>
          {dismissedAlerts.map((alert) => (
            <AlertCard
              key={alert.id}
              alert={alert}
              onDismiss={handleDismiss}
              dismissed
            />
          ))}
        </div>
      )}
    </div>
  );
}

function AlertCard({
  alert,
  onDismiss,
  dismissed = false,
}: {
  alert: Alert;
  onDismiss: (id: string) => void;
  dismissed?: boolean;
}) {
  const dates = JSON.parse(alert.availableDates);
  const formattedDates = dates
    .map((d: string) => {
      const date = new Date(d + "T12:00:00");
      return date.toLocaleDateString("en-US", {
        weekday: "short",
        month: "short",
        day: "numeric",
      });
    })
    .join(", ");

  return (
    <div
      className={`bg-white rounded-lg shadow-md p-6 ${
        dismissed ? "opacity-60" : "border-l-4 border-forest-500"
      }`}
    >
      <div className="flex justify-between items-start">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <span className="text-xl">🏕️</span>
            <span
              className={`text-xs px-2 py-1 rounded-full ${
                alert.status === "sent"
                  ? "bg-green-100 text-green-700"
                  : alert.status === "pending"
                    ? "bg-yellow-100 text-yellow-700"
                    : "bg-gray-100 text-gray-600"
              }`}
            >
              {alert.status === "sent"
                ? "Notification Sent"
                : alert.status === "pending"
                  ? "New"
                  : "Dismissed"}
            </span>
          </div>
          <h3 className="text-lg font-semibold text-forest-800">
            Campsite Available
          </h3>
          <p className="text-gray-600 mt-1">Available: {formattedDates}</p>
          <p className="text-sm text-gray-500 mt-2">
            Alerted{" "}
            {new Date(alert.createdAt).toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
              hour: "numeric",
              minute: "2-digit",
            })}
          </p>
        </div>
        <div className="flex gap-2">
          {!dismissed && (
            <>
              <button
                onClick={() => onDismiss(alert.id)}
                className="px-4 py-2 text-sm bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors"
              >
                Dismiss
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
