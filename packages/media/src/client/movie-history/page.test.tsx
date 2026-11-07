import { expect, it } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router";
import { renderToStaticMarkup } from "react-dom/server";
import { MovieHistoryPageV3 } from "./page.tsx";
import { MovieHistoryIndexV3 } from "./index.tsx";
import { movieHistoryPersonalFixtureV3 } from "./test-support.ts";

it("renders a member's exact edition and declaration instructions without household or native proof fields", () => {
  const { user, review } = movieHistoryPersonalFixtureV3();
  const client = new QueryClient();
  client.setQueryData(["movie-history", "review", user.id, review.id], review);
  try {
    const html = renderToStaticMarkup(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[`/recovery/movies/${review.id}`]}>
          <Routes>
            <Route
              path="/recovery/movies/:id"
              element={<MovieHistoryPageV3 user={user} />}
            />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(html).toContain(review.title);
    expect(html).toContain("Director");
    expect(html).toContain("Your declaration");
    expect(html).toContain("cancel the actual request first");
    expect(html).toContain("1 selected imported request claim");
    expect(html).not.toContain("Release this edition");
    expect(html).not.toContain("Household declarations");
    for (const hidden of [
      review.scopeHash,
      review.definition.definitionDigest,
      review.subject.serverAccountId,
      "scopeHash",
      "bindingId",
      "sourcePath",
      "planRaw",
      "30 days",
    ]) {
      if (hidden !== null) expect(html).not.toContain(hidden);
    }
  } finally {
    client.clear();
  }
});

it("uses member-only discovery data and sends owners to an exact selected edition", () => {
  const { user, review } = movieHistoryPersonalFixtureV3();
  const client = new QueryClient();
  client.setQueryData(["movie-history", "pending", user.id, null, null], {
    reviews: [
      {
        id: review.id,
        version: review.version,
        scope: review.scope,
        definition: review.definition,
        title: review.title,
        expiresAt: review.expiresAt,
        responded: false,
      },
    ],
  });
  try {
    const member = renderToStaticMarkup(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <MovieHistoryIndexV3 user={user} />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(member).toContain(`/recovery/movies/${review.id}`);
    expect(member).toContain("Your declaration is needed");
    const owner = renderToStaticMarkup(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <MovieHistoryIndexV3 user={{ ...user, role: "owner" }} />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(owner).toContain("select its protected edition");
    expect(owner).not.toContain(`/recovery/movies/${review.id}`);
  } finally {
    client.clear();
  }
});
