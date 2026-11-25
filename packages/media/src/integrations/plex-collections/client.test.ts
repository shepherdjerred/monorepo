import { expect, test } from "vitest";
import { PlexClient } from "#integrations/plex.ts";

const target = {
  ratingKey: "5367",
  sectionId: "2",
  title: "Shows going away",
  sectionType: "show",
} as const;
const collection = {
  type: "collection",
  ratingKey: target.ratingKey,
  subtype: target.sectionType,
  librarySectionID: 2,
  title: target.title,
  guid: "collection://123",
  smart: false,
  childCount: "1",
};
const signal = new AbortController().signal;
const config = {
  baseUrl: "http://plex.test",
  token: "test-token",
  clientIdentifier: "client",
};

test("reads the exact reviewed static collection and verifies complete membership", async () => {
  const client = new PlexClient(config, (url) => {
    if (url.pathname === "/library/metadata/5367")
      return Promise.resolve(
        Response.json({ MediaContainer: { size: 1, Metadata: [collection] } }),
      );
    expect(url.pathname).toBe("/library/metadata/5367/children");
    expect(url.searchParams.get("X-Plex-Container-Size")).toBe("1001");
    return Promise.resolve(
      Response.json({
        MediaContainer: {
          size: 1,
          totalSize: 1,
          Metadata: [{ ratingKey: "11", type: "show" }],
        },
      }),
    );
  });
  expect(await client.collection(target, signal)).toEqual({
    guid: collection.guid,
    memberKeys: new Set(["11"]),
  });
});

test.each([
  { smart: true },
  { librarySectionID: 1 },
  { subtype: "movie" },
  { title: "Another collection" },
  { ratingKey: "12" },
])("refuses collection identity drift: %o", async (override) => {
  const client = new PlexClient(config, (url) => {
    expect(url.pathname).toBe("/library/metadata/5367");
    const Metadata = [{ ...collection, ...override }];
    return Promise.resolve(
      Response.json({ MediaContainer: { size: 1, Metadata } }),
    );
  });
  await expect(client.collection(target, signal)).rejects.toThrow("plex");
});

test("refuses a partial inventory", async () => {
  const client = new PlexClient(config, (url) => {
    const data = url.pathname.endsWith("/children")
      ? { size: 0, totalSize: 1 }
      : { size: 1, Metadata: [collection] };
    return Promise.resolve(Response.json({ MediaContainer: data }));
  });
  await expect(client.collection(target, signal)).rejects.toMatchObject({
    kind: "conflict",
  });
});

test("changes precisely one collection membership on the reviewed server", async () => {
  const calls: {
    path: string;
    uri: string | null;
    method: string | undefined;
  }[] = [];
  const client = new PlexClient(config, (url, request) => {
    calls.push({
      path: url.pathname,
      uri: url.searchParams.get("uri"),
      method: request.method,
    });
    return Promise.resolve(new Response(null));
  });
  const scope = {
    serverMachineId: "reviewed-server",
    collection: "5367",
    member: "11",
  };
  await client.setCollectionMembership({ ...scope, present: true }, signal);
  await client.setCollectionMembership({ ...scope, present: false }, signal);
  expect(calls).toEqual([
    {
      method: "PUT",
      path: "/library/collections/5367/items",
      uri: "server://reviewed-server/com.plexapp.plugins.library/library/metadata/11",
    },
    { method: "DELETE", path: "/library/collections/5367/items/11", uri: null },
  ]);
});
