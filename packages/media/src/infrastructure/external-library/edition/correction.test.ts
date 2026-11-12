import { expect, test } from "vitest";
import { PlexClient, type PlexEditionItem } from "#integrations/plex.ts";
import { MediaError } from "#application/errors.ts";
import type { MediaActor } from "#application/auth.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import { createExternalEditionCorrection } from "./correction.ts";
import type { ExternalEditionStore } from "./records.ts";
import type {
  ExternalEditionIntent,
  ExternalEditionResult,
  ExternalEditionReview,
} from "./contract.ts";

function fixture(filename = "Example.Film.2024.Extended.1080p.mkv") {
  const actor: MediaActor = {
    id: crypto.randomUUID(),
    plexAccountId: "100",
    displayName: "Owner",
    role: "owner",
    restricted: false,
    version: 1,
  };
  const media = {
    id: crypto.randomUUID(),
    kind: "movie",
    title: "Example Film",
    aliases: [],
    version: 2,
    tmdbId: 123,
    externalIds: {},
    seasonNumber: null,
    episodeNumber: null,
  };
  const target = {
    mediaId: media.id,
    ratingKey: "456",
    canonicalPath: `/data/movies/${filename}`,
    sizeBytes: "12345",
    edition: "extended_cut" as const,
  };
  const item: PlexEditionItem = {
    ratingKey: "456",
    type: "movie",
    librarySectionID: 1,
    title: media.title,
    year: 2024,
    editionTitle: "Wrong Label",
    Guid: [{ id: "tmdb://123" }],
    viewCount: 2,
    lastViewedAt: 100,
    viewOffset: 1234,
    Media: [{ Part: [{ id: 789, file: target.canonicalPath, size: 12_345 }] }],
  };
  let intent: ExternalEditionIntent | null = null;
  let completion: ExternalEditionResult | null = null;
  let revoked = false;
  let lostReply = false;
  let changedOnPut = false;
  let nextRead: (() => void) | null = null;
  const requests: { url: URL; method: string }[] = [];
  const store: ExternalEditionStore = {
    media: () => {
      if (revoked) throw new MediaError("forbidden", "Owner revoked", 403);
      return Promise.resolve(media);
    },
    read: () =>
      Promise.resolve(intent === null ? null : { intent, completion }),
    begin: (_actor, value) => {
      if (intent !== null) return Promise.resolve(false);
      intent = structuredClone(value);
      return Promise.resolve(true);
    },
    authorized: async (_actor, _review, work) => {
      if (revoked) throw new MediaError("forbidden", "Owner revoked", 403);
      await work(media, () => Promise.resolve());
    },
    complete: (_actor, _review, value) => {
      completion = structuredClone(value);
      return Promise.resolve();
    },
  };
  const plex = new PlexClient(
    {
      baseUrl: "http://external-plex.fixture",
      token: "fixture",
      clientIdentifier: "fixture",
    },
    (url, init) => {
      requests.push({ url, method: init.method ?? "GET" });
      if (url.pathname === "/identity")
        return Promise.resolve(
          Response.json({
            MediaContainer: { machineIdentifier: "configured-server" },
          }),
        );
      if (init.method === "PUT") {
        expect(intent).not.toBeNull();
        item.editionTitle = url.searchParams.get("editionTitle.value") ?? "";
        if (changedOnPut) item.viewCount = 0;
        return lostReply
          ? Promise.reject(new Error("Synthetic lost reply"))
          : Promise.resolve(new Response("", { status: 200 }));
      }
      nextRead?.();
      nextRead = null;
      return Promise.resolve(
        Response.json({ MediaContainer: { size: 1, Metadata: [item] } }),
      );
    },
  );
  return {
    actor,
    media,
    target,
    item,
    store,
    requests,
    service: createExternalEditionCorrection({
      plex,
      store,
      expectedServerMachineId: "configured-server",
      permittedMovieSection: () => Promise.resolve("1"),
    }),
    intent: () => intent,
    completion: () => completion,
    revoke: () => {
      revoked = true;
    },
    loseReply: () => {
      lostReply = true;
    },
    regressWatch: () => {
      changedOnPut = true;
    },
    onRead: (work: () => void) => {
      nextRead = work;
    },
  };
}

test("metadata-only correction persists intent before one exact PUT and preserves item, Part and watch facts", async () => {
  const f = fixture();
  const review = await f.service.preview(f.actor, f.target);
  const operationId = crypto.randomUUID();
  const result = await f.service.apply(f.actor, { operationId, review });
  expect(result).toMatchObject({
    status: "completed",
    response: "acknowledged",
    after: {
      editionTitle: "Extended Cut",
      watch: review.before.watch,
      identity: review.before.identity,
    },
  });
  expect(f.requests.filter((request) => request.method === "PUT")).toHaveLength(
    1,
  );
  expect(
    Object.fromEntries(
      f.requests.find((request) => request.method === "PUT")?.url
        .searchParams ?? [],
    ),
  ).toEqual({
    type: "1",
    id: "456",
    "editionTitle.value": "Extended Cut",
    "editionTitle.locked": "1",
  });
  expect(await f.service.apply(f.actor, { operationId, review })).toEqual(
    result,
  );
  expect(f.requests.filter((request) => request.method === "PUT")).toHaveLength(
    1,
  );
  expect(f.intent()).not.toHaveProperty("ownershipEpoch");
});

test("a lost PUT reply is confirmed by exact readback, without resending", async () => {
  const f = fixture();
  const review = await f.service.preview(f.actor, f.target);
  f.loseReply();
  const input = { operationId: crypto.randomUUID(), review };
  expect(await f.service.apply(f.actor, input)).toMatchObject({
    response: "lost_or_unobserved",
    status: "completed",
  });
  await f.service.apply(f.actor, input);
  expect(f.requests.filter((request) => request.method === "PUT")).toHaveLength(
    1,
  );
});

test("a retained uncertain intent only observes; it cannot blindly resend or accept a new operation", async () => {
  const f = fixture();
  const review = await f.service.preview(f.actor, f.target);
  const operationId = crypto.randomUUID();
  await f.store.begin(f.actor, {
    kind: "external_plex_edition_intent_v1",
    operationId,
    review,
  });
  await expect(
    f.service.apply(f.actor, { operationId, review }),
  ).rejects.toThrow();
  await expect(
    f.service.apply(f.actor, { operationId: crypto.randomUUID(), review }),
  ).rejects.toThrow();
  expect(f.requests.filter((request) => request.method === "PUT")).toHaveLength(
    0,
  );
  expect(f.completion()).toBeNull();
});

test.each(["part", "path", "guid", "size", "section", "version"] as const)(
  "changed %s invalidates the exact reviewed correction before PUT",
  async (changed) => {
    const f = fixture();
    const review = await f.service.preview(f.actor, f.target);
    if (changed === "part")
      f.item.Media = [
        { Part: [{ id: 999, file: f.target.canonicalPath, size: 12_345 }] },
      ];
    if (changed === "path")
      f.item.Media = [
        { Part: [{ id: 789, file: "/data/movies/Other.mkv", size: 12_345 }] },
      ];
    if (changed === "guid") f.item.Guid = [{ id: "tmdb://999" }];
    if (changed === "size")
      f.item.Media = [
        { Part: [{ id: 789, file: f.target.canonicalPath, size: 12_346 }] },
      ];
    if (changed === "section") f.item.librarySectionID = 2;
    if (changed === "version") f.media.version++;
    await expect(
      f.service.apply(f.actor, { operationId: crypto.randomUUID(), review }),
    ).rejects.toThrow();
    expect(
      f.requests.filter((request) => request.method === "PUT"),
    ).toHaveLength(0);
  },
);

test("an owner revoked after preview cannot create an edit intent", async () => {
  const f = fixture();
  const review = await f.service.preview(f.actor, f.target);
  f.revoke();
  await expect(
    f.service.apply(f.actor, { operationId: crypto.randomUUID(), review }),
  ).rejects.toMatchObject({ code: "forbidden" });
  expect(f.intent()).toBeNull();
});

test("a watch regression after PUT remains fenced and never claims completion", async () => {
  const f = fixture();
  const review = await f.service.preview(f.actor, f.target);
  f.regressWatch();
  const input = { operationId: crypto.randomUUID(), review };
  await expect(f.service.apply(f.actor, input)).rejects.toThrow();
  await expect(f.service.apply(f.actor, input)).rejects.toThrow();
  expect(f.completion()).toBeNull();
  expect(f.requests.filter((request) => request.method === "PUT")).toHaveLength(
    1,
  );
});

test.each(["Example.Film.2024.DC.1080p.mkv", "Example.Film.2024.1080p.mkv"])(
  "ambiguous or unmarked filename %s never proves a named cut",
  async (filename) => {
    const f = fixture(filename);
    await expect(
      f.service.preview(f.actor, { ...f.target, edition: "theatrical_cut" }),
    ).rejects.toThrow();
    expect(
      f.requests.filter((request) => request.method === "PUT"),
    ).toHaveLength(0);
  },
);

test("a reviewed unmarked file clears an incorrect named label without claiming theatrical", async () => {
  const f = fixture("Example.Film.2024.1080p.mkv");
  const review = await f.service.preview(f.actor, {
    ...f.target,
    edition: "default",
  });
  expect(
    await f.service.apply(f.actor, {
      operationId: crypto.randomUUID(),
      review,
    }),
  ).toMatchObject({ after: { editionTitle: "" } });
});

test("expired review and malformed review digest cause no intent or PUT", async () => {
  const f = fixture();
  const review = await f.service.preview(f.actor, f.target);
  const { reviewHash: _hash, ...body } = review;
  const expired = { ...body, expiresAt: new Date(0).toISOString() };
  for (const invalid of [
    { ...review, reviewHash: "0".repeat(64) },
    { ...expired, reviewHash: identityHash(expired) },
  ]) {
    await expect(
      f.service.apply(f.actor, {
        operationId: crypto.randomUUID(),
        review: invalid,
      }),
    ).rejects.toThrow();
  }
  expect(f.intent()).toBeNull();
});

test("a fresh item swap after durable intent still fails the final pre-PUT comparison", async () => {
  const f = fixture();
  const review = await f.service.preview(f.actor, f.target);
  const begin = f.store.begin;
  f.store.begin = async (actor, intent) => {
    const created = await begin(actor, intent);
    f.onRead(() => {
      f.item.Guid = [{ id: "tmdb://999" }];
    });
    return created;
  };
  await expect(
    f.service.apply(f.actor, { operationId: crypto.randomUUID(), review }),
  ).rejects.toThrow();
  expect(f.intent()).not.toBeNull();
  expect(f.requests.filter((request) => request.method === "PUT")).toHaveLength(
    0,
  );
});

test("the reviewed snapshot does not authorize another actor", async () => {
  const f = fixture();
  const review: ExternalEditionReview = await f.service.preview(
    f.actor,
    f.target,
  );
  await expect(
    f.service.apply(
      { ...f.actor, id: crypto.randomUUID() },
      { operationId: crypto.randomUUID(), review },
    ),
  ).rejects.toThrow();
  expect(f.intent()).toBeNull();
});

test("a transaction lost during PMS reproof leaves its intent fenced and sends no PUT", async () => {
  const f = fixture();
  const review = await f.service.preview(f.actor, f.target);
  f.store.authorized = async (_actor, _review, work) => {
    await work(f.media, () =>
      Promise.reject(new Error("Synthetic closed transaction")),
    );
  };
  await expect(
    f.service.apply(f.actor, { operationId: crypto.randomUUID(), review }),
  ).rejects.toThrow("Synthetic closed transaction");
  expect(f.intent()).not.toBeNull();
  expect(f.completion()).toBeNull();
  expect(f.requests.filter((request) => request.method === "PUT")).toHaveLength(
    0,
  );
});

test("merged Plex Parts are protected instead of changing a label shared by multiple files", async () => {
  const f = fixture();
  f.item.Media = [
    {
      Part: [
        { id: 789, file: f.target.canonicalPath, size: 12_345 },
        { id: 790, file: "/data/movies/Another.mkv", size: 12_345 },
      ],
    },
  ];
  await expect(f.service.preview(f.actor, f.target)).rejects.toThrow();
  expect(f.intent()).toBeNull();
  expect(f.requests.filter((request) => request.method === "PUT")).toHaveLength(
    0,
  );
});
