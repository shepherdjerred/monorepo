import { test } from "vitest";
import { fixture, headers } from "./http.test-support.ts";
import { verifyRevokedRetryHttp } from "./retry-http.test-support.ts";
import { verifyIdentityHttp } from "./media/identity-http.test-support.ts";
import { verifyVisibilityHttp } from "./media/visibility-http.test-support.ts";
import { verifyDefaultCommandsHttp } from "./media/edition-http.test-support.ts";
import { verifyDefaultReplayHttp } from "./media/edition-replay.test-support.ts";
import {
  verifyMovieProtectionLostAck,
  verifyMovieProtectionConflictReview,
} from "./media/movie-edition-retry.test-support.ts";
import {
  verifyMovieEditionHttp,
  verifyMovieProtectionHttp,
} from "./media/movie-edition-http.test-support.ts";

test("detail GET rechecks current role/library and does not leak raw observations or other household data", async () => {
  await verifyVisibilityHttp(fixture().dependencies, headers);
}, 60_000);

test("v2 commands use current scoped CAS and preserve revoked-access request controls", async () => {
  await verifyDefaultCommandsHttp(fixture().dependencies, headers);
});

test("v3 movie choices are explicit and named cancellation preserves immutable replay", async () => {
  await verifyMovieEditionHttp(fixture().dependencies, headers);
});

test("v3 named own-request protections survive library revocation without exposing movie details", async () => {
  await verifyMovieProtectionHttp(fixture().dependencies, headers);
});

test.each(["cancel_request", "revoke_choice"] as const)(
  "v3 protective %s retries the original committed command after a later re-request",
  async (action) => {
    await verifyMovieProtectionLostAck(fixture().dependencies, headers, action);
  },
);

test("v3 protective conflict requires explicit review before adopting current CAS", async () => {
  await verifyMovieProtectionConflictReview(fixture().dependencies, headers);
});

test("v2 HTTP replay precedes mutable gate/proxy refresh but fresh commands remain authorized", async () => {
  await verifyDefaultReplayHttp(fixture().dependencies, headers);
});

test("identity preview and selection use current scoped owner authority and strict input", async () => {
  await verifyIdentityHttp(fixture().dependencies, headers);
});

test("Retry reauthorizes current DB access after authentication while Keep remains protective", async () => {
  await verifyRevokedRetryHttp(fixture().dependencies, headers);
}, 60_000);
