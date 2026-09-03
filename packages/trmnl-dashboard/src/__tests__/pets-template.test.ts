import { describe, expect, it } from "vitest";
import { Liquid } from "liquidjs";
import type { PetCarePayload, PetProblem } from "../types.ts";

const templateDirectory = new URL("../../trmnl/pets/src/", import.meta.url)
  .pathname;
const liquid = new Liquid({ strictVariables: true, strictFilters: true });
const layouts = [
  "full",
  "half_horizontal",
  "half_vertical",
  "quadrant",
] as const;
const statuses = ["ok", "warning", "error"] as const;

describe("Pets TRMNL layouts", () => {
  it.each(
    statuses.flatMap((status) => layouts.map((layout) => ({ layout, status }))),
  )("renders $layout with a $status payload", async ({ layout, status }) => {
    const shared = await Bun.file(`${templateDirectory}shared.liquid`).text();
    const template = await Bun.file(
      `${templateDirectory}${layout}.liquid`,
    ).text();
    const payload = fixture(status);
    const html = await liquid.parseAndRender(`${shared}\n${template}`, payload);

    expect(html).toContain("Pet Care");
    expect(html).toContain(status.toUpperCase());

    switch (layout) {
      case "full": {
        expect(html).toContain("Globe litter");
        expect(html).toContain("Hopper");
        expect(html).toContain("Roborock Fleet");
        expect(html).toContain("Litter cycles");
        break;
      }
      case "half_horizontal": {
        expect(html).toContain("Pet devices");
        expect(html).toContain("Vacuum fleet");
        expect(html).toContain("Litter cycles");
        break;
      }
      case "half_vertical": {
        expect(html).toContain("Fountain water");
        expect(html).toContain("Litter / waste");
        expect(html).toContain("Vacuum fleet");
        break;
      }
      case "quadrant": {
        expect(html).toContain("Highest priority");
        expect(html).toContain("Water");
        expect(html).toContain("Litter");
        break;
      }
    }

    if (payload.status !== "ok") {
      expect(html).toContain(payload.problems[0]?.summary);
    }
  });

  it("does not report all clear when diagnostics are incomplete", async () => {
    const shared = await Bun.file(`${templateDirectory}shared.liquid`).text();
    const template = await Bun.file(
      `${templateDirectory}quadrant.liquid`,
    ).text();
    const payload = fixture("ok");
    payload.status = "unknown";
    payload.summary = "Pet diagnostics incomplete";
    payload.errors = ["Alertmanager alerts: request failed"];

    const html = await liquid.parseAndRender(`${shared}\n${template}`, payload);

    expect(html).toContain("UNKNOWN · diagnostics incomplete");
    expect(html).not.toContain("All clear");
  });
});

function fixture(status: "ok" | "warning" | "error"): PetCarePayload {
  const problem: PetProblem[] =
    status === "ok"
      ? []
      : [
          {
            severity: status === "error" ? "critical" : "warning",
            alert:
              status === "error"
                ? "LitterRobotWasteCritical"
                : "RoborockConsumableDue",
            summary:
              status === "error"
                ? "Storage LR5 waste drawer critical"
                : "2nd Floor dock strainer due",
          },
        ];
  return {
    screen: "pets",
    generated_at: "2026-08-30T08:30:00.000Z",
    generated_time: "1:30 AM",
    status,
    summary:
      problem.length === 0
        ? "Pet systems healthy"
        : "1 active pet-care problem",
    problems: problem,
    fountain: {
      status: "ok",
      water_percent: 82,
      water_ounces: 71,
      cleaning_days: 12,
      filter_days: 12,
      dispensing: true,
      dispensing_mode: "Flowing Water (Constant)",
      wifi: true,
      drinking_ounces_today: 4.1,
      drinking_visits_today: 9,
    },
    feeders: [
      feeder("living-room", "Living Room"),
      feeder("guest-room", "Guest Room"),
    ],
    litter_robot: {
      status: status === "error" ? "error" : "ok",
      name: "Storage",
      online: true,
      ready: true,
      litter_percent: 90.7,
      waste_percent: status === "error" ? 84 : 33,
      hopper_status: "Ready",
      hopper_level_raw: 1,
      hopper_installed: true,
      hopper_enabled: true,
      last_seen_at: "2026-08-30T08:21:53Z",
      filter_due_at: "2026-09-26T03:00:32Z",
      cycles_today: 2,
    },
    vacuums: [
      vacuum("1st-floor", "1st Floor", status === "warning" ? "warning" : "ok"),
      vacuum("2nd-floor", "2nd Floor", "ok"),
      vacuum("3rd-floor", "3rd Floor", "ok"),
    ],
    activity: {
      drinking_ounces: 4.1,
      drinking_visits: 9,
      feedings: 4,
      food_grams: 40,
      litter_cycles: 2,
    },
    errors: [],
  };
}

function feeder(
  id: "living-room" | "guest-room",
  label: string,
): PetCarePayload["feeders"][number] {
  return {
    id,
    label,
    status: "ok",
    food_low: false,
    dispenser_problem: false,
    battery_problem: false,
    wifi: true,
    desiccant_days: 9,
    last_feed_at: "2026-08-30T14:00:10Z",
    feedings_today: 2,
    food_grams_today: 20,
  };
}

function vacuum(
  id: "1st-floor" | "2nd-floor" | "3rd-floor",
  label: string,
  status: "ok" | "warning",
): PetCarePayload["vacuums"][number] {
  return {
    id,
    label,
    status,
    state: "docked",
    battery_percent: 100,
    last_clean_at: "2026-08-29T22:29:17Z",
    consumable_hours: 40,
    clean_water_empty: false,
    dirty_water_full: false,
    cleaning_fluid_low: false,
    water_shortage: false,
    dust_bag: null,
  };
}
