import { expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MovieFulfillment } from "./fulfillment.tsx";

it("does not label missing choice as selected unmarked or theatrical despite another playable copy", () => {
  const html = renderToStaticMarkup(
    <MovieFulfillment
      requests={[
        {
          requestId: "pending-request",
          edition: "default",
          fulfillment: {
            status: "pending_choice",
            reason: "movie_edition_choice_required",
          },
        },
      ]}
    />,
  );
  expect(html).toContain("Edition not selected");
  expect(html).toContain("Your request remains protected");
  expect(html).not.toContain("Selected edition fulfilled");
  expect(html).not.toContain("Unmarked release");
  expect(html).not.toContain("Theatrical cut");
});

it("keeps named pending and exact fulfilled requests distinct", () => {
  const html = renderToStaticMarkup(
    <MovieFulfillment
      requests={[
        {
          requestId: "named-request",
          edition: "theatrical_cut",
          fulfillment: {
            status: "pending_edition",
            reason: "edition_acquisition_not_ready",
          },
        },
        {
          requestId: "chosen-request",
          edition: "default",
          fulfillment: { status: "fulfilled", reason: null },
        },
      ]}
    />,
  );
  expect(html).toContain("Theatrical cut");
  expect(html).toContain("Named-edition downloads are not available yet");
  expect(html).toContain("Unmarked release — no named cut asserted");
  expect(html).toContain("Selected edition fulfilled");
});
