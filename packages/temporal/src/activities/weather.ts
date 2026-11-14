import { ApplicationFailure } from "@temporalio/activity";
import { z } from "zod";
import { OUTDOOR_WEATHER_UNAVAILABLE_ERROR_TYPE } from "#shared/infra/ha-errors.ts";

const OpenMeteoResponse = z.object({
  current: z.object({
    temperature_2m: z.number(),
  }),
});

// Shorter than the workflow's 30s startToClose so a hung upstream connection
// surfaces as a typed, retryable failure instead of an activity timeout.
export const OPEN_METEO_REQUEST_TIMEOUT_MS = 10_000;

function weatherUnavailable(
  message: string,
  cause?: Error,
): ApplicationFailure {
  return ApplicationFailure.create({
    message,
    type: OUTDOOR_WEATHER_UNAVAILABLE_ERROR_TYPE,
    nonRetryable: false,
    ...(cause === undefined ? {} : { cause }),
  });
}

export type WeatherActivities = typeof weatherActivities;

export const weatherActivities = {
  // Open-Meteo: free, no API key, ~10k calls/day non-commercial. We call it a
  // handful of times per day (good-morning floor-heat decision).
  async getOutdoorTemperatureC(
    latitude: number,
    longitude: number,
  ): Promise<number> {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${String(latitude)}&longitude=${String(longitude)}&current=temperature_2m`;
    let json: unknown;
    try {
      // The signal also bounds the body read.
      const response = await fetch(url, {
        signal: AbortSignal.timeout(OPEN_METEO_REQUEST_TIMEOUT_MS),
      });
      if (!response.ok) {
        throw weatherUnavailable(
          `Open-Meteo request failed: ${String(response.status)} ${response.statusText}`,
        );
      }
      json = await response.json();
    } catch (error: unknown) {
      // A 2xx body that is not JSON is a contract violation, not an outage.
      if (error instanceof ApplicationFailure || error instanceof SyntaxError) {
        throw error;
      }
      throw weatherUnavailable(
        `Open-Meteo request failed: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error : undefined,
      );
    }
    const body = OpenMeteoResponse.parse(json);
    return body.current.temperature_2m;
  },
};
