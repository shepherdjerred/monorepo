import { expect } from "vitest";
import { z } from "zod";
import {
  KnabenProvider,
  AvistazFamilyProvider,
} from "#integrations/providers.ts";
import type { MediaAutomationContext } from "#automation/context.ts";
import { sweepFeeds } from "#automation/reconciliation/feeds.ts";
import {
  FeedSourceV1Schema,
  MatchFeedSourceV1Schema,
} from "#shared/feeds/contract.ts";

/** Native recent handlers and real encrypted feed/checkpoint/outbox producers; only the remote response is synthetic. */
export async function captureManagedFeedSource(
  original: MediaAutomationContext,
  input: {
    providerId: "knaben" | "privatehd";
    title: string;
    sizeBytes: number;
  },
) {
  const id = crypto.randomUUID();
  const hash = crypto.randomUUID().replaceAll("-", "").padEnd(40, "a");
  const native =
    input.providerId === "knaben"
      ? new KnabenProvider((url) => {
          expect(url.pathname).toBe("/v2/browse");
          return Promise.resolve(
            Response.json({
              hits: [
                {
                  id,
                  title: input.title,
                  bytes: input.sizeBytes,
                  hash,
                  seeders: 2,
                  details: "https://knaben.org/fixture",
                  magnetUrl: null,
                },
              ],
            }),
          );
        })
      : new AvistazFamilyProvider(
          {
            providerId: "privatehd",
            username: "synthetic",
            password: "synthetic",
            pid: "synthetic",
          },
          (url) => {
            expect(url.pathname).toBe("/api/v1/jackett/torrents");
            expect(url.searchParams.get("search")).toBe("");
            return Promise.resolve(
              Response.json({
                data: [
                  {
                    url: `https://privatehd.to/torrent/${id}`,
                    download: `https://privatehd.to/download/${id}`,
                    file_name: input.title,
                    file_size: input.sizeBytes,
                    info_hash: hash,
                    seed: 2,
                  },
                ],
              }),
            );
          },
          "synthetic",
        );
  await original.db.mediaProvider.upsert({
    where: { id: input.providerId },
    create: { id: input.providerId, enabled: true },
    update: { enabled: true },
  });
  const context: MediaAutomationContext = {
    ...original,
    providers: {
      withProvider: (providerId, work) => {
        expect(providerId).toBe(input.providerId);
        return work(native);
      },
    },
  };
  expect(
    await sweepFeeds(
      context,
      input.providerId === "knaben" ? null : "knaben",
      crypto.randomUUID(),
    ),
  ).toMatchObject({ processed: 1, nextCursor: input.providerId });
  const events = await original.db.applicationEvent.findMany({
    where: { kind: "provider_feed_source_v1" },
  });
  const source = events.find((event) => {
    const stored = FeedSourceV1Schema.parse(event.payload);
    return (
      stored.providerId === input.providerId &&
      stored.providerReleaseId.endsWith(id)
    );
  });
  if (source === undefined)
    throw new Error("Actual native source was not retained");
  const command = await original.db.operation.findUniqueOrThrow({
    where: { idempotencyKey: `match-feed-source-v1:${source.id}` },
  });
  return {
    context,
    source,
    input: MatchFeedSourceV1Schema.parse(
      z.object(MatchFeedSourceV1Schema.shape).parse(command.payload),
    ),
  };
}
