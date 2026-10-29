import { afterEach, expect, test, vi } from "vitest";
import { verifyPlexAssociations } from "#automation/publication/association.ts";
import { associationFixture, page } from "./test-fixture.ts";

afterEach(() => vi.restoreAllMocks());

test("two complete HTTP passes retain exact Parts, omit absent size and ignore counters/titles", async () => {
  const f = associationFixture();
  const item = f.items[0];
  if (item === undefined) {
    throw new Error("Fixture item missing");
  }
  item.Media = [{ Part: [{ id: 500, file: "/data/movies/Synthetic.mkv" }] }];
  let reads = 0;
  const plex = f.createClient((url) => {
    if (url.pathname === "/library/metadata/10") {
      reads++;
      return Response.json({
        MediaContainer: {
          size: 1,
          Metadata: [{ ...item, title: String(reads), viewCount: reads }],
        },
      });
    }
    return;
  });
  const result = await verifyPlexAssociations({ plex }, f.input, f.execution);
  expect(result).toMatchObject({
    purpose: "current_serving",
    associations: [
      {
        item: {
          media: [
            { parts: [{ id: "500", file: "/data/movies/Synthetic.mkv" }] },
          ],
        },
      },
    ],
  });
  if ("status" in result) {
    throw new Error("Expected verified observation");
  }
  expect(result.associations[0]?.item.media[0].parts[0]).not.toHaveProperty(
    "sizeBytes",
  );
  expect(result.verification.passes[0]).toEqual(result.verification.passes[1]);
  expect(reads).toBe(2);
  expect(f.calls.filter((url) => url.pathname === "/identity")).toHaveLength(2);
  expect(f.calls.filter((url) => url.pathname.endsWith("/all"))).toHaveLength(
    2,
  );
  expect(f.calls.some((url) => url.pathname === "/status/sessions")).toBe(
    false,
  );
});

test.each([
  "empty-middle",
  "repeated-page",
  "drifting-total",
  "overrun",
  "over-bound",
])("refuses %s inventory instead of using a partial match", async (failure) => {
  const f = associationFixture();
  let pages = 0;
  const plex = f.createClient((url) => {
    if (!url.pathname.endsWith("/all")) {
      return;
    }
    pages++;
    if (failure === "over-bound") {
      return page(f.items, 10_001);
    }
    if (failure === "overrun") {
      return page(f.items, 0);
    }
    if (pages === 1) {
      return page(f.items, 2);
    }
    if (failure === "empty-middle") {
      return page([], 2);
    }
    return failure === "drifting-total" ? page([], 3) : page(f.items, 2);
  });
  await expect(
    verifyPlexAssociations({ plex }, f.input, f.execution),
  ).resolves.toMatchObject({ status: "protected" });
  expect(
    f.calls.some((url) => url.pathname.startsWith("/library/metadata/")),
  ).toBe(false);
  expect(pages).toBeLessThanOrEqual(2);
});

test("part changes between full passes invalidate both otherwise matching metadata reads", async () => {
  const f = associationFixture();
  let pages = 0;
  const plex = f.createClient((url) => {
    if (url.pathname.endsWith("/all") && ++pages === 2) {
      const item = f.items[0];
      if (item === undefined) {
        throw new Error("Fixture item missing");
      }
      item.Media = [
        { Part: [{ id: 501, file: "/data/movies/Synthetic.mkv", size: 128 }] },
      ];
    }
    return;
  });
  await expect(
    verifyPlexAssociations({ plex }, f.input, f.execution),
  ).resolves.toEqual({ status: "protected", reason: "metadata_changed" });
});

test.each(["server", "section"])(
  "rechecks final %s after both complete passes",
  async (change) => {
    const f = associationFixture();
    let machines = 0,
      sections = 0;
    const plex = f.createClient((url) => {
      if (url.pathname === "/identity") machines++;
      if (
        change === "server" &&
        machines === 2 &&
        url.pathname === "/identity"
      ) {
        return Response.json({
          MediaContainer: { machineIdentifier: "other" },
        });
      }
      if (url.pathname === "/library/sections") sections++;
      if (
        change === "section" &&
        sections === 2 &&
        url.pathname === "/library/sections"
      ) {
        return Response.json({
          MediaContainer: {
            size: 1,
            Directory: [{ key: "1", type: "show", title: "Changed" }],
          },
        });
      }
      return;
    });
    await expect(
      verifyPlexAssociations({ plex }, f.input, f.execution),
    ).resolves.toEqual({
      status: "protected",
      reason: change === "server" ? "wrong_server" : "wrong_section",
    });
  },
);

test("original pre-config deadline expiring during final HTTP read cannot be renewed", async () => {
  const f = associationFixture();
  const now = vi.spyOn(Date, "now").mockReturnValue(f.input.observed.wall);
  f.input.expiresAtMs = f.input.observed.wall + 30_000;
  let machines = 0;
  const plex = f.createClient((url) => {
    if (url.pathname === "/identity" && ++machines === 2) {
      now.mockReturnValue(f.input.observed.wall + 30_000);
    }
    return;
  });
  await expect(
    verifyPlexAssociations({ plex }, f.input, f.execution),
  ).resolves.toEqual({ status: "protected", reason: "verification_expired" });
  expect(machines).toBe(2);
});

test("expired caller observation refuses all HTTP even when helper was just entered", async () => {
  const f = associationFixture();
  f.input.observed.wall -= 60_001;
  await expect(
    verifyPlexAssociations({ plex: f.createClient() }, f.input, f.execution),
  ).resolves.toEqual({ status: "protected", reason: "verification_expired" });
  expect(f.calls).toHaveLength(0);
});

test("canonical hash drift refuses all HTTP without independent ID normalization", async () => {
  const f = associationFixture();
  const target = f.input.expected.targets[0];
  if (target === undefined) {
    throw new Error("Fixture target missing");
  }
  target.canonicalIdentityHash = "f".repeat(64);
  await expect(
    verifyPlexAssociations({ plex: f.createClient() }, f.input, f.execution),
  ).resolves.toEqual({ status: "protected", reason: "scope_changed" });
  expect(f.calls).toHaveLength(0);
});

test("malformed trusted expected input fails loudly before network", async () => {
  const f = associationFixture();
  f.input.expected.recoveryEpoch = -1;
  await expect(
    verifyPlexAssociations({ plex: f.createClient() }, f.input, f.execution),
  ).rejects.toThrow();
  expect(f.calls).toHaveLength(0);
});

test("complete paged inventories advance exact offsets independently in each pass", async () => {
  const f = associationFixture();
  for (let index = 0; index < 200; index++) {
    f.items.push({
      ratingKey: String(index + 100),
      type: "movie",
      title: "Unrelated",
      Media: [
        {
          Part: [
            {
              id: index + 1000,
              file: `/data/movies/Unrelated-${String(index)}.mkv`,
            },
          ],
        },
      ],
    });
  }
  const result = await verifyPlexAssociations(
    { plex: f.createClient() },
    f.input,
    f.execution,
  );
  if ("status" in result) {
    throw new Error(`Expected complete proof: ${result.reason}`);
  }
  expect(result.verification.passes.map((pass) => pass.itemCount)).toEqual([
    201, 201,
  ]);
  expect(
    f.calls
      .filter((url) => url.pathname.endsWith("/all"))
      .map((url) => url.searchParams.get("X-Plex-Container-Start")),
  ).toEqual(["0", "200", "0", "200"]);
});

test("fresh configured access must exactly equal the immutable expected access before HTTP", async () => {
  const f = associationFixture();
  f.input.access = [
    {
      serverMachineId: "synthetic-server",
      sectionId: "2",
      sectionType: "movie",
    },
  ];
  await expect(
    verifyPlexAssociations({ plex: f.createClient() }, f.input, f.execution),
  ).resolves.toEqual({ status: "protected", reason: "wrong_section" });
  expect(f.calls).toHaveLength(0);
});
