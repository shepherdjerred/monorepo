import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { ApplicationFailure } from "@temporalio/activity";
import { OUTDOOR_WEATHER_UNAVAILABLE_ERROR_TYPE } from "#shared/infra/ha-errors.ts";
import { OPEN_METEO_REQUEST_TIMEOUT_MS, weatherActivities } from "./weather.ts";

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function failureOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("Expected the activity to fail");
}

function expectOutage(failure: unknown): void {
  if (!(failure instanceof ApplicationFailure)) {
    throw new TypeError("Expected an ApplicationFailure");
  }
  expect(failure.type).toBe(OUTDOOR_WEATHER_UNAVAILABLE_ERROR_TYPE);
  expect(failure.nonRetryable).toBe(false);
}

describe("getOutdoorTemperatureC", () => {
  test("returns the current temperature and bounds the request", async () => {
    fetchMock.mockResolvedValue(
      Response.json({ current: { temperature_2m: 7.5 } }),
    );
    await expect(weatherActivities.getOutdoorTemperatureC(1, 2)).resolves.toBe(
      7.5,
    );
    expect(OPEN_METEO_REQUEST_TIMEOUT_MS).toBeLessThan(30_000);
    expect(fetchMock.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal);
  });

  test("maps a request timeout to a retryable typed failure", async () => {
    fetchMock.mockRejectedValue(
      new DOMException("The operation timed out.", "TimeoutError"),
    );
    expectOutage(
      await failureOf(weatherActivities.getOutdoorTemperatureC(1, 2)),
    );
  });

  test("maps a network failure to a retryable typed failure", async () => {
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));
    expectOutage(
      await failureOf(weatherActivities.getOutdoorTemperatureC(1, 2)),
    );
  });

  test("maps a non-OK response to a retryable typed failure", async () => {
    fetchMock.mockResolvedValue(new Response("nope", { status: 503 }));
    expectOutage(
      await failureOf(weatherActivities.getOutdoorTemperatureC(1, 2)),
    );
  });

  test("keeps a malformed body loud and untyped", async () => {
    fetchMock.mockResolvedValue(Response.json({ current: {} }));
    const failure = await failureOf(
      weatherActivities.getOutdoorTemperatureC(1, 2),
    );
    expect(failure).toBeInstanceOf(Error);
    expect(failure).not.toBeInstanceOf(ApplicationFailure);
  });
});
