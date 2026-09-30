import { describe, expect, test } from "vitest";
import {
  resolveServiceSelector,
  servicesForPackages,
  SERVICES,
} from "#lib/deployed/catalog.ts";

/**
 * Every selector the hand-maintained registry accepted before it was derived
 * from the ops-model catalog, with the version keys it resolved to. Resolution
 * must stay identical.
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
  "obsidian-headless": ["shepherdjerred/obsidian-headless"],
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

  test("keeps the same deployable version keys and Argo apps", () => {
    expect(
      SERVICES.flatMap((service) =>
        service.variants.map(
          (variant) =>
            `${service.package} ${variant.name} ${variant.versionKey} ${variant.argoApp}`,
        ),
      ).toSorted(),
    ).toEqual(
      [
        "birmel default shepherdjerred/birmel birmel",
        "discord-plays-mario-kart default shepherdjerred/discord-plays-mario-kart mario-kart",
        "discord-plays-pokemon default shepherdjerred/discord-plays-pokemon pokemon",
        "homelab default shepherdjerred/caddy-s3proxy s3-static-sites",
        "homelab default shepherdjerred/obsidian-headless apps",
        "scout-for-lol beta shepherdjerred/scout-for-lol/beta scout-beta",
        "scout-for-lol prod shepherdjerred/scout-for-lol/prod scout-prod",
        "starlight-karma-bot beta shepherdjerred/starlight-karma-bot/beta starlight-karma-bot-beta",
        "starlight-karma-bot prod shepherdjerred/starlight-karma-bot/prod starlight-karma-bot-prod",
        "streambot default shepherdjerred/streambot media",
        "tasknotes-server default shepherdjerred/tasknotes-server tasknotes",
        "temporal default shepherdjerred/temporal-worker temporal",
        "trmnl-dashboard default shepherdjerred/trmnl-dashboard trmnl-dashboard",
      ].toSorted(),
    );
  });

  test("variant and hyphenated selectors still work", () => {
    expect(resolveServiceSelector("scout/prod")?.variant?.argoApp).toBe(
      "scout-prod",
    );
    expect(resolveServiceSelector("karma:beta")?.variant?.name).toBe("beta");
    expect(
      resolveServiceSelector("starlight-karma-bot-beta")?.variant?.versionKey,
    ).toBe("shepherdjerred/starlight-karma-bot/beta");
    expect(resolveServiceSelector("scout/nope")).toBeNull();
    expect(resolveServiceSelector("not-a-service")).toBeNull();
    // A catalog service with no deploy variants is not deployable here.
    expect(resolveServiceSelector("alert-dashboard")).toBeNull();
  });

  test("changed packages map to their services", () => {
    expect(
      servicesForPackages(["homelab", "temporal"]).map((s) => s.package),
    ).toEqual(["homelab", "temporal", "homelab"]);
  });
});
