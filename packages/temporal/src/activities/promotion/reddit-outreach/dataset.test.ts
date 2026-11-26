import { describe, expect, it, vi } from "vitest";
import { memoryPromotionStore } from "#activities/promotion/test-support.ts";
import {
  createRedditDatasetArchive,
  RedditDatasetObservationSchema,
  RedditDatasetStorageError,
} from "./dataset.ts";

const startedAt = new Date("2026-11-25T02:00:00.000Z");
const occurrenceId = "workflow/run";
const listingKey =
  "reddit-outreach/dataset/v1/day=2026-11-24/mode=live/run=workflow%2Frun/listings/000001.json";
const post = {
  id: "abc123",
  subreddit: "MinecraftServer",
  title: "Looking for a small SMP",
  url: "https://www.reddit.com/r/MinecraftServer/comments/abc123/",
  createdAt: "2026-11-25T01:50:00Z",
  author: "seeking-player",
  flair: null,
  sticky: false,
  locked: false,
  removed: false,
  archived: false,
  over18: false,
};

function setup() {
  const store = memoryPromotionStore();
  const archive = createRedditDatasetArchive({
    store,
    now: () => startedAt,
    occurrenceId,
    preview: false,
    signal: new AbortController().signal,
  });
  return { store, archive };
}

describe("Reddit dataset archive", () => {
  it("retries the exact observation and accepts read-back after a lost PUT response", async () => {
    const { store, archive } = setup();
    const originalPut = store.put;
    const put = vi
      .spyOn(store, "put")
      .mockImplementationOnce(async (...args) => {
        await originalPut(...args);
        throw new Error("Lost write response");
      });
    await archive.listing(post.subreddit, [post]);
    expect(put).toHaveBeenCalledTimes(2);
    expect(put.mock.calls[0]?.slice(0, 3)).toEqual(
      put.mock.calls[1]?.slice(0, 3),
    );
    const saved = await store.read(listingKey, RedditDatasetObservationSchema);
    if (saved?.value.kind !== "listing")
      throw new Error("Expected listing capture");
    expect(saved.value.posts[0]).toMatchObject({ id: post.id });
    expect(saved.value.posts[0]).not.toHaveProperty("author");
  });

  it("preserves an occupied observation key with different content", async () => {
    const { store, archive } = setup();
    const existing = {
      schemaVersion: 1,
      occurrenceId,
      observedAt: startedAt.toISOString(),
      kind: "listing",
      subreddit: post.subreddit,
      posts: [],
    };
    await store.put(listingKey, existing, undefined);
    await expect(
      archive.listing(post.subreddit, [post]),
    ).rejects.toBeInstanceOf(RedditDatasetStorageError);
    expect(
      await store.read(listingKey, RedditDatasetObservationSchema),
    ).toMatchObject({
      value: existing,
    });
  });

  it("archives loaded comment text with secret redaction", async () => {
    const { store, archive } = setup();
    await archive.thread({
      post: {
        id: post.id,
        subreddit: post.subreddit,
        url: post.url,
        createdAt: post.createdAt,
        author: post.author,
        title: post.title,
        archived: false,
        locked: false,
        removed: false,
        body: "Body with Bearer sampletoken",
        loggedInUsername: "session-account",
        ownReplyIds: ["xyz789"],
        commentsComplete: false,
      },
      comments: [
        {
          id: "xyz789",
          parentId: "t3_abc123",
          body: "Comment with password=sample",
          createdAt: null,
          isStormReply: true,
        },
      ],
    });
    const saved = await store.read(
      listingKey.replace("/listings/", "/threads/"),
      RedditDatasetObservationSchema,
    );
    if (saved?.value.kind !== "thread")
      throw new Error("Expected thread capture");
    expect(saved.value.post).toMatchObject({
      id: post.id,
      body: "Body with Bearer [REDACTED]",
      commentsComplete: false,
    });
    expect(saved.value.post).not.toHaveProperty("loggedInUsername");
    expect(saved.value.comments).toEqual([
      {
        id: "xyz789",
        parentId: "t3_abc123",
        body: "Comment with password=[REDACTED]",
        createdAt: null,
        isStormReply: true,
      },
    ]);
  });
});
