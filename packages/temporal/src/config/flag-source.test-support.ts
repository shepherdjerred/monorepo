import { afterEach, beforeEach, vi } from "vitest";
import {
  createFlagConfigSource,
  type FlagConfigSource,
} from "@shepherdjerred/feature-flags/config-source.ts";

/**
 * The mocked Flipt source the config readers resolve through. Each test file
 * still declares `vi.mock("@shepherdjerred/feature-flags/config-source.ts")`
 * itself, because Vitest hoists that call per file; this installs the shared
 * lifecycle on top of it and hands back the mocks to assert against.
 */
export function useMockedFlagSource(namespace = "prod") {
  const source = {
    create: vi.mocked(createFlagConfigSource),
    get: vi.fn<FlagConfigSource["get"]>(),
  };
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv("TEMPORAL_NAMESPACE", namespace);
    source.get.mockResolvedValue(undefined);
    source.create.mockImplementation(() => ({
      name: "flag",
      get: source.get,
    }));
  });
  afterEach(() => vi.unstubAllEnvs());
  return source;
}
