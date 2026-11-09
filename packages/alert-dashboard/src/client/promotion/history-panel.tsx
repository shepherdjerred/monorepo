import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  PromotionHistoryResponseSchema,
  type PromotionOverview,
} from "@shepherdjerred/ops-model/promotion/model.ts";
import { systemClock } from "#shared/time";
import { HistoryItem, time } from "./ui.tsx";

export function HistoryPanel({
  data,
  selected,
  onSelect,
}: {
  data: PromotionOverview;
  selected: string;
  onSelect: (id: string) => void;
}) {
  const [days, setDays] = useState("7"),
    [batchId, setBatchId] = useState("");
  const [cursor, setCursor] = useState<string | null>(null);
  const history = useQuery({
    queryKey: ["promotion-history", selected, days, batchId, cursor],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (selected) params.set("targetId", selected);
      if (batchId) params.set("batchId", batchId);
      if (cursor !== null) params.set("cursor", cursor);
      if (days !== "all")
        params.set(
          "since",
          systemClock
            .now()
            .subtract({ hours: Number(days) * 24 })
            .toString(),
        );
      const response = await fetch(`/api/v1/promotion/history?${params}`);
      if (!response.ok) throw new Error("History could not be read.");
      return PromotionHistoryResponseSchema.parse(await response.json());
    },
    refetchInterval: 5000,
  });
  return (
    <>
      <div className="p-filters">
        <select
          aria-label="History source"
          value={selected}
          onChange={(e) => {
            onSelect(e.target.value);
            setCursor(null);
          }}
        >
          <option value="">All sources</option>
          {data.sources.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <select
          aria-label="History range"
          value={days}
          onChange={(e) => {
            setDays(e.target.value);
            setCursor(null);
          }}
        >
          <option value="1">Last 24 hours</option>
          <option value="7">Last 7 days</option>
          <option value="all">All history</option>
        </select>
        <select
          aria-label="Run history"
          value={batchId}
          onChange={(e) => {
            setBatchId(e.target.value);
            setCursor(null);
          }}
        >
          <option value="">All runs and follow-ups</option>
          {data.batches.map((b) => (
            <option key={b.id} value={b.id}>
              {time(b.startedAt)} · {b.mode}
            </option>
          ))}
        </select>
        {cursor !== null && (
          <button
            onClick={() => {
              setCursor(null);
            }}
          >
            Newest records
          </button>
        )}
      </div>
      {history.isPending && <p>Reading history…</p>}
      {history.isError && <p role="alert">{history.error.message}</p>}
      {history.data?.items.map((entry) => (
        <div key={entry.id}>
          <small className="p-muted">
            {data.sources.find((s) => s.id === entry.targetId)?.name ??
              entry.targetId}
          </small>
          <HistoryItem entry={entry} />
        </div>
      ))}
      {history.data?.items.length === 0 && (
        <p>No history matches these filters.</p>
      )}
      {history.data?.nextCursor != null && (
        <button
          onClick={() => {
            setCursor(history.data?.nextCursor ?? null);
          }}
        >
          Older records
        </button>
      )}
    </>
  );
}
