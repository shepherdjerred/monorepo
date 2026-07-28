import { z } from "zod";

const OpenMeteoResponse = z.object({
  current: z.object({
    temperature_2m: z.number(),
  }),
});

export type WeatherActivities = typeof weatherActivities;

export const weatherActivities = {
  // Open-Meteo: free, no API key, ~10k calls/day non-commercial. We call it a
  // handful of times per day (good-morning floor-heat decision).
  async getOutdoorTemperatureC(
    latitude: number,
    longitude: number,
  ): Promise<number> {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${String(latitude)}&longitude=${String(longitude)}&current=temperature_2m`;
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(
        `Open-Meteo request failed: ${String(response.status)} ${response.statusText}`,
      );
    }
    const body = OpenMeteoResponse.parse(await response.json());
    return body.current.temperature_2m;
  },
};
