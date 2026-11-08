import { expect, test } from "vitest";
import { verifyPlexAssociations } from "#automation/publication/association.ts";
import { associationFixture, page } from "./test-fixture.ts";

test.each([
  "extra-version",
  "extra-part",
  "unsafe-id",
  "unsafe-size",
  "wrong-size",
  "wrong-guid",
  "conflicting-guid",
])("protects %s instead of narrowing external evidence", async (failure) => {
  const f = associationFixture();
  const item = f.items[0];
  if (item === undefined) {
    throw new Error("Fixture item missing");
  }
  const part = { id: 500, file: "/data/movies/Synthetic.mkv", size: 128 };
  switch (failure) {
    case "extra-version":
      item.Media = [{ Part: [part] }, { Part: [part] }];
      break;
    case "extra-part":
      item.Media = [{ Part: [part, { ...part, id: 501 }] }];
      break;
    case "unsafe-id":
      item.Media = [{ Part: [{ ...part, id: Number.MAX_SAFE_INTEGER + 1 }] }];
      break;
    case "unsafe-size":
      item.Media = [{ Part: [{ ...part, size: Number.MAX_SAFE_INTEGER + 1 }] }];
      break;
    case "wrong-size":
      item.Media = [{ Part: [{ ...part, size: 129 }] }];
      break;
    case "wrong-guid":
      item.Guid = [{ id: "tmdb://999" }];
      break;
    case "conflicting-guid":
      item.Guid = [{ id: "tmdb://123" }, { id: "tmdb://999" }];
      break;
  }
  await expect(
    verifyPlexAssociations({ plex: f.createClient() }, f.input, f.execution),
  ).resolves.toMatchObject({ status: "protected" });
});

test.each(["same-path", "same-part"])(
  "an unconfigured video section's %s collision prevents positive binding",
  async (collision) => {
    const f = associationFixture();
    f.sections.push({ key: "2", type: "movie", title: "Other library" });
    const foreign = {
      ratingKey: "20",
      type: "movie",
      title: "Foreign",
      Guid: [{ id: "tmdb://456" }],
      Media: [
        {
          Part: [
            {
              id: collision === "same-part" ? 500 : 501,
              file:
                collision === "same-path"
                  ? "/data/movies/Synthetic.mkv"
                  : "/data/movies/Other.mkv",
              size: 128,
            },
          ],
        },
      ],
    };
    const plex = f.createClient((url) =>
      url.pathname === "/library/sections/2/all" ? page([foreign]) : undefined,
    );
    await expect(
      verifyPlexAssociations({ plex }, f.input, f.execution),
    ).resolves.toEqual({ status: "protected", reason: "ambiguous_item" });
    expect(
      f.calls.some((url) => url.pathname === "/library/sections/2/all"),
    ).toBe(true);
  },
);

test("duplicate keys across video libraries are not deduplicated into success", async () => {
  const f = associationFixture();
  f.sections.push({ key: "2", type: "movie", title: "Other library" });
  const plex = f.createClient((url) =>
    url.pathname === "/library/sections/2/all" ? page(f.items) : undefined,
  );
  await expect(
    verifyPlexAssociations({ plex }, f.input, f.execution),
  ).resolves.toEqual({ status: "protected", reason: "ambiguous_item" });
});

test.each(["duplicate-section", "too-many-sections"])(
  "refuses %s before any inventory",
  async (failure) => {
    const f = associationFixture();
    if (failure === "duplicate-section") {
      f.sections.push({ key: "1", type: "movie", title: "Duplicate" });
    } else {
      for (let key = 2; key <= 101; key++) {
        f.sections.push({
          key: String(key),
          type: "movie",
          title: "Synthetic",
        });
      }
    }
    await expect(
      verifyPlexAssociations({ plex: f.createClient() }, f.input, f.execution),
    ).resolves.toEqual({ status: "protected", reason: "wrong_section" });
    expect(f.calls.some((url) => url.pathname.endsWith("/all"))).toBe(false);
  },
);

test("404 metadata protects without accepting the matching inventory row", async () => {
  const f = associationFixture();
  const plex = f.createClient((url) =>
    url.pathname === "/library/metadata/10"
      ? new Response(null, { status: 404 })
      : undefined,
  );
  await expect(
    verifyPlexAssociations({ plex }, f.input, f.execution),
  ).resolves.toEqual({ status: "protected", reason: "inaccessible" });
});

test("caller cancellation is propagated rather than encoded as successful or protected serving proof", async () => {
  const f = associationFixture();
  const reason = new Error("Synthetic cancellation");
  const observed: { signal: AbortSignal | null | undefined } = {
    signal: undefined,
  };
  const plex = f.createClient((_url, init) => {
    observed.signal = init.signal;
    f.controller.abort(reason);
    return;
  });
  await expect(
    verifyPlexAssociations({ plex }, f.input, f.execution),
  ).rejects.toBe(reason);
  expect(observed.signal?.aborted).toBe(true);
  expect(f.calls).toHaveLength(1);
});

test("one serving invocation verifies movie and TV groups against only their bound configured sections", async () => {
  const movie = associationFixture(),
    tv = associationFixture("episode");
  const episode = tv.items[0];
  if (episode === undefined) {
    throw new Error("Fixture episode missing");
  }
  episode.ratingKey = "20";
  episode.Media = [
    { Part: [{ id: 600, file: "/data/tv/Synthetic.mkv", size: 128 }] },
  ];
  const access = [
    {
      serverMachineId: "synthetic-server",
      sectionId: "1",
      sectionType: "movie" as const,
    },
    {
      serverMachineId: "synthetic-server",
      sectionId: "2",
      sectionType: "show" as const,
    },
  ];
  movie.input.access = access;
  movie.input.expected.access = access;
  movie.input.expected.targets.push(...tv.input.expected.targets);
  movie.input.expected.targets.sort((a, b) =>
    a.scope.mediaId.localeCompare(b.scope.mediaId),
  );
  movie.input.expected.previous.push(...tv.input.expected.previous);
  movie.input.expected.previous.sort((a, b) =>
    a.scope.mediaId.localeCompare(b.scope.mediaId),
  );
  movie.input.expected.newGroups.push(...tv.input.expected.newGroups);
  movie.input.expected.newGroups.sort((a, b) =>
    a.assetId.localeCompare(b.assetId),
  );
  movie.input.expected.parents.push(...tv.input.expected.parents);
  movie.input.canonicalTargets = [
    ...movie.input.canonicalTargets,
    ...tv.input.canonicalTargets,
  ];
  movie.sections.push({ key: "2", type: "show", title: "TV" });
  const plex = movie.createClient((url) => {
    if (url.pathname === "/library/sections/2/all") {
      return page(tv.items);
    }
    const key = url.pathname.split("/").at(-1);
    const item =
      key === "20"
        ? episode
        : key === undefined
          ? undefined
          : tv.metadata.get(key);
    return item === undefined
      ? undefined
      : Response.json({ MediaContainer: { size: 1, Metadata: [item] } });
  });
  const result = await verifyPlexAssociations(
    { plex },
    movie.input,
    movie.execution,
  );
  if ("status" in result) {
    throw new Error(`Expected both configured groups: ${result.reason}`);
  }
  expect(result.associations).toHaveLength(2);
  expect(new Set(result.associations.map((row) => row.kind))).toEqual(
    new Set(["movie", "episode"]),
  );
});
