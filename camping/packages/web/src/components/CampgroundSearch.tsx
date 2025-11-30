import { useState } from "react";
import type { Campground } from "../lib/api";
import { searchCampgrounds, importCampground } from "../lib/api";

export default function CampgroundSearch() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Campground[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [importing, setImporting] = useState<string | null>(null);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;

    setLoading(true);
    setError(null);

    try {
      const campgrounds = await searchCampgrounds(query);
      setResults(campgrounds);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Search failed");
    } finally {
      setLoading(false);
    }
  };

  const handleImport = async (campground: Campground) => {
    setImporting(campground.facilityId);
    try {
      await importCampground(campground.facilityId);
      // Redirect to the campground detail page or show success
      window.location.href = `/campground/${campground.facilityId}`;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed");
    } finally {
      setImporting(null);
    }
  };

  return (
    <div className="bg-white rounded-lg shadow-md p-6">
      <form onSubmit={handleSearch} className="flex gap-4">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search for campgrounds (e.g., 'Olympic', 'Mount Rainier')..."
          className="flex-1 px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-forest-500 focus:border-transparent"
        />
        <button
          type="submit"
          disabled={loading}
          className="px-6 py-3 bg-forest-600 text-white rounded-lg hover:bg-forest-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? "Searching..." : "Search"}
        </button>
      </form>

      {error && (
        <div className="mt-4 p-4 bg-red-50 text-red-700 rounded-lg">{error}</div>
      )}

      {results.length > 0 && (
        <div className="mt-6 space-y-4">
          <h2 className="text-lg font-semibold text-gray-800">
            Found {results.length} campground{results.length !== 1 ? "s" : ""}
          </h2>
          <div className="grid gap-4">
            {results.map((campground) => (
              <div
                key={campground.facilityId}
                className="border border-gray-200 rounded-lg p-4 hover:border-forest-400 transition-colors"
              >
                <div className="flex justify-between items-start">
                  <div className="flex-1">
                    <h3 className="text-lg font-semibold text-forest-800">
                      {campground.name}
                    </h3>
                    <p className="text-gray-600 text-sm mt-1">
                      {campground.city}, {campground.state}
                    </p>
                    {campground.description && (
                      <p className="text-gray-500 text-sm mt-2 line-clamp-2">
                        {campground.description}
                      </p>
                    )}
                  </div>
                  {campground.imageUrl && (
                    <img
                      src={campground.imageUrl}
                      alt={campground.name}
                      className="w-24 h-24 object-cover rounded-lg ml-4"
                    />
                  )}
                </div>
                <div className="mt-4 flex gap-3">
                  <button
                    onClick={() => handleImport(campground)}
                    disabled={importing === campground.facilityId}
                    className="px-4 py-2 bg-forest-600 text-white text-sm rounded-lg hover:bg-forest-700 transition-colors disabled:opacity-50"
                  >
                    {importing === campground.facilityId
                      ? "Adding..."
                      : "Add & View"}
                  </button>
                  <a
                    href={campground.reservationUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-4 py-2 border border-gray-300 text-gray-700 text-sm rounded-lg hover:bg-gray-50 transition-colors"
                  >
                    View on Recreation.gov
                  </a>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {results.length === 0 && query && !loading && !error && (
        <p className="mt-6 text-gray-500 text-center">
          No campgrounds found. Try a different search term.
        </p>
      )}
    </div>
  );
}
