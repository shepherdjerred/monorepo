import { expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { ImportedPersonalClaimsSchema } from "#shared/personal-migration/contract.ts";
import { ImportedRequestSource } from "./source.tsx";

function fixture() {
  return ImportedPersonalClaimsSchema.element.parse({
    requestId: crypto.randomUUID(),
    mediaId: crypto.randomUUID(),
    userId: crypto.randomUUID(),
    edition: "default",
    captureId: crypto.randomUUID(),
    provenanceKey: "a".repeat(64),
    sourceId: "4",
    sourceStatus: 5,
    sourceKind: "seerr",
    sourceFulfilled: true,
    needsAcquisitionChoice: true,
  });
}
test("fulfilled imported requests explain source fulfillment separately from viewing and link actual requester choice", () => {
  const claim = fixture();
  const html = renderToStaticMarkup(
    <MemoryRouter>
      <ImportedRequestSource claim={claim} viewerUserId={claim.userId} />
    </MemoryRouter>,
  );
  expect(html).toContain("Fulfilled at import");
  expect(html).toContain("Your viewing progress is tracked separately");
  expect(html).toContain(`href="/media/${claim.mediaId}"`);
  expect(html).toContain("Choose a movie edition");
  expect(html).not.toContain("Watched");
});
test("a different account is told to await requester consent and cannot impersonate that choice", () => {
  const html = renderToStaticMarkup(
    <MemoryRouter>
      <ImportedRequestSource
        claim={fixture()}
        viewerUserId={crypto.randomUUID()}
      />
    </MemoryRouter>,
  );
  expect(html).toContain("Waiting for the requester");
  expect(html).not.toContain("href=");
});
