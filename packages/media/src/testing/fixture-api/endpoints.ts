/**
 * The one table of fixture endpoints. The router serves exactly these routes
 * and the schema test parses every sample with the same `schema`, which is
 * the schema the browser client passes to `readApi` for that call.
 */
import type { FixtureEndpoint } from "./endpoint.ts";
import { HOUSEHOLD_ENDPOINTS } from "./endpoints/household.ts";
import { MEDIA_ENDPOINTS } from "./endpoints/media.ts";
import { OWNER_ENDPOINTS } from "./endpoints/owner.ts";

export const FIXTURE_ENDPOINTS: readonly FixtureEndpoint[] = [
  ...HOUSEHOLD_ENDPOINTS,
  ...MEDIA_ENDPOINTS,
  ...OWNER_ENDPOINTS,
];
