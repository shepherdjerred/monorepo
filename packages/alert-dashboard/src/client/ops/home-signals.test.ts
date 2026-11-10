import { findSection } from "@shepherdjerred/ops-model/assemble.ts";
import { SnapshotSchema } from "@shepherdjerred/ops-model/snapshot.ts";
import { expect, test } from "vitest";

import { firingAlertSignals } from "./home-signals.ts";
import { fixtureOpsIngest } from "#test-fixtures/ops-snapshot";

test("lists informational alerts and leaves out the silences summary", () => {
  const { snapshot } = fixtureOpsIngest("2026-08-08T12:00:00Z");
  const alerts = findSection(SnapshotSchema.parse(snapshot), "alerts");
  const [alert] = alerts.signals;
  if (alert === undefined) throw new Error("fixture has no alert signal");
  const section = {
    ...alerts,
    signals: [
      alert,
      { ...alert, id: "alerts:Watchdog:-", severity: "info" as const },
      { ...alert, id: "alerts:silences", kind: "silences" as const },
    ],
  };

  expect(firingAlertSignals(section).map((signal) => signal.id)).toEqual([
    alert.id,
    "alerts:Watchdog:-",
  ]);
});
