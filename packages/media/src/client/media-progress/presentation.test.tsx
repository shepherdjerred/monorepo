import { expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { MediaVisibility } from "#shared/visibility/detail.ts";
import { MediaProgress } from "./panel.tsx";
import { policyDescription } from "./presentation.ts";

function fixture(): MediaVisibility {
  return {
    playback: {
      scope: "title",
      playableItems: 0,
      visibleItems: 1,
      playable: false,
      currentAssetId: null,
      currentVersion: null,
      upgradeInProgress: false,
    },
    attempts: [],
    historyTruncated: false,
    torrents: [
      {
        id: crypto.randomUUID(),
        state: "ready",
        observedAt: "2026-10-17T00:00:00Z",
        freshness: "fresh",
        progress: 1,
        ratio: { kind: "infinite" },
        seededSeconds: 86_400,
        diagnostics: {
          protections: [],
          providerId: "knaben",
          policy: { kind: "public" },
          obligation: {
            satisfied: true,
            reason: "obligations_satisfied",
            requiredSeconds: 7 * 86_400,
          },
          cleanup: {
            status: "protected",
            reason: "source_in_use",
            evaluatedAt: "2026-10-17T00:00:00Z",
            freshness: "current",
            phase: "evaluation",
          },
        },
      },
    ],
  };
}
function firstTorrent(value: MediaVisibility) {
  const torrent = value.torrents[0];
  if (torrent === undefined) throw new Error("Missing test torrent");
  return torrent;
}

test("completed download with an infinite ratio does not claim playback or deletion authority", () => {
  const html = renderToStaticMarkup(<MediaProgress visibility={fixture()} />);
  expect(html).toContain("100%");
  expect(html).toContain("∞ (infinite)");
  expect(html).toContain("Playback pending");
  expect(html).not.toContain("Ready to watch");
  expect(html).toContain("Share ratio 1 OR 7 days of actual seeded time");
  expect(html).toContain("Import or recovery work still needs this source");
  expect(html).toContain("does not authorize deletion");
});

test("current source protections remain visible without a saved cleanup evaluation", () => {
  const value = fixture();
  const diagnostics = firstTorrent(value).diagnostics;
  if (diagnostics === null) throw new Error("Missing diagnostic fixture");
  diagnostics.cleanup = null;
  diagnostics.protections = ["torrent_policy_drift", "source_in_use"];
  const html = renderToStaticMarkup(<MediaProgress visibility={value} />);
  expect(html).toContain("Source cleanup is protected");
  expect(html).toContain(
    "Downloader settings differ from the recorded seeding policy",
  );
  expect(html).toContain("No source-cleanup evaluation has been recorded");
});

test("an unresolved removal remains protected even when the last evaluator found the source removable", () => {
  const value = fixture();
  const torrent = firstTorrent(value);
  torrent.state = "removing";
  const diagnostics = torrent.diagnostics;
  if (diagnostics === null) throw new Error("Missing diagnostic fixture");
  diagnostics.protections = ["removal_outcome_unknown"];
  if (diagnostics.cleanup === null) throw new Error("Missing cleanup fixture");
  diagnostics.cleanup.status = "removable";
  diagnostics.cleanup.reason = "obligations_satisfied";
  const html = renderToStaticMarkup(<MediaProgress visibility={value} />);
  expect(html).toContain("Source cleanup is protected");
  expect(html).toContain("A previous removal has an uncertain outcome");
  expect(html).not.toContain("ready to delete");
  expect(html).not.toContain("Source removal was recorded");
});

test("a downloading upgrade preserves independent playable status", () => {
  const value = fixture();
  value.playback = {
    scope: "title",
    playableItems: 1,
    visibleItems: 1,
    playable: true,
    currentAssetId: crypto.randomUUID(),
    currentVersion: 2,
    upgradeInProgress: true,
  };
  firstTorrent(value).progress = 0.427;
  const html = renderToStaticMarkup(<MediaProgress visibility={value} />);
  expect(html).toContain("42%");
  expect(html).toContain("Ready to watch");
  expect(html).toContain("while an upgrade is in progress");
});

test("a partially playable collection names only the visible episode count", () => {
  const value = fixture();
  value.playback = {
    scope: "collection",
    playable: true,
    playableItems: 2,
    visibleItems: 8,
    currentAssetId: null,
    currentVersion: null,
    upgradeInProgress: false,
  };
  value.historyTruncated = true;
  const html = renderToStaticMarkup(<MediaProgress visibility={value} />);
  expect(html).toContain("Some episodes ready");
  expect(html).toContain("2 of 8 visible episodes");
  expect(html).toContain(
    "Episode totals and acquisition history may be partial",
  );
  expect(html).not.toContain("Your current version is ready");
});

test("work before a torrent exists still exposes its acquisition phase", () => {
  const value = fixture();
  value.torrents = [];
  value.attempts = [
    {
      id: crypto.randomUUID(),
      state: "reserved",
      torrentId: null,
      createdAt: "2026-10-17T00:00:00Z",
      currentEpoch: true,
    },
  ];
  const html = renderToStaticMarkup(<MediaProgress visibility={value} />);
  expect(html).toContain("Latest acquisition record");
  expect(html).toContain("Release reserved");
  expect(html).not.toContain("100%");
});

test.each(["stale", "missing", "future", "old_epoch"] as const)(
  "%s evidence is labeled historical rather than fresh progress",
  (freshness) => {
    const value = fixture();
    const torrent = firstTorrent(value);
    torrent.freshness = freshness;
    const diagnostics = torrent.diagnostics;
    if (diagnostics === null) throw new Error("Missing diagnostic fixture");
    if (diagnostics.cleanup === null)
      throw new Error("Missing diagnostic fixture");
    diagnostics.cleanup.freshness = "stale";
    const html = renderToStaticMarkup(<MediaProgress visibility={value} />);
    expect(html).toContain("Last recorded progress");
    expect(html).toContain("Previous evaluation is stale");
    expect(html).not.toContain("Recent observation");
  },
);

test("a member projection has basic accounting without owner policy or cleanup details", () => {
  const value = fixture();
  firstTorrent(value).diagnostics = null;
  const html = renderToStaticMarkup(<MediaProgress visibility={value} />);
  expect(html).toContain("Share ratio");
  expect(html).toContain("Actual seeded time");
  expect(html).not.toContain("knaben");
  expect(html).not.toContain("Recorded policy");
  expect(html).not.toContain("source cleanup");
});

test("unknown and unverified policies stay protected; private AND and OR remain distinct", () => {
  const diagnostics = firstTorrent(fixture()).diagnostics;
  if (diagnostics === null) throw new Error("Missing diagnostic fixture");
  expect(
    policyDescription({ ...diagnostics, policy: { kind: "unknown" } }),
  ).toContain("policy unknown");
  const policy = {
    kind: "private" as const,
    verified: false,
    ratio: 2,
    minimumSeconds: 86_400,
    combination: "all" as const,
    sizeRule: null,
  };
  expect(policyDescription({ ...diagnostics, policy })).toContain("unverified");
  const obligation = {
    satisfied: false,
    reason: "seeding_required" as const,
    requiredSeconds: 86_400,
  };
  expect(
    policyDescription({
      ...diagnostics,
      policy: { ...policy, verified: true },
      obligation,
    }),
  ).toBe("Share ratio 2 AND 1 day of actual seeded time.");
  expect(
    policyDescription({
      ...diagnostics,
      policy: { ...policy, verified: true, combination: "any" },
      obligation,
    }),
  ).toBe("Share ratio 2 OR 1 day of actual seeded time.");
});
