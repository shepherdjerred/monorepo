import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToString } from "react-dom/server";
import {
  createMemoryRouter,
  matchRoutes,
  Outlet,
  RouterProvider,
} from "react-router";
import { expect, test } from "vitest";
import { UserSchema } from "#shared/contract.ts";
import { routes } from "./routes.tsx";
import { Shell } from "./shell.tsx";

const owner = UserSchema.parse({
  id: "00000000-0000-4000-8000-000000000002",
  plexAccountId: "synthetic-owner",
  displayName: "Synthetic Owner",
  role: "owner",
  restricted: false,
  version: 1,
});
const member = UserSchema.parse({
  ...owner,
  id: "00000000-0000-4000-8000-000000000003",
  plexAccountId: "synthetic-member",
  displayName: "Synthetic Member",
  role: "member",
});

/** The route path of each match from the shell down, joined as written. */
function matched(address: string) {
  const matches = matchRoutes(routes, address);
  if (matches === null) throw new Error(`No route matches ${address}`);
  return matches
    .map((match) => match.route.path)
    .filter((path) => path !== undefined && path !== "/")
    .join("/");
}

test.each([
  // Addresses the server writes into emails, Discord messages, and OAuth
  // returns. Each must still resolve to its own page.
  ["/media/abc", "media/:id"],
  ["/catalog/movie/603", "catalog/:kind/:id"],
  ["/library", "library"],
  ["/library/mine?interest=abc", "library/mine"],
  ["/library/leaving", "library/leaving"],
  ["/library/removed", "library/removed"],
  ["/library/no-such-view", "library/*"],
  ["/recovery", "recovery"],
  ["/recovery/00000000-0000-4000-8000-000000000001", "recovery/:id"],
  ["/recovery/movies/abc", "recovery/movies/:id"],
  ["/notifications", "notifications"],
  ["/notifications/email#verify=token", "notifications/email"],
  ["/notifications/discord?code=abc&state=def", "notifications/discord"],
  // Manage.
  ["/manage/household", "manage/household"],
  ["/manage/subtitles/replacements", "manage/subtitles/replacements/:id?"],
  ["/manage/subtitles/replacements/abc", "manage/subtitles/replacements/:id?"],
  ["/manage/recovery", "manage/recovery"],
  ["/manage/recovery/native/archives", "manage/recovery/native/:id?"],
  // Moved addresses match their redirect, not a page that happens to fit:
  // `/recovery/native` must not be read as the review named "native".
  ["/admin", "admin"],
  ["/admin/migration", "admin/migration"],
  ["/admin/subtitle-replacements/abc", "admin/subtitle-replacements/:id?"],
  ["/recovery/native", "recovery/native/:id?"],
  ["/recovery/native/abc", "recovery/native/:id?"],
  ["/activity", "activity"],
  // The pages the Library's segments replaced. Reminder emails carry
  // `/requests?interest=<id>`.
  ["/requests?interest=abc", "requests"],
  ["/removals", "removals"],
  ["/removed", "removed"],
  ["/no-such-page", "*"],
  ["/manage/no-such-page", "manage/*"],
])("%s is routed to %s", (address, path) => {
  expect(matched(address)).toBe(path);
});

function renderShell(user: typeof owner, address: string) {
  const router = createMemoryRouter(
    [
      {
        element: <Shell user={user} />,
        children: [{ path: "*", element: <Outlet /> }],
      },
    ],
    { initialEntries: [address] },
  );
  try {
    return renderToString(
      <QueryClientProvider client={new QueryClient()}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );
  } finally {
    router.dispose();
  }
}

test("only the owner is offered Manage", () => {
  expect(renderShell(owner, "/library")).toContain('href="/manage"');
  expect(renderShell(member, "/library")).not.toContain('href="/manage"');
});

test("the current page is marked in the sidebar and the tab bar, and nowhere else", () => {
  const html = renderShell(member, "/library");
  const current = [
    ...html.matchAll(/<a aria-current="page"[^>]*href="([^"]+)"/gu),
  ];
  expect(current.map((match) => match[1])).toEqual(["/library", "/library"]);
});

/** Where the sidebar and the tab bar lead, each address once. */
function links(html: string) {
  return [
    ...new Set(
      [
        ...html.matchAll(
          /<a [^>]*class="[^"]*(?:navItem|tab)[^"]*"[^>]*href="([^"]+)"/gu,
        ),
      ].map((match) => match[1]),
    ),
  ];
}

test("navigation is Discover, Library, Calendar and History, with Manage for the owner", () => {
  expect(links(renderShell(member, "/library"))).toEqual([
    "/discover",
    "/library",
    "/calendar",
    "/history",
  ]);
  expect(links(renderShell(owner, "/library"))).toEqual([
    "/discover",
    "/library",
    "/calendar",
    "/history",
    "/manage",
  ]);
});

test("a segment of the Library keeps Library marked", () => {
  const html = renderShell(member, "/library/leaving");
  const current = [
    ...html.matchAll(/<a aria-current="page"[^>]*href="([^"]+)"/gu),
  ];
  expect(current.map((match) => match[1])).toEqual(["/library", "/library"]);
});

test("recovery reviews are in the account panel for members too, not in navigation", () => {
  const html = renderShell(member, "/library");
  expect(html).toContain("Recovery reviews");
  expect(html).toContain("Library member");
  expect(html).not.toContain("Recovery review<");
});

test("a restricted account is told that requests are paused", () => {
  expect(renderShell({ ...member, restricted: true }, "/library")).toContain(
    "New requests are paused for your account.",
  );
  expect(renderShell(member, "/library")).not.toContain(
    "New requests are paused",
  );
});
