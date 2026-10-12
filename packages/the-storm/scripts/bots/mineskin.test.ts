import { afterEach, describe, expect, it, vi } from "vitest";
import { MineSkin } from "./mineskin.ts";

const job = (status: string, errors?: { code: string; message: string }[]) =>
  Response.json({ success: true, job: { id: "test-job", status }, errors });
const failure = (code: string) =>
  job("failed", [{ code, message: "test upstream failure" }]);
const signed = () =>
  Response.json({
    skin: {
      uuid: "test-skin",
      texture: {
        data: { value: "test-only-value", signature: "test-only-signature" },
        url: { skin: "/test-only-skin" },
      },
    },
  });
const client = () =>
  new MineSkin({ userAgent: "thestorm-unit-test", apiKey: undefined });

afterEach(() => vi.restoreAllMocks());

describe("MineSkin documented server failures", () => {
  it("honours the hourly Retry-After before submitting again", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1000);
    const sleep = vi.spyOn(Bun, "sleep").mockResolvedValue(undefined);
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        Response.json(
          {
            errors: [{ code: "rate_limit" }],
            rateLimit: { next: { relative: 6000 } },
          },
          { status: 429, headers: { "Retry-After": "3600" } },
        ),
      )
      .mockResolvedValueOnce(signed());
    await expect(
      client().generate(new Uint8Array([1]), "fixture"),
    ).resolves.toMatchObject({ signature: "test-only-signature" });
    expect(sleep).toHaveBeenCalledWith(3_600_000);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it.each([
    "invalid_skin_data",
    "skin_change_failed",
    "generator_timeout",
    "job_failed",
    "no_account_available",
    "internal_error",
    "unexpected_error",
  ])("resubmits %s with bounded backoff", async (code) => {
    const sleep = vi.spyOn(Bun, "sleep").mockResolvedValue(undefined);
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(job("waiting"))
      .mockResolvedValueOnce(failure(code))
      .mockResolvedValueOnce(signed());
    const result = await client().generate(new Uint8Array([1]), "fixture");
    expect(result.signature).toBe("test-only-signature");
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls.some(([delay]) => Number(delay) > 29_000)).toBe(
      true,
    );
  });

  it("fails closed after six unsuccessful jobs", async () => {
    vi.spyOn(Bun, "sleep").mockResolvedValue(undefined);
    const fetch = vi.spyOn(globalThis, "fetch");
    for (let attempt = 0; attempt < 6; attempt++) {
      fetch
        .mockResolvedValueOnce(job("waiting"))
        .mockResolvedValueOnce(failure("invalid_skin_data"));
    }
    await expect(
      client().generate(new Uint8Array([1]), "fixture"),
    ).rejects.toThrow("after 6 failed jobs");
    expect(fetch).toHaveBeenCalledTimes(12);
  });

  it("does not retry a bad image as an upstream download error", async () => {
    vi.spyOn(Bun, "sleep").mockResolvedValue(undefined);
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(job("waiting"))
      .mockResolvedValueOnce(failure("invalid_image"));
    await expect(
      client().generate(new Uint8Array([1]), "fixture"),
    ).rejects.toThrow("invalid_image");
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
