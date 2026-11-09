import { afterEach, beforeEach, expect, test, vi } from "vitest";
import {
  createFlagConfigSource,
  type FlagConfigSource,
} from "@shepherdjerred/feature-flags/config-source.ts";

vi.mock("@shepherdjerred/feature-flags/config-source.ts", () => ({
  createFlagConfigSource: vi.fn(),
}));
import { ciExtendedVerifyEnabled } from "./ci-extended-verify.ts";

const source = {
  create: vi.mocked(createFlagConfigSource),
  get: vi.fn<FlagConfigSource["get"]>(),
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("TEMPORAL_NAMESPACE", "prod");
  source.get.mockResolvedValue(undefined);
  source.create.mockImplementation(() => ({ name: "flag", get: source.get }));
});
afterEach(() => vi.unstubAllEnvs());

test.each([false, true])(
  "the deployed production worker honors nightly dispatch %s",
  async (enabled) => {
    source.get.mockResolvedValue({ value: enabled });
    expect(await ciExtendedVerifyEnabled()).toBe(enabled);
    expect(source.create).toHaveBeenCalledExactlyOnceWith({
      targetingKey: "ci-extended-verify-prod",
      attributes: { environment: "prod", stage: "prod" },
      kinds: { enabled: "boolean" },
      requireFreshSnapshot: true,
    });
    expect(source.get.mock.calls[0]?.[0].flag).toBe(
      "ci-extended-verify-dispatch-enabled",
    );
  },
);

test("absent and unavailable flags keep nightly dispatch disabled", async () => {
  expect(await ciExtendedVerifyEnabled()).toBe(false);
  source.get.mockRejectedValue(new Error("source unavailable"));
  expect(await ciExtendedVerifyEnabled()).toBe(false);
});

test.each([0, "true", null])("invalid flag %s fails visibly", async (value) => {
  source.get.mockResolvedValue({ value });
  await expect(ciExtendedVerifyEnabled()).rejects.toThrow();
});
