import { useState, type ReactElement } from "react";
import type { PrState } from "@shepherdjerred/pr-fleet-controller/src/schemas.ts";
import { Header } from "./components/header.tsx";
import { PrList, type PrEntry } from "./components/pr-list.tsx";
import { FleetDetail, PrDetail } from "./components/pr-detail.tsx";
import { useMeta } from "./use-meta.ts";
import { useRunStream } from "./use-run-stream.ts";

export function App(): ReactElement {
  // useRunStream re-renders on every store version bump, and the view is cheap
  // to project, so derive the PR list inline rather than memoize on a mutable ref.
  const { view, connected, error } = useRunStream();
  const meta = useMeta();
  const [selected, setSelected] = useState<number | "fleet">("fleet");

  const stateByNumber = new Map<number, PrState>(
    view.fleet?.prs.map((pr): [number, PrState] => [pr.identity.number, pr]),
  );
  const numbers = new Set<number>(stateByNumber.keys());
  for (const prNumber of view.prs.keys()) {
    numbers.add(prNumber);
  }
  const entries: PrEntry[] = [...numbers]
    .sort((a, b) => b - a)
    .map((number) => ({ number, state: stateByNumber.get(number) ?? null }));

  return (
    <div className="app">
      <Header
        manifest={meta.data?.manifest ?? null}
        summary={meta.data?.summary ?? null}
        fleet={view.fleet}
        runStatus={view.runStatus}
        connected={connected}
        error={error}
      />
      <div className="app-body">
        <PrList entries={entries} selected={selected} onSelect={setSelected} />
        <main className="app-main">
          {selected === "fleet" ? (
            <FleetDetail items={view.fleetTimeline} />
          ) : (
            <PrDetail
              prNumber={selected}
              state={stateByNumber.get(selected) ?? null}
              items={view.prs.get(selected)?.timeline ?? []}
              interactive={meta.data?.interactive ?? false}
            />
          )}
        </main>
      </div>
    </div>
  );
}
