import { describe, expect, test } from "vitest";
import { z } from "zod";
import rawContract from "./desktop-update-manifest.contract.json" with { type: "json" };
import rawFixtures from "./desktop-update-manifest.fixtures.json" with { type: "json" };
import {
  SCOUT_DESKTOP_UPDATE_ORIGIN,
  ScoutDesktopUpdateChannelSchema,
  ScoutDesktopUpdateFormatSchema,
  ScoutDesktopUnsupportedSchemaError,
  ScoutDesktopUpdateManifestSchema,
  ScoutDesktopUpdatePlatformSchema,
  compareScoutDesktopVersions,
  readScoutDesktopUpdateManifest,
  scoutDesktopPlatformFormats,
} from "./desktop-update-manifest.schema.ts";
import {
  assertNeverDowngrade,
  buildUpdateManifest,
  channelManifestKey,
  macDiskImageFileName,
  releaseObjectKey,
  resolvePublication,
  updateArtifactFileName,
} from "./desktop-update-release.ts";

const [stable, beta, macOnly] = rawFixtures.valid;
if (stable === undefined || beta === undefined || macOnly === undefined) {
  throw new Error(
    "the fixtures need a two-platform stable, a Windows beta and a macOS-only beta manifest",
  );
}
const stableWindows = stable.platforms["windows-x86_64"];
const stableMac = stable.platforms["darwin-universal"];
const macOnlyArtifact = macOnly.platforms["darwin-universal"];
if (
  stableWindows === undefined ||
  stableMac === undefined ||
  macOnlyArtifact === undefined
) {
  throw new Error("the stable fixture ships both platforms, the third macOS");
}
const stableMacSha256 = stableMac.sha256;

const withEntry = (entry: Record<string, unknown>) => ({
  ...stable,
  platforms: { "windows-x86_64": { ...stableWindows, ...entry } },
});

const PlatformKeys = z.looseObject({
  platforms: z.record(z.string(), z.unknown()).optional(),
});
function shippedPlatforms(body: unknown): string[] {
  return Object.keys(PlatformKeys.parse(body).platforms ?? {});
}

describe("Scout desktop update manifest contract", () => {
  test("keeps the Zod schema aligned with the shared contract", () => {
    expect(SCOUT_DESKTOP_UPDATE_ORIGIN).toBe(rawContract.origin);
    expect(ScoutDesktopUpdateChannelSchema.options).toEqual(
      rawContract.channels,
    );
    expect(ScoutDesktopUpdatePlatformSchema.options).toEqual(
      Object.keys(rawContract.platforms),
    );
    expect(Object.keys(rawContract.platforms)).toEqual([
      "windows-x86_64",
      "darwin-universal",
    ]);
    for (const platform of ScoutDesktopUpdatePlatformSchema.options) {
      expect(scoutDesktopPlatformFormats(platform)).toEqual(
        rawContract.platforms[platform].formats,
      );
    }
    expect(new Set(ScoutDesktopUpdateFormatSchema.options)).toEqual(
      new Set(
        Object.values(rawContract.platforms).flatMap(({ formats }) => formats),
      ),
    );
    expect(rawContract.contractVersion).toBe(1);
    expect(rawContract.contractMinorVersion).toBe(0);
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

  test.each(rawFixtures.forwardCompatible)(
    "an installed client reads $reason, the publisher refuses it",
    ({ body }) => {
      for (const platform of ScoutDesktopUpdatePlatformSchema.options) {
        const read = readScoutDesktopUpdateManifest(body, platform);
        expect(read.channel).toBe(body.channel);
        expect(read.artifact !== undefined).toBe(
          shippedPlatforms(body).includes(platform),
        );
      }
      const publishable = ScoutDesktopUpdateManifestSchema.safeParse(body);
      expect(publishable.success).toBe(false);
    },
  );

  test.each(rawFixtures.invalid)(
    "a client refuses $reason for the platforms it names",
    ({ body }) => {
      const named = ScoutDesktopUpdatePlatformSchema.options.filter(
        (platform) => shippedPlatforms(body).includes(platform),
      );
      const platforms =
        named.length > 0 ? named : ScoutDesktopUpdatePlatformSchema.options;
      for (const platform of platforms) {
        expect(() => readScoutDesktopUpdateManifest(body, platform)).toThrow();
      }
    },
  );

  test("refuses a higher major with a typed error before reading the rest", () => {
    const major = rawFixtures.invalid.find(({ reason }) =>
      reason.startsWith("a higher major"),
    );
    expect(() =>
      readScoutDesktopUpdateManifest(major?.body, "windows-x86_64"),
    ).toThrow(ScoutDesktopUnsupportedSchemaError);
  });

  test("an additive field does not exempt an own entry from the other rules", () => {
    expect(() =>
      readScoutDesktopUpdateManifest(
        withEntry({ format: "app", metadata: 1 }),
        "windows-x86_64",
      ),
    ).toThrow(/installs from nsis/);
    expect(() =>
      readScoutDesktopUpdateManifest(
        withEntry({
          url: "https://example.com/releases/0.2.0/a.exe",
          metadata: 1,
        }),
        "windows-x86_64",
      ),
    ).toThrow(/artifact url/);
  });

  test("a client ignores a malformed entry for a platform it does not run on", () => {
    const body = structuredClone(stable);
    body.platforms = {
      ...body.platforms,
      "windows-x86_64": { ...stableWindows, sha256: "nope" },
    };
    expect(
      readScoutDesktopUpdateManifest(body, "darwin-universal").artifact,
    ).toEqual(stableMac);
    expect(() =>
      readScoutDesktopUpdateManifest(body, "windows-x86_64"),
    ).toThrow();
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

function windowsOnly(version: string) {
  return parse({
    ...stable,
    version,
    platforms: {
      "windows-x86_64": {
        ...stableWindows,
        url: `https://download.scout-for-lol.com/releases/${version}/scout-desktop-stable_${version}_x64-setup.exe`,
      },
    },
  });
}
function macOnlyStable(version: string, sha256 = stableMacSha256) {
  return parse({
    ...stable,
    version,
    platforms: {
      "darwin-universal": {
        ...stableMac,
        sha256,
        url: `https://download.scout-for-lol.com/releases/${version}/scout-desktop-stable_${version}_universal.app.tar.gz`,
      },
    },
  });
}

describe("Scout desktop release publication rules", () => {
  test("names each platform's artifacts after the channel and version", () => {
    expect(updateArtifactFileName("stable", "0.2.0", "windows-x86_64")).toBe(
      "scout-desktop-stable_0.2.0_x64-setup.exe",
    );
    expect(
      updateArtifactFileName("beta", "1.0.0-beta.3", "darwin-universal"),
    ).toBe("scout-desktop-beta_1.0.0-beta.3_universal.app.tar.gz");
    expect(macDiskImageFileName("stable", "0.2.0")).toBe(
      "scout-desktop-stable_0.2.0_universal.dmg",
    );
  });

  test("builds the two-platform manifest the fixtures describe", () => {
    const windows = stableWindows;
    const built = buildUpdateManifest({
      channel: "stable",
      version: "0.2.0",
      minimumVersion: "0.1.0",
      notes: stable.notes,
      publishedAt: stable.publishedAt,
      platforms: {
        "windows-x86_64": {
          fileName: updateArtifactFileName("stable", "0.2.0", "windows-x86_64"),
          sha256: windows.sha256,
          size: windows.size,
          signature: windows.signature,
          format: "nsis",
        },
        "darwin-universal": {
          fileName: updateArtifactFileName(
            "stable",
            "0.2.0",
            "darwin-universal",
          ),
          sha256: stableMac.sha256,
          size: stableMac.size,
          signature: stableMac.signature,
          format: "app",
        },
      },
    });
    expect(built).toEqual(stable);
  });

  test("builds a macOS-only manifest", () => {
    const artifact = macOnlyArtifact;
    const built = buildUpdateManifest({
      channel: "beta",
      version: macOnly.version,
      minimumVersion: macOnly.minimumVersion,
      notes: macOnly.notes,
      publishedAt: macOnly.publishedAt,
      platforms: {
        "darwin-universal": {
          fileName: updateArtifactFileName(
            "beta",
            macOnly.version,
            "darwin-universal",
          ),
          sha256: artifact.sha256,
          size: artifact.size,
          signature: artifact.signature,
          format: "app",
        },
      },
    });
    expect(built).toEqual(macOnly);
  });

  test("refuses a manifest whose artifact is in another platform's format", () => {
    expect(() =>
      buildUpdateManifest({
        channel: "stable",
        version: "0.2.0",
        minimumVersion: "0.1.0",
        notes: "",
        publishedAt: stable.publishedAt,
        platforms: {
          "darwin-universal": {
            fileName: updateArtifactFileName(
              "stable",
              "0.2.0",
              "darwin-universal",
            ),
            sha256: stableMac.sha256,
            size: stableMac.size,
            signature: stableMac.signature,
            format: "nsis",
          },
        },
      }),
    ).toThrow(/darwin-universal installs from app/);
  });

  test("refuses a manifest with no platform", () => {
    expect(() =>
      buildUpdateManifest({
        channel: "stable",
        version: "0.2.0",
        minimumVersion: "0.1.0",
        notes: "",
        publishedAt: stable.publishedAt,
        platforms: {},
      }),
    ).toThrow(/at least one platform/);
  });

  test("refuses to build a manifest that breaks the contract", () => {
    const artifact = stableWindows;
    expect(() =>
      buildUpdateManifest({
        channel: "stable",
        version: "0.2.0",
        minimumVersion: "0.3.0",
        notes: "",
        publishedAt: stable.publishedAt,
        platforms: {
          "windows-x86_64": {
            sha256: artifact.sha256,
            size: artifact.size,
            signature: artifact.signature,
            format: "nsis",
            fileName: "Scout Desktop.exe",
          },
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
          ...stableWindows,
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
          ...stableWindows,
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
          ...stableWindows,
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

describe("Scout desktop release publication across hosts", () => {
  test("publishes a new version with only the platform built here", () => {
    expect(resolvePublication(null, macOnlyStable("0.2.0"))).toEqual(
      macOnlyStable("0.2.0"),
    );
    expect(
      resolvePublication(windowsOnly("0.2.0"), macOnlyStable("0.3.0")),
    ).toEqual(macOnlyStable("0.3.0"));
  });

  test("adds the second platform to the live version and keeps the first", () => {
    const merged = resolvePublication(
      windowsOnly("0.2.0"),
      macOnlyStable("0.2.0"),
    );
    expect(merged).toEqual(parse(stable));
  });

  test("never replaces a platform that is already live", () => {
    expect(() =>
      resolvePublication(parse(stable), macOnlyStable("0.2.0", "a".repeat(64))),
    ).toThrow(/different darwin-universal artifact/);
    expect(() =>
      resolvePublication(parse(stable), macOnlyStable("0.2.0")),
    ).toThrow(/already live/);
  });

  test("a second platform keeps the live notes and minimum version", () => {
    const live = windowsOnly("0.2.0");
    expect(() =>
      resolvePublication(
        live,
        parse({ ...macOnlyStable("0.2.0"), notes: "x" }),
      ),
    ).toThrow(/other release notes/);
    expect(() =>
      resolvePublication(
        live,
        parse({ ...macOnlyStable("0.2.0"), minimumVersion: "0.2.0" }),
      ),
    ).toThrow(/minimum version 0.1.0/);
  });

  test("still refuses a downgrade or a channel mix", () => {
    expect(() =>
      resolvePublication(windowsOnly("0.3.0"), macOnlyStable("0.2.0")),
    ).toThrow(/downgrade/);
    expect(() => resolvePublication(parse(stable), parse(beta))).toThrow(
      /not beta/,
    );
  });
});
