import { afterEach, beforeEach, expect, test, vi } from "vitest";
import {
  createFlagConfigSource,
  type FlagConfigSource,
} from "@shepherdjerred/feature-flags/config-source.ts";
vi.mock("@shepherdjerred/feature-flags/config-source.ts", () => ({
  createFlagConfigSource: vi.fn(),
}));
import { mediaSafetyEnabled } from "./media-safety.ts";

const get = vi.fn<FlagConfigSource["get"]>();
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("TEMPORAL_NAMESPACE", "prod");
  vi.mocked(createFlagConfigSource).mockReturnValue({ name: "flag", get });
  get.mockResolvedValue(undefined);
});
afterEach(() => vi.unstubAllEnvs());
test.each([false, true])(
  "honors explicit %s with namespace targeting",
  async (value) => {
    get.mockResolvedValue({ value });
    expect(await mediaSafetyEnabled()).toBe(value);
    expect(createFlagConfigSource).toHaveBeenCalledWith({
      targetingKey: "media-download-safety",
      attributes: { environment: "prod" },
      kinds: { enabled: "boolean" },
      requireFreshSnapshot: true,
    });
  },
);
test("absence and transport failure leave enforcement disabled", async () => {
  expect(await mediaSafetyEnabled()).toBe(false);
  get.mockRejectedValue(new Error("unavailable"));
  expect(await mediaSafetyEnabled()).toBe(false);
});
test.each(["true", 0, null])(
  "invalid successful flag %j throws",
  async (value) => {
    get.mockResolvedValue({ value });
    await expect(mediaSafetyEnabled()).rejects.toThrow();
  },
);
