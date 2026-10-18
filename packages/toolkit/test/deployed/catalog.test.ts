import { describe, expect, test } from "vitest";
import {
  resolveServiceSelector,
  servicesForPackages,
  SERVICES,
} from "#lib/deployed/catalog.ts";

/**
 * Standalone selectors retained from the hand-maintained registry, with their
 * version keys. The retired Obsidian standalone mapping is checked separately
 * below because its container is now owned by TaskNotes.
 */
const LEGACY_SELECTORS: Record<string, readonly string[]> = {
  birmel: ["shepherdjerred/birmel"],
  "tasknotes-server": ["shepherdjerred/tasknotes-server"],
  tasknotes: ["shepherdjerred/tasknotes-server"],
  "scout-for-lol": [
    "shepherdjerred/scout-for-lol/beta",
    "shepherdjerred/scout-for-lol/prod",
  ],
  scout: [
    "shepherdjerred/scout-for-lol/beta",
    "shepherdjerred/scout-for-lol/prod",
  ],
  "discord-plays-pokemon": ["shepherdjerred/discord-plays-pokemon"],
  pokemon: ["shepherdjerred/discord-plays-pokemon"],
  "discord-plays-mario-kart": ["shepherdjerred/discord-plays-mario-kart"],
  "mario-kart": ["shepherdjerred/discord-plays-mario-kart"],
  "starlight-karma-bot": [
    "shepherdjerred/starlight-karma-bot/beta",
    "shepherdjerred/starlight-karma-bot/prod",
  ],
  karma: [
    "shepherdjerred/starlight-karma-bot/beta",
    "shepherdjerred/starlight-karma-bot/prod",
  ],
  starlight: [
    "shepherdjerred/starlight-karma-bot/beta",
    "shepherdjerred/starlight-karma-bot/prod",
  ],
  streambot: ["shepherdjerred/streambot"],
  "temporal-worker": ["shepherdjerred/temporal-worker"],
  temporal: ["shepherdjerred/temporal-worker"],
  worker: ["shepherdjerred/temporal-worker"],
  "trmnl-dashboard": ["shepherdjerred/trmnl-dashboard"],
  trmnl: ["shepherdjerred/trmnl-dashboard"],
  "caddy-s3proxy": ["shepherdjerred/caddy-s3proxy"],
  // Package-name fallback: the first homelab service.
  homelab: ["shepherdjerred/caddy-s3proxy"],
};

function versionKeys(selector: string): string[] | null {
  const selection = resolveServiceSelector(selector);
  if (selection === null) {
    return null;
  }
  return selection.variant === null
    ? selection.service.variants.map((variant) => variant.versionKey)
    : [selection.variant.versionKey];
}

describe("deployed registry derived from the service catalog", () => {
  test.each(Object.entries(LEGACY_SELECTORS))(
    "%s resolves as before",
    (selector, expected) => {
      expect(versionKeys(selector)).toEqual(expected);
      expect(versionKeys(selector.toUpperCase())).toEqual(expected);
    },
  );

  test("resolves the deployable inventory to its version keys and Argo apps", () => {
    expect(
      SERVICES.flatMap((service) =>
        service.variants.map(
          (variant) =>
            `${service.package} ${variant.name} ${variant.versionKey} ${variant.argoApp}`,
        ),
      ).toSorted(),
    ).toEqual(
      [
        "alert-dashboard default shepherdjerred/alert-dashboard alert-dashboard",
        "arcade default shepherdjerred/arcade arcade",
        "birmel default shepherdjerred/birmel birmel",
        "discord-plays-mario-kart default shepherdjerred/discord-plays-mario-kart mario-kart",
        "discord-plays-pokemon default shepherdjerred/discord-plays-pokemon pokemon",
        "homelab default shepherdjerred/caddy-s3proxy s3-static-sites",
        "homelab redlib shepherdjerred/redlib redlib",
        "scout-for-lol beta shepherdjerred/scout-for-lol/beta scout-beta",
        "scout-for-lol prod shepherdjerred/scout-for-lol/prod scout-prod",
        "starlight-karma-bot beta shepherdjerred/starlight-karma-bot/beta starlight-karma-bot-beta",
        "starlight-karma-bot prod shepherdjerred/starlight-karma-bot/prod starlight-karma-bot-prod",
        "storm-brain default shepherdjerred/storm-brain storm-brain",
        "streambot default shepherdjerred/streambot media",
        "tasknotes-server default shepherdjerred/tasknotes-server tasknotes",
        "the-storm tsmc shepherdjerred/the-storm-server minecraft-tsmc",
        "temporal default shepherdjerred/temporal-worker temporal",
        "tracker default shepherdjerred/tracker tracker",
        "trmnl-dashboard default shepherdjerred/trmnl-dashboard trmnl-dashboard",
      ].toSorted(),
    );
  });

  test("variant and hyphenated selectors still work", () => {
    expect(resolveServiceSelector("scout/prod")?.variant?.argoApp).toBe(
      "scout-prod",
    );
    expect(resolveServiceSelector("karma:beta")?.variant?.name).toBe("beta");
    expect(versionKeys("tracker/default")).toEqual(["shepherdjerred/tracker"]);
    expect(
      resolveServiceSelector("starlight-karma-bot-beta")?.variant?.versionKey,
    ).toBe("shepherdjerred/starlight-karma-bot/beta");
    expect(resolveServiceSelector("scout/nope")).toBeNull();
    expect(resolveServiceSelector("not-a-service")).toBeNull();
    expect(resolveServiceSelector("alert-dashboard")?.variant).toBeNull();
    expect(resolveServiceSelector("alert-dashboard")?.service.alias).toBe(
      "ops-dashboard",
    );
    // The Obsidian container is a TaskNotes sidecar, not a standalone apps workload.
    expect(resolveServiceSelector("obsidian-headless")).toBeNull();
  });

  test("changed packages map to their services", () => {
    expect(
      servicesForPackages(["homelab", "temporal"]).map((s) => s.package),
    ).toEqual(["homelab", "temporal", "homelab"]);
    expect(servicesForPackages(["tracker"]).map((s) => s.alias)).toEqual([
      "tracker",
    ]);
    const minecraft = resolveServiceSelector("minecraft/tsmc");
    expect(minecraft?.service.package).toBe("the-storm");
    expect(minecraft?.variant).toEqual({
      name: "tsmc",
      versionKey: "shepherdjerred/the-storm-server",
      argoApp: "minecraft-tsmc",
    });
    expect(servicesForPackages(["the-storm"])).toEqual([minecraft?.service]);
    expect(
      servicesForPackages(["homelab"])
        .flatMap((service) => service.variants)
        .find((variant) => variant.name === "redlib"),
    ).toEqual({
      name: "redlib",
      versionKey: "shepherdjerred/redlib",
      argoApp: "redlib",
    });
  });
});
