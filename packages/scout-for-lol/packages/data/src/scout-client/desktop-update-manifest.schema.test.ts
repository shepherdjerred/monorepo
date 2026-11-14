import { describe, expect, test } from "vitest";
import rawContract from "./desktop-update-manifest.contract.json" with { type: "json" };
import rawFixtures from "./desktop-update-manifest.fixtures.json" with { type: "json" };
import {
  SCOUT_DESKTOP_UPDATE_ORIGIN,
  ScoutDesktopUpdateChannelSchema,
  ScoutDesktopUpdateFormatSchema,
  ScoutDesktopUpdateManifestSchema,
  compareScoutDesktopVersions,
} from "./desktop-update-manifest.schema.ts";
import {
  assertNeverDowngrade,
  buildUpdateManifest,
  channelManifestKey,
  releaseObjectKey,
} from "./desktop-update-release.ts";

const [stable, beta] = rawFixtures.valid;
if (stable === undefined || beta === undefined) {
  throw new Error("the fixtures need a stable and a beta manifest");
}

describe("Scout desktop update manifest contract", () => {
  test("keeps the Zod schema aligned with the shared contract", () => {
    expect(SCOUT_DESKTOP_UPDATE_ORIGIN).toBe(rawContract.origin);
    expect(ScoutDesktopUpdateChannelSchema.options).toEqual(
      rawContract.channels,
    );
    expect(ScoutDesktopUpdateFormatSchema.options).toEqual(
      rawContract.platforms["windows-x86_64"].formats,
    );
    expect(Object.keys(rawContract.platforms)).toEqual(["windows-x86_64"]);
    expect(rawContract.manifestPath).toBe("/{channel}.json");
    expect(rawContract.releasePath).toBe("/releases/{version}/{file}");
    expect(channelManifestKey("stable")).toBe("stable.json");
    expect(releaseObjectKey("0.2.0", "a.exe")).toBe("releases/0.2.0/a.exe");
  });

  test.each(rawFixtures.valid)(
    "accepts the $channel $version fixture",
    (fixture) => {
      expect(ScoutDesktopUpdateManifestSchema.parse(fixture)).toEqual(fixture);
    },
  );

  test.each(rawFixtures.invalid)("rejects $reason", ({ body }) => {
    expect(ScoutDesktopUpdateManifestSchema.safeParse(body).success).toBe(
      false,
    );
  });

  test.each(rawFixtures.versionOrdering)(
    "orders $lower before $higher",
    ({ lower, higher }) => {
      expect(compareScoutDesktopVersions(lower, higher)).toBeLessThan(0);
      expect(compareScoutDesktopVersions(higher, lower)).toBeGreaterThan(0);
      expect(compareScoutDesktopVersions(lower, lower)).toBe(0);
    },
  );
});

const parse = (value: unknown) => ScoutDesktopUpdateManifestSchema.parse(value);

describe("Scout desktop release publication rules", () => {
  test("builds the manifest the fixtures describe", () => {
    const artifact = stable.platforms["windows-x86_64"];
    const built = buildUpdateManifest({
      channel: "stable",
      version: "0.2.0",
      minimumVersion: "0.1.0",
      notes: stable.notes,
      publishedAt: stable.publishedAt,
      windows: {
        fileName: "scout-desktop-stable_0.2.0_x64-setup.exe",
        sha256: artifact.sha256,
        size: artifact.size,
        signature: artifact.signature,
        format: "nsis",
      },
    });
    expect(built).toEqual(stable);
  });

  test("refuses to build a manifest that breaks the contract", () => {
    const artifact = stable.platforms["windows-x86_64"];
    expect(() =>
      buildUpdateManifest({
        channel: "stable",
        version: "0.2.0",
        minimumVersion: "0.3.0",
        notes: "",
        publishedAt: stable.publishedAt,
        windows: {
          sha256: artifact.sha256,
          size: artifact.size,
          signature: artifact.signature,
          format: "nsis",
          fileName: "Scout Desktop.exe",
        },
      }),
    ).toThrow();
  });

  test("publishes the first release and any newer one", () => {
    expect(() => {
      assertNeverDowngrade(null, parse(stable));
    }).not.toThrow();
    const newer = parse({
      ...stable,
      version: "0.3.0",
      platforms: {
        "windows-x86_64": {
          ...stable.platforms["windows-x86_64"],
          url: "https://download.scout-for-lol.com/releases/0.3.0/scout-desktop-stable_0.3.0_x64-setup.exe",
        },
      },
    });
    expect(() => {
      assertNeverDowngrade(parse(stable), newer);
    }).not.toThrow();
  });

  test("never downgrades the live channel", () => {
    const older = parse({
      ...stable,
      version: "0.1.5",
      platforms: {
        "windows-x86_64": {
          ...stable.platforms["windows-x86_64"],
          url: "https://download.scout-for-lol.com/releases/0.1.5/scout-desktop-stable_0.1.5_x64-setup.exe",
        },
      },
    });
    expect(() => {
      assertNeverDowngrade(parse(stable), older);
    }).toThrow(/downgrade/);
  });

  test("never lowers the minimum version", () => {
    const live = parse({ ...stable, minimumVersion: "0.2.0" });
    const newer = parse({
      ...stable,
      version: "0.3.0",
      minimumVersion: "0.1.0",
      platforms: {
        "windows-x86_64": {
          ...stable.platforms["windows-x86_64"],
          url: "https://download.scout-for-lol.com/releases/0.3.0/scout-desktop-stable_0.3.0_x64-setup.exe",
        },
      },
    });
    expect(() => {
      assertNeverDowngrade(live, newer);
    }).toThrow(/minimum/);
  });

  test("never republishes the live version", () => {
    expect(() => {
      assertNeverDowngrade(parse(stable), parse(stable));
    }).toThrow(/already live/);
  });

  test("never mixes channels", () => {
    expect(() => {
      assertNeverDowngrade(parse(stable), parse(beta));
    }).toThrow(/not beta/);
  });
});
