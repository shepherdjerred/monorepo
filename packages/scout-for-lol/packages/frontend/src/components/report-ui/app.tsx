import { useState, useEffect } from "react";
import { z } from "zod";
import { getExampleMatch, type AnyMatch } from "@scout-for-lol/data/index";
// Import from browser-safe entry point to avoid satori/resvg dependencies
import { Report } from "@scout-for-lol/report/html/report.tsx";
import { ArenaReport } from "@scout-for-lol/report/html/arena/report";
const MatchTypeSchema = z.enum(["ranked", "unranked", "aram", "arena"]);
type MatchType = z.infer<typeof MatchTypeSchema>;

const ViewModeSchema = z.enum(["match-viewer"]);
type ViewMode = z.infer<typeof ViewModeSchema>;

const MATCH_TYPES: { value: MatchType; label: string }[] = [
  { value: "ranked", label: "Ranked Match (Solo)" },
  { value: "unranked", label: "Unranked Match" },
  { value: "aram", label: "ARAM Match" },
  { value: "arena", label: "Arena Match" },
];

// Common form field styles
const formLabelStyle: React.CSSProperties = {
  display: "block",
  marginBottom: "5px",
  fontWeight: "bold",
};

const formInputStyle: React.CSSProperties = {
  width: "100%",
  padding: "8px",
  borderRadius: "4px",
  border: "1px solid #ccc",
  boxSizing: "border-box",
};

function MatchReportRenderer({ match }: { match: AnyMatch }): React.ReactNode {
  if (match.queueType === "arena") {
    return <ArenaReport match={match} />;
  }
  return <Report match={match} />;
}

export function App() {
  const getInitialViewMode = (): ViewMode => {
    const params = new URLSearchParams(globalThis.location.search);
    const view = params.get("view");
    const result = ViewModeSchema.safeParse(view);
    return result.success ? result.data : "match-viewer";
  };

  const getInitialMatchType = (): MatchType => {
    const params = new URLSearchParams(globalThis.location.search);
    const queryType = params.get("type");
    const result = MatchTypeSchema.safeParse(queryType);
    return result.success ? result.data : "ranked";
  };

  const [viewMode, setViewMode] = useState<ViewMode>(getInitialViewMode());
  const [matchType, setMatchType] = useState<MatchType>(getInitialMatchType());
  const [matchId, setMatchId] = useState("");
  const [region, setRegion] = useState("na1");
  const [apiToken, setApiToken] = useState(
    localStorage.getItem("riot-api-token") ?? "",
  );
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const exampleMatch = getExampleMatch(matchType);

  // Update URL when view mode or match type changes - this is a side effect that must happen after render
   
  useEffect(() => {
    const params = new URLSearchParams(globalThis.location.search);
    params.set("view", viewMode);
    params.set("type", matchType);
    globalThis.history.replaceState(null, "", `?${params.toString()}`);
  }, [viewMode, matchType]);

  const handleFetchMatch = async () => {
    if (!matchId || !apiToken) {
      setError("Please enter both match ID and API token");
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const { fetchMatchFromRiot } = await import("../../lib/report-ui/api");
      const result = await fetchMatchFromRiot(matchId, region, apiToken);

      if (result.error !== undefined && result.error.length > 0) {
        setError(result.error);
      } else {
        // result.match is always null for now
        console.log("Match parsing not yet implemented");
        setError("Match parsing not yet implemented");
      }
    } catch (error_) {
      const ErrorOrStringSchema = z.union([z.instanceof(Error), z.string()]);
      const errorZod = ErrorOrStringSchema.safeParse(error_);
      let errorMessage = "Unknown error";
      if (errorZod.success) {
        const errorData = errorZod.data;
        errorMessage = errorData instanceof Error ? errorData.message : errorData;
      }
      setError(errorMessage);
    } finally {
      setIsLoading(false);
    }

    // Save API token to localStorage
    if (apiToken) {
      localStorage.setItem("riot-api-token", apiToken);
    }
  };

  return (
    <div style={{ minHeight: "100vh", backgroundColor: "#f9fafb" }}>
      {/* Header with tabs */}
      <div
        style={{
          backgroundColor: "white",
          borderBottom: "2px solid #e5e7eb",
          padding: "0 20px",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            maxWidth: "1400px",
            margin: "0 auto",
          }}
        >
          <h1
            style={{
              fontSize: "20px",
              fontWeight: 700,
              color: "#1f2937",
              margin: "16px 0",
            }}
          >
            Scout for LoL - Report UI
          </h1>
          <div style={{ display: "flex", gap: "4px" }}>
            <button
              onClick={() => {
                setViewMode("match-viewer");
              }}
              style={{
                padding: "12px 20px",
                backgroundColor: "#3b82f6",
                color: "white",
                border: "none",
                borderBottom: "2px solid #3b82f6",
                cursor: "pointer",
                fontSize: "14px",
                fontWeight: 600,
                transition: "all 0.2s ease",
              }}
            >
              Match Viewer
            </button>
          </div>
        </div>
      </div>

      {/* Content area */}
      <div style={{ padding: "20px", maxWidth: "1400px", margin: "0 auto" }}>
        <h2 style={{ marginBottom: "8px" }}>Match Viewer</h2>
        <p style={{ color: "#6b7280", marginBottom: "24px" }}>
          Browser-compatible report viewer for Scout for LoL
        </p>

        {/* Example Match Selector */}
        <div style={{ marginBottom: "20px" }}>
          <label
            htmlFor="match-type"
            style={{ marginRight: "10px", fontWeight: "bold" }}
          >
            Example Match Type:
          </label>
          <select
            id="match-type"
            value={matchType}
            onChange={(e) => {
              const result = MatchTypeSchema.safeParse(e.target.value);
              if (result.success) {
                setMatchType(result.data);
              }
            }}
            style={{
              padding: "8px 12px",
              fontSize: "14px",
              borderRadius: "4px",
              border: "1px solid #ccc",
              cursor: "pointer",
            }}
          >
            {MATCH_TYPES.map((type) => (
              <option key={type.value} value={type.value}>
                {type.label}
              </option>
            ))}
          </select>
        </div>

        {/* Riot API Match Fetcher */}
        <div
          style={{
            marginBottom: "20px",
            padding: "15px",
            borderRadius: "4px",
            backgroundColor: "#f5f5f5",
            border: "1px solid #ddd",
          }}
        >
          <h3 style={{ marginTop: 0 }}>Fetch Real Match from Riot API</h3>
          <div style={{ marginBottom: "10px" }}>
            <label htmlFor="riot-api-token" style={formLabelStyle}>
              Riot API Token:
            </label>
            <input
              id="riot-api-token"
              type="password"
              value={apiToken}
              onChange={(e) => {
                setApiToken(e.target.value);
              }}
              placeholder="Paste your API token here"
              style={{
                ...formInputStyle,
                marginBottom: "10px",
              }}
            />
            <small style={{ color: "#666" }}>
              Get a token at{" "}
              <a
                href="https://developer.riotgames.com"
                target="_blank"
                rel="noreferrer"
              >
                developer.riotgames.com
              </a>
              . Saved locally in browser storage.
            </small>
          </div>

          <div style={{ display: "flex", gap: "10px", marginBottom: "10px" }}>
            <div style={{ flex: 1 }}>
              <label htmlFor="match-id" style={formLabelStyle}>
                Match ID:
              </label>
              <input
                id="match-id"
                type="text"
                value={matchId}
                onChange={(e) => {
                  setMatchId(e.target.value);
                }}
                placeholder="e.g., NA1_1234567890"
                style={formInputStyle}
              />
            </div>
            <div style={{ flex: 0.5 }}>
              <label htmlFor="region" style={formLabelStyle}>
                Region:
              </label>
              <select
                id="region"
                value={region}
                onChange={(e) => {
                  setRegion(e.target.value);
                }}
                style={formInputStyle}
              >
                <option value="na1">NA1</option>
                <option value="euw1">EUW1</option>
                <option value="kr">KR</option>
                <option value="br1">BR1</option>
              </select>
            </div>
          </div>

          <button
            onClick={() => {
              void handleFetchMatch();
            }}
            disabled={isLoading}
            style={{
              padding: "10px 20px",
              backgroundColor: isLoading ? "#ccc" : "#0066cc",
              color: "white",
              border: "none",
              borderRadius: "4px",
              cursor: isLoading ? "default" : "pointer",
              fontSize: "14px",
              fontWeight: "bold",
            }}
          >
            {isLoading ? "Loading..." : "Fetch Match"}
          </button>

          {error !== undefined && error.length > 0 && (
            <div
              style={{ marginTop: "10px", color: "#d32f2f", fontSize: "14px" }}
            >
              ⚠️ {error}
            </div>
          )}
        </div>

        <section>
          <h2 style={{ fontSize: "14px", color: "#999" }}>Preview</h2>
          <div
            style={{
              zoom: 0.6,
              transformOrigin: "top left",
              width: "fit-content",
              padding: "20px",
              maxWidth: "100vw",
            }}
          >
            <MatchReportRenderer match={exampleMatch} />
          </div>
        </section>
      </div>
    </div>
  );
}
