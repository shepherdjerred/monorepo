import { afterEach, expect, test } from "vitest";
import { MeSchema } from "@shepherdjerred/streambot/web/shared/contracts.ts";
import { disablePreviewUsageAnalytics } from "./preview-room.ts";
import { webFixture } from "./web-fixture.ts";

let fixture: ReturnType<typeof webFixture> | undefined;
afterEach(() => {
  fixture?.close();
  fixture = undefined;
});

/**
 * The local preview and the fixture must never hand the browser an analytics id or an error DSN,
 * so a development page cannot reach the production PostHog or Bugsink projects.
 */
test("the preview's /api/me carries no analytics id and no Bugsink DSN", async () => {
  disablePreviewUsageAnalytics();
  const local = webFixture();
  fixture = local;
  const response = await local.handler(
    new Request("http://127.0.0.1:8080/api/me", {
      headers: { cookie: local.cookie },
    }),
  );
  const me = MeSchema.parse(await response.json());
  expect(me.analyticsId).toBeNull();
  expect(me.bugsinkDsn).toBeNull();
});
