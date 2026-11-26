import { Button, HeaderBar } from "@shepherdjerred/console-ui";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { PromotionOverviewSchema } from "@shepherdjerred/ops-model/promotion/model.ts";
import { RunPanel } from "./run-panel.tsx";
import { SourceGroups } from "./source-groups.tsx";
import { HistoryPanel } from "./history-panel.tsx";
import { time } from "./ui.tsx";
import { PromotionSpendSummary } from "./spend-summary.tsx";
import { sourceTimingSummary } from "./source-timing.ts";
import { ActivityLegend } from "./activity-strip.tsx";
import { RedditOutreachPanel } from "./reddit-outreach.tsx";

/**
 * The promotion report itself, without any app chrome: the Hub shell frames
 * it at `/promotion`, and the standalone local launcher adds its own bar.
 */
export function PromotionContent() {
  const initialSource =
    new URLSearchParams(location.search).get("source") ?? "";
  const [source, setSource] = useState(initialSource);
  const [showHistory, setShowHistory] = useState(initialSource !== "");
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
  const activity = new Map(
    (data?.sources ?? []).flatMap((item) =>
      item.activity === undefined ? [] : [[item.id, item.activity] as const],
    ),
  );
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
      <main className="ledger p-main">
        <div className="page-head">
          <HeaderBar
            title="Promotion"
            meta={
              <>
                The Storm
                {data && ` · Updated ${time(data.readAt)}`}
              </>
            }
            actions={
              <Button
                onClick={() => {
                  void overview.refetch();
                }}
              >
                Refresh
              </Button>
            }
          />
        </div>
        {overview.isError && (
          <div role="alert" className="p-error">
            {overview.error.message}
            {data && " Showing the previous read; results may be stale."}
          </div>
        )}
        {overview.isPending && (
          <p role="status" className="p-pending">
            Reading the latest run…
          </p>
        )}
        {data && (
          <>
            <RedditOutreachPanel data={data.redditOutreach} />
            <RunPanel summary={data.lastRun} spend={data.spend} />
            {activity.size > 0 && <ActivityLegend />}
            <SourceGroups
              summary={sourceTimingSummary(data)}
              activity={activity}
              onHistory={historyFor}
            />
            <details
              id="promotion-history"
              className="p-history"
              open={showHistory}
              onToggle={(event) => {
                setShowHistory(event.currentTarget.open);
              }}
            >
              <summary className="ui-section-head">
                <span className="ui-section-title">
                  History, receipts and run details
                </span>
              </summary>
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
                <PromotionSpendSummary spend={data.spend} />
              </p>
            </details>
          </>
        )}
      </main>
    </>
  );
}

/** The `/promotion` route; the Hub shell supplies the navigation around it. */
export function PromotionPage() {
  return <PromotionContent />;
}
