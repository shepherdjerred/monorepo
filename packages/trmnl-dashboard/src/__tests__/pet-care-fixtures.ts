import type { PetCarePayload } from "../types.ts";

export function healthyPetPayload(): PetCarePayload {
  return {
    screen: "pets",
    generated_at: "2026-08-30T08:30:00.000Z",
    generated_time: "1:30 AM",
    status: "ok",
    summary: "Pet systems healthy",
    problems: [],
    fountain: {
      status: "ok",
      water_percent: 100,
      water_ounces: 90,
      cleaning_days: 12,
      filter_days: 12,
      dispensing: true,
      dispensing_mode: "Flowing Water (Constant)",
      wifi: true,
      drinking_ounces_today: 4,
      drinking_visits_today: 9,
    },
    feeders: [],
    litter_robot: null,
    vacuums: [],
    activity: {
      drinking_ounces: 4,
      drinking_visits: 9,
      feedings: 2,
      food_grams: 20,
      litter_cycles: 1,
    },
    errors: [],
  };
}
