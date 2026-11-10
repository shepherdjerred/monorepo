import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { PromotionOverviewSchema } from "@shepherdjerred/ops-model/promotion/model.ts";
import { setThemePreference, useThemePreference } from "#client/theme.ts";
import { RunPanel } from "./run-panel.tsx";
import { SourceGroups } from "./source-groups.tsx";
import { HistoryPanel } from "./history-panel.tsx";
import { time, money } from "./ui.tsx";

export function PromotionPage() {
  const initialSource =
    new URLSearchParams(location.search).get("source") ?? "";
  const [source, setSource] = useState(initialSource);
  const [showHistory, setShowHistory] = useState(initialSource !== "");
  const theme = useThemePreference();
  const overview = useQuery({
    queryKey: ["promotion", "run-summary"],
    queryFn: async () => {
      const response = await fetch("/api/v1/promotion");
      if (!response.ok) throw new Error("Could not read promotion results.");
      return PromotionOverviewSchema.parse(await response.json());
    },
    refetchInterval: 5000,
    refetchOnWindowFocus: true,
  });
  const data = overview.data;
  const historyFor = (id: string) => {
    setSource(id);
    setShowHistory(true);
    const url = new URL(location.href);
    url.searchParams.set("source", id);
    globalThis.history.replaceState(null, "", url);
  };
  return (
    <>
      <title>The Storm promotion · Hub</title>
      <header className="app-header">
        <a className="brand" href="/">
          Hub
        </a>
        <nav aria-label="Primary navigation">
          <a href="/promotion" aria-current="page">
            Promotion
          </a>
        </nav>
        <button
          className="p-theme"
          onClick={() => {
            setThemePreference(theme === "dark" ? "light" : "dark");
          }}
        >
          Theme: {theme}
        </button>
      </header>
      <main className="p-main">
        <div className="p-heading">
          <div>
            <p className="eyebrow">The Storm</p>
            <h1>Promotion</h1>
          </div>
          <div className="p-refresh">
            {data && (
              <span className="p-muted">Updated {time(data.readAt)}</span>
            )}
            <button
              onClick={() => {
                void overview.refetch();
              }}
            >
              Refresh
            </button>
          </div>
        </div>
        {overview.isError && (
          <div role="alert" className="p-error">
            {overview.error.message}
            {data && " Showing the previous read; results may be stale."}
          </div>
        )}
        {overview.isPending && <p role="status">Reading the latest run…</p>}
        {data && (
          <>
            <RunPanel summary={data.lastRun} />
            <SourceGroups summary={data.lastRun} onHistory={historyFor} />
            <details
              id="promotion-history"
              className="p-history"
              open={showHistory}
              onToggle={(event) => {
                setShowHistory(event.currentTarget.open);
              }}
            >
              <summary>History, receipts and run details</summary>
              {showHistory && (
                <HistoryPanel
                  data={data}
                  selected={source}
                  onSelect={setSource}
                />
              )}
              <p className="p-muted p-footnote">
                {data.scheduling === "manual"
                  ? "Runs start manually."
                  : "Scheduled sweeps: 8am, noon, 4pm and 8pm Pacific. Daily sources: 4–8pm."}{" "}
                Recorded spend today: {money(data.spend.aiUsd)} AI
                {" + "}
                {money(data.spend.captchaUsd)} CAPTCHA.
                {data.spend.unknownAi > 0 &&
                  ` ${String(data.spend.unknownAi)} usage records have unknown cost.`}
              </p>
            </details>
          </>
        )}
      </main>
    </>
  );
}
