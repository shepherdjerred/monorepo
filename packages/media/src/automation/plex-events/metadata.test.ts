import { expect, test } from "vitest";
import { associationFixture } from "#automation/publication/association/test-fixture.ts";
import { verifyPlexAssociations } from "#automation/publication/association.ts";
import { observeAssociatedWatch } from "./metadata.ts";

async function bound(kind: "movie" | "episode" = "movie") {
  const f = associationFixture(kind);
  const verified = await verifyPlexAssociations(
    { plex: f.createClient() },
    f.input,
    f.execution,
  );
  if ("status" in verified)
    throw new Error(`Synthetic association failed: ${verified.reason}`);
  const association = verified.associations[0];
  const item = f.items[0];
  if (association === undefined || item === undefined)
    throw new Error("Synthetic association omitted its leaf");
  f.calls.length = 0;
  return { ...f, verified, association, item };
}

test.each([undefined, 0, 2])(
  "one exact response retains watch value %s without a second leaf read",
  async (viewCount) => {
    const f = await bound();
    if (viewCount !== undefined) f.item.viewCount = viewCount;
    const signals: AbortSignal[] = [];
    const plex = f.createClient((_url, init) => {
      if (init.signal !== null && init.signal !== undefined)
        signals.push(init.signal);
      return;
    });
    expect(
      await observeAssociatedWatch(
        { plex, execution: f.execution, freshness: f.verified.freshness },
        f.association,
      ),
    ).toBe((viewCount ?? 0) > 0);
    expect(signals).toHaveLength(1);
    expect(signals[0]?.aborted).toBe(false);
    expect(f.calls.map((url) => url.pathname)).toEqual([
      `/library/metadata/${f.item.ratingKey}`,
    ]);
  },
);

test.each([
  "key",
  "part",
  "path",
  "size",
  "guid",
  "multiple",
  "missing",
] as const)(
  "changed %s is unknown rather than an unwatched boolean",
  async (change) => {
    const f = await bound();
    f.item.viewCount = 0;
    const part = f.item.Media?.[0]?.Part[0];
    if (part === undefined) throw new Error("Synthetic Part omitted");
    if (change === "part") part.id++;
    if (change === "path") part.file = "/data/movies/Other.mkv";
    if (change === "size") part.size = 129;
    if (change === "guid") f.item.Guid = [{ id: "tmdb://456" }];
    const plex = f.createClient(() => {
      if (change === "missing") return new Response(null, { status: 404 });
      if (change === "key")
        return Response.json({
          MediaContainer: {
            size: 1,
            Metadata: [{ ...f.item, ratingKey: "77" }],
          },
        });
      if (change === "multiple")
        return Response.json({
          MediaContainer: { size: 2, Metadata: [f.item, f.item] },
        });
      return;
    });
    expect(
      await observeAssociatedWatch(
        { plex, execution: f.execution, freshness: f.verified.freshness },
        f.association,
      ),
    ).toBeNull();
    expect(f.calls).toHaveLength(1);
  },
);

test("TV watch uses the exact retained series and season hierarchy, including a changed root GUID", async () => {
  const f = await bound("episode");
  f.item.viewCount = 1;
  const context = {
    plex: f.createClient(),
    execution: f.execution,
    freshness: f.verified.freshness,
  };
  expect(await observeAssociatedWatch(context, f.association)).toBe(true);
  const show = f.metadata.get("901");
  if (show === undefined) throw new Error("Synthetic root omitted");
  show.Guid = [{ id: "tmdb://456" }];
  expect(await observeAssociatedWatch(context, f.association)).toBeNull();
});

test("cancellation at the last metadata response cannot settle either true or false", async () => {
  const f = await bound();
  const signals: AbortSignal[] = [];
  const reason = new Error("Synthetic cancelled observation");
  const plex = f.createClient((_url, init) => {
    if (init.signal !== null && init.signal !== undefined)
      signals.push(init.signal);
    f.controller.abort(reason);
    return;
  });
  await expect(
    observeAssociatedWatch(
      { plex, execution: f.execution, freshness: f.verified.freshness },
      f.association,
    ),
  ).rejects.toThrow("Synthetic cancelled observation");
  expect(signals).toHaveLength(1);
  expect(signals[0]?.aborted).toBe(true);
  expect(signals[0]?.reason).toBe(reason);
  expect(f.calls).toHaveLength(1);
});
