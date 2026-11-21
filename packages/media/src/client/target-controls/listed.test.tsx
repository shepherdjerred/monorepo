import { afterEach, expect, test, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClientProvider } from "@tanstack/react-query";
import { UserSchema } from "#shared/contract.ts";
import { queryClient, sessionBoundary } from "#client/api.ts";
import { SessionChangedError } from "#client/session.ts";
import { readListedTargets, readTarget } from "./api.ts";
import { ListedTargets, listedTargetsKey } from "./listed.tsx";
import { ListedMediaAction } from "./protection.tsx";

afterEach(() => {
  vi.unstubAllGlobals();
  queryClient.clear();
});

const member = UserSchema.parse({
  id: crypto.randomUUID(),
  plexAccountId: "123",
  displayName: "Member",
  role: "member",
  restricted: false,
  version: 0,
});

function ids(count: number): string[] {
  return Array.from({ length: count }, () => crypto.randomUUID());
}

function view(mediaId: string) {
  return {
    schemaVersion: 2,
    access: "detail",
    scope: { mediaId, edition: "default" },
    expected: { mediaVersion: 4, targetVersion: 1 },
    target: { generation: 1, availability: "available", lineage: "resolved" },
    ownRequests: [],
    allowedProtectiveActions: ["keep"],
  };
}

const SINGLE = /^\/api\/v2\/media\/([^/]+)\/targets\/default$/u;

/** The two target reads, answered from `view`. Records every request made. */
function serve(
  options: {
    forbidden?: readonly string[];
    order?: (mediaIds: string[]) => string[];
    before?: () => void;
  } = {},
) {
  const requests: { path: string; ids: string[] }[] = [];
  vi.stubGlobal("fetch", (input: string) => {
    const address = new URL(input, "http://media.invalid");
    const single = SINGLE.exec(address.pathname);
    if (single !== null) {
      requests.push({ path: address.pathname, ids: [single[1] ?? ""] });
      return Promise.resolve(Response.json(view(single[1] ?? "")));
    }
    const asked = (address.searchParams.get("ids") ?? "").split(",");
    requests.push({ path: address.pathname, ids: asked });
    options.before?.();
    return Promise.resolve(
      Response.json({
        schemaVersion: 2,
        items: (options.order?.(asked) ?? asked).map((mediaId) =>
          options.forbidden?.includes(mediaId) === true
            ? { status: "unavailable", mediaId, code: "forbidden" }
            : { status: "ok", view: view(mediaId) },
        ),
      }),
    );
  });
  return requests;
}

function seeded(mediaIds: readonly string[]) {
  return mediaIds.filter(
    (mediaId) => queryClient.getQueryData(["target", mediaId]) !== undefined,
  );
}

test("a list of titles is one request that fills the key each row reads", async () => {
  const requests = serve();
  const listed = ids(15);
  expect(await readListedTargets(listed, new AbortController().signal)).toEqual(
    [],
  );
  expect(requests).toEqual([{ path: "/api/v2/targets/default", ids: listed }]);
  // Each key holds exactly what that title's own read returns.
  for (const mediaId of listed)
    expect(queryClient.getQueryData(["target", mediaId])).toEqual(
      await readTarget(mediaId),
    );
});

test("a longer list reads fifty titles per request", async () => {
  const requests = serve();
  const listed = ids(120);
  await readListedTargets(listed, new AbortController().signal);
  expect(requests.map((request) => request.ids)).toEqual([
    listed.slice(0, 50),
    listed.slice(50, 100),
    listed.slice(100),
  ]);
  expect(seeded(listed)).toEqual(listed);
});

test("a title the actor has no view of is reported and its key left alone", async () => {
  const [visible = "", hidden = ""] = ids(2);
  serve({ forbidden: [hidden] });
  expect(
    await readListedTargets([visible, hidden], new AbortController().signal),
  ).toEqual([{ status: "unavailable", mediaId: hidden, code: "forbidden" }]);
  expect(seeded([visible, hidden])).toEqual([visible]);
});

test("a response that does not match the titles asked for is refused", async () => {
  const listed = ids(3);
  serve({ order: (asked) => asked.toReversed() });
  await expect(
    readListedTargets(listed, new AbortController().signal),
  ).rejects.toThrow("Batch response does not match the requested titles");
  expect(seeded(listed)).toEqual([]);
});

test("a superseded read writes nothing", async () => {
  const listed = ids(3);
  const superseded = new AbortController();
  serve({
    before: () => {
      superseded.abort();
    },
  });
  await expect(readListedTargets(listed, superseded.signal)).rejects.toThrow();
  expect(seeded(listed)).toEqual([]);
});

test("a read that began in a retired session writes nothing", async () => {
  const listed = ids(3);
  serve({
    before: () => {
      sessionBoundary.publish(
        member,
        sessionBoundary.capture().generation,
        "login",
      );
    },
  });
  await expect(
    readListedTargets(listed, new AbortController().signal),
  ).rejects.toThrow(SessionChangedError);
  expect(seeded(listed)).toEqual([]);
});

test("rows in a list render from its read, with the single read's failure for a title without a view", () => {
  const [visible = "", hidden = ""] = ids(2);
  queryClient.setQueryData(["target", visible], view(visible));
  queryClient.setQueryData(listedTargetsKey([visible, hidden]), [
    { status: "unavailable", mediaId: hidden, code: "forbidden" },
  ]);
  const html = renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>
      <ListedTargets mediaIds={[visible, hidden]}>
        <ListedMediaAction user={member} mediaId={visible} action="keep" />
        <ListedMediaAction user={member} mediaId={hidden} action="keep" />
      </ListedTargets>
    </QueryClientProvider>,
  );
  expect(html.match(/Keep for 30 days/gu)).toHaveLength(1);
  expect(html).toContain("No authorized command context for this target");
  expect(html).not.toContain("Loading controls");
});
