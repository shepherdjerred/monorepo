import { expect, vi } from "vitest";
import { MediaError, requireOwner } from "#application/errors.ts";
import { createMediaApp, type MediaAppDependencies } from "./app.ts";

/** Exercise these routes through the unchanged session/origin/CSRF middleware. */
export async function verifyExternalLibraryHttp(
  dependencies: MediaAppDependencies,
  headers: Record<string, string>,
) {
  const session = await dependencies.auth.authenticate("session-token");
  const authenticate = dependencies.auth.authenticate;
  dependencies.auth.authenticate = () =>
    Promise.resolve({ ...session, actor: { ...session.actor, role: "owner" } });
  const preview = vi.fn(() => {
    throw new MediaError(
      "external_library_catalog_required",
      "Adopt the canonical catalog first",
      409,
    );
  });
  dependencies.externalLibrary = {
    registration: {
      items: (actor, sectionType) => {
        requireOwner(actor);
        return Promise.resolve({
          sectionId: "1",
          sectionType,
          total: 0,
          nextOffset: null,
          items: [],
        });
      },
      preview,
      apply: () => {
        throw new Error("Unexpected registration write");
      },
    },
    edition: () => {
      throw new Error("Unexpected edition command");
    },
  };
  const app = createMediaApp(dependencies);
  const list = await app.request(
    "/api/v1/admin/external-library/items?sectionType=movie&offset=0",
    { headers },
  );
  expect(list.status).toBe(200);
  const path = "/api/v1/admin/external-library/preview";
  const body = JSON.stringify({ sectionType: "movie", ratingKey: "100" });
  const requestHeaders = { ...headers, "Idempotency-Key": crypto.randomUUID() };
  const wrongCsrf = await app.request(path, {
    method: "POST",
    headers: { ...requestHeaders, "X-CSRF-Token": "wrong" },
    body,
  });
  expect(wrongCsrf.status).toBe(403);
  const wrongOrigin = await app.request(path, {
    method: "POST",
    headers: { ...requestHeaders, Origin: "https://foreign.fixture" },
    body,
  });
  expect(wrongOrigin.status).toBe(403);
  expect(preview).not.toHaveBeenCalled();
  const accepted = await app.request(path, {
    method: "POST",
    headers: requestHeaders,
    body,
  });
  expect(accepted.status).toBe(409);
  expect(preview).toHaveBeenCalledOnce();
  dependencies.auth.authenticate = authenticate;
  const unauthenticated = await app.request(
    "/api/v1/admin/external-library/items?sectionType=movie",
    { headers: { ...headers, Cookie: "" } },
  );
  expect(unauthenticated.status).toBe(401);
}
