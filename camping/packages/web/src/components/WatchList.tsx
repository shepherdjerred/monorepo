import { useState, useEffect } from "react";
import type { Watch } from "../lib/api";
import { getWatches, updateWatch, deleteWatch } from "../lib/api";

export default function WatchList() {
  const [watches, setWatches] = useState<Watch[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // For demo, use a fixed user ID - in production, this would come from auth
  const userId = localStorage.getItem("userId") || "";

  useEffect(() => {
    if (!userId) {
      setLoading(false);
      return;
    }

    loadWatches();
  }, [userId]);

  const loadWatches = async () => {
    try {
      const data = await getWatches(userId);
      setWatches(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load watches");
    } finally {
      setLoading(false);
    }
  };

  const handleToggle = async (watch: Watch) => {
    try {
      await updateWatch(watch.id, { isActive: !watch.isActive });
      loadWatches();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update watch");
    }
  };

  const handleDelete = async (watchId: string) => {
    if (!confirm("Are you sure you want to delete this watch?")) return;

    try {
      await deleteWatch(watchId);
      loadWatches();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete watch");
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
          to start watching campgrounds.
        </p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="text-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-forest-600 mx-auto"></div>
        <p className="mt-4 text-gray-500">Loading watches...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 text-red-700 p-4 rounded-lg">{error}</div>
    );
  }

  if (watches.length === 0) {
    return (
      <div className="bg-white rounded-lg shadow-md p-8 text-center">
        <div className="text-4xl mb-4">👁️</div>
        <h2 className="text-xl font-semibold text-gray-800 mb-2">
          No Watches Yet
        </h2>
        <p className="text-gray-600 mb-6">
          Search for a campground and create a watch to get notified when sites
          become available.
        </p>
        <a
          href="/"
          className="inline-block px-6 py-3 bg-forest-600 text-white rounded-lg hover:bg-forest-700 transition-colors"
        >
          Search Campgrounds
        </a>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {watches.map((watch) => (
        <div
          key={watch.id}
          className={`bg-white rounded-lg shadow-md p-6 ${
            !watch.isActive ? "opacity-60" : ""
          }`}
        >
          <div className="flex justify-between items-start">
            <div>
              <div className="flex items-center gap-2">
                <span
                  className={`w-2 h-2 rounded-full ${
                    watch.isActive ? "bg-green-500" : "bg-gray-400"
                  }`}
                ></span>
                <span className="text-sm text-gray-500">
                  {watch.isActive ? "Active" : "Paused"}
                </span>
              </div>
              <h3 className="text-lg font-semibold text-forest-800 mt-2">
                Campground Watch
              </h3>
              <p className="text-gray-600 mt-1">
                {formatDate(watch.startDate)} - {formatDate(watch.endDate)}
              </p>
              <p className="text-sm text-gray-500 mt-1">
                Minimum {watch.minNights} night{watch.minNights !== 1 ? "s" : ""}
              </p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => handleToggle(watch)}
                className={`px-4 py-2 text-sm rounded-lg transition-colors ${
                  watch.isActive
                    ? "bg-gray-100 text-gray-700 hover:bg-gray-200"
                    : "bg-forest-100 text-forest-700 hover:bg-forest-200"
                }`}
              >
                {watch.isActive ? "Pause" : "Resume"}
              </button>
              <button
                onClick={() => handleDelete(watch.id)}
                className="px-4 py-2 text-sm bg-red-50 text-red-600 rounded-lg hover:bg-red-100 transition-colors"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr + "T12:00:00");
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
