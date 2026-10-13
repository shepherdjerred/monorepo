import { beforeEach, describe, expect, test, vi } from "vitest";
import type {
  FlagConfigSource,
  FlagSourceOptions,
} from "@shepherdjerred/feature-flags/config-source.ts";

// The archive's flag source, replaced so each case answers the flag itself.
const source = vi.hoisted(() => ({
  get: vi.fn<FlagConfigSource["get"]>(),
  create: vi.fn<(options: FlagSourceOptions) => FlagConfigSource>(),
}));
vi.mock("@shepherdjerred/feature-flags/config-source.ts", () => ({
  createFlagConfigSource: source.create,
}));
const flag = source.get;
const createSource = source.create;
import { rwfRecordingArchiveConfig } from "./rwf-recording-archive.ts";

beforeEach(() => {
  vi.resetAllMocks();
  flag.mockResolvedValue(undefined);
  createSource.mockImplementation(() => ({ name: "flag", get: flag }));
});

describe("Red Warfare recording archive configuration", () => {
  test("an absent flag keeps archiving off", async () => {
    expect(await rwfRecordingArchiveConfig()).toEqual({
      enabled: false,
      provenance: { enabled: "default" },
    });
    expect(createSource).toHaveBeenCalledExactlyOnceWith({
      targetingKey: "the-storm-rwf-recording-archive-prod",
      attributes: { environment: "prod" },
      kinds: { enabled: "boolean" },
      requireFreshSnapshot: true,
      onUnavailable: expect.any(Function),
    });
    expect(flag.mock.calls.map(([names]) => names.flag)).toEqual([
      "the-storm-rwf-recording-archive-enabled",
    ]);
  });

  test("an explicit false is authoritative", async () => {
    flag.mockResolvedValue({ value: false });
    expect(await rwfRecordingArchiveConfig()).toEqual({
      enabled: false,
      provenance: { enabled: "flag" },
    });
  });

  test("an explicit true enables archiving", async () => {
    flag.mockResolvedValue({ value: true });
    expect(await rwfRecordingArchiveConfig()).toEqual({
      enabled: true,
      provenance: { enabled: "flag" },
    });
  });

  test.each([1, "true", null])(
    "a present invalid value %s fails rather than defaulting",
    async (value) => {
      flag.mockResolvedValue({ value });
      await expect(rwfRecordingArchiveConfig()).rejects.toThrow();
    },
  );

  test("an unavailable provider keeps archiving off despite a true flag", async () => {
    flag.mockImplementation((names) => {
      const options = createSource.mock.calls[0]?.[0];
      if (options?.onUnavailable === undefined)
        throw new Error("The archive must observe unavailable evaluations");
      options.onUnavailable(names.flag);
      return Promise.resolve({ value: true });
    });
    const config = await rwfRecordingArchiveConfig();
    expect(config.enabled).toBe(false);
  });

  test("a source error keeps archiving off", async () => {
    flag.mockRejectedValue(new Error("source unavailable"));
    expect(await rwfRecordingArchiveConfig()).toEqual({
      enabled: false,
      provenance: { enabled: "default" },
    });
  });
});
