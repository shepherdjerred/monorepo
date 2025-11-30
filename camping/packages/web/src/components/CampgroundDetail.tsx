import { useState, useEffect } from "react";
import type { Campsite } from "../lib/api";
import {
  getCampsites,
  refreshAvailability,
  searchAvailability,
  createWatch,
} from "../lib/api";

interface Props {
  facilityId: string;
}

export default function CampgroundDetail({ facilityId }: Props) {
  const [campsites, setCampsites] = useState<Campsite[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Watch form state
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [minNights, setMinNights] = useState(2);
  const [creatingWatch, setCreatingWatch] = useState(false);

  // Availability search results
  const [availabilityResults, setAvailabilityResults] = useState<
    Array<{ campsite: Campsite; availableSequences: string[][] }>
  >([]);

  const userId = localStorage.getItem("userId");

  useEffect(() => {
    loadCampsites();

    // Set default dates (next weekend)
    const today = new Date();
    const nextFriday = new Date(today);
    nextFriday.setDate(today.getDate() + ((5 - today.getDay() + 7) % 7 || 7));
    const nextSunday = new Date(nextFriday);
    nextSunday.setDate(nextFriday.getDate() + 2);

    setStartDate(formatDateInput(nextFriday));
    setEndDate(formatDateInput(nextSunday));
  }, [facilityId]);

  const loadCampsites = async () => {
    // Note: In a real app, we'd need to look up the campground ID from the facility ID
    // For now, this is a simplified version
    setLoading(false);
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    setError(null);

    try {
      const result = await refreshAvailability(facilityId, 3);
      setSuccess(`Updated ${result.recordsUpdated} availability records`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to refresh");
    } finally {
      setRefreshing(false);
    }
  };

  const handleSearchAvailability = async () => {
    if (!startDate || !endDate) return;

    setLoading(true);
    setError(null);

    try {
      const results = await searchAvailability({
        campgroundId: facilityId, // Note: should be the internal campground ID
        startDate,
        endDate,
        minNights,
      });
      setAvailabilityResults(results);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Search failed");
    } finally {
      setLoading(false);
    }
  };

  const handleCreateWatch = async () => {
    if (!userId) {
      setError("Please set up your account in Settings first");
      return;
    }

    if (!startDate || !endDate) {
      setError("Please select dates");
      return;
    }

    setCreatingWatch(true);
    setError(null);

    try {
      await createWatch({
        userId,
        campgroundId: facilityId, // Note: should be the internal campground ID
        startDate,
        endDate,
        minNights,
      });
      setSuccess("Watch created! You'll be notified when sites become available.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create watch");
    } finally {
      setCreatingWatch(false);
    }
  };

  return (
    <div className="space-y-8">
      <div className="flex justify-between items-start">
        <div>
          <a href="/" className="text-forest-600 hover:text-forest-700 mb-2 inline-block">
            &larr; Back to Search
          </a>
          <h1 className="text-3xl font-bold text-forest-800">Campground Details</h1>
          <p className="text-gray-600 mt-1">Facility ID: {facilityId}</p>
        </div>
        <button
          onClick={handleRefresh}
          disabled={refreshing}
          className="px-4 py-2 bg-forest-600 text-white rounded-lg hover:bg-forest-700 transition-colors disabled:opacity-50"
        >
          {refreshing ? "Refreshing..." : "Refresh Availability"}
        </button>
      </div>

      {error && (
        <div className="bg-red-50 text-red-700 p-4 rounded-lg">{error}</div>
      )}

      {success && (
        <div className="bg-green-50 text-green-700 p-4 rounded-lg">{success}</div>
      )}

      <div className="bg-white rounded-lg shadow-md p-6">
        <h2 className="text-xl font-semibold text-forest-800 mb-4">
          Check Availability & Create Watch
        </h2>

        <div className="grid md:grid-cols-4 gap-4 mb-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Check-in Date
            </label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-forest-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Check-out Date
            </label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-forest-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Min Nights
            </label>
            <select
              value={minNights}
              onChange={(e) => setMinNights(Number(e.target.value))}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-forest-500"
            >
              {[1, 2, 3, 4, 5, 6, 7].map((n) => (
                <option key={n} value={n}>
                  {n} night{n !== 1 ? "s" : ""}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-end gap-2">
            <button
              onClick={handleSearchAvailability}
              disabled={loading}
              className="flex-1 px-4 py-2 bg-forest-600 text-white rounded-lg hover:bg-forest-700 transition-colors disabled:opacity-50"
            >
              Search
            </button>
          </div>
        </div>

        <div className="border-t pt-4 mt-4">
          <button
            onClick={handleCreateWatch}
            disabled={creatingWatch || !userId}
            className="px-6 py-3 bg-yellow-500 text-white rounded-lg hover:bg-yellow-600 transition-colors disabled:opacity-50 flex items-center gap-2"
          >
            <span>👁️</span>
            {creatingWatch ? "Creating..." : "Create Watch for These Dates"}
          </button>
          {!userId && (
            <p className="text-sm text-gray-500 mt-2">
              <a href="/settings" className="text-forest-600 underline">
                Set up your account
              </a>{" "}
              to create watches
            </p>
          )}
        </div>
      </div>

      {availabilityResults.length > 0 && (
        <div className="bg-white rounded-lg shadow-md p-6">
          <h2 className="text-xl font-semibold text-forest-800 mb-4">
            Available Sites ({availabilityResults.length})
          </h2>
          <div className="space-y-4">
            {availabilityResults.map(({ campsite, availableSequences }) => (
              <div
                key={campsite.id}
                className="border border-gray-200 rounded-lg p-4"
              >
                <div className="flex justify-between items-start">
                  <div>
                    <h3 className="font-semibold text-forest-800">
                      {campsite.name}
                    </h3>
                    <p className="text-sm text-gray-600">
                      {campsite.siteType} • Loop {campsite.loop}
                    </p>
                    <div className="flex gap-2 mt-2">
                      {campsite.hasElectric && (
                        <span className="text-xs bg-yellow-100 text-yellow-800 px-2 py-1 rounded">
                          ⚡ Electric
                        </span>
                      )}
                      {campsite.isAccessible && (
                        <span className="text-xs bg-blue-100 text-blue-800 px-2 py-1 rounded">
                          ♿ Accessible
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-sm text-gray-500">Available sequences:</p>
                    {availableSequences.map((seq, i) => (
                      <p key={i} className="text-sm text-forest-600">
                        {formatDateRange(seq)}
                      </p>
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {availabilityResults.length === 0 && !loading && startDate && endDate && (
        <div className="bg-gray-50 rounded-lg p-8 text-center">
          <p className="text-gray-600">
            No available sites found for the selected dates. Create a watch to
            be notified when sites become available.
          </p>
        </div>
      )}
    </div>
  );
}

function formatDateInput(date: Date): string {
  return date.toISOString().split("T")[0];
}

function formatDateRange(dates: string[]): string {
  if (dates.length === 0) return "";
  if (dates.length === 1) {
    return formatShortDate(dates[0]);
  }
  return `${formatShortDate(dates[0])} - ${formatShortDate(dates[dates.length - 1])}`;
}

function formatShortDate(dateStr: string): string {
  const date = new Date(dateStr + "T12:00:00");
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
