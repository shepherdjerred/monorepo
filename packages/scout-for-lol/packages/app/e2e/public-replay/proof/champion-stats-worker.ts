import { expect, type Page } from "@playwright/test";
import path from "node:path";
import { z } from "zod";

const schemaTrack = z.number().int().positive();
const statPoint = z.tuple([z.number(), z.number(), z.number()]);
const health = z.array(
  z.object({ participantId: schemaTrack, points: z.array(statPoint) }),
);
const resources = z.array(
  z.object({
    participantId: schemaTrack,
    gold: z.array(z.tuple([z.number(), z.number()])),
    resource: z.array(statPoint),
  }),
);
const inventory = z.array(
  z.object({
    participantId: schemaTrack,
    points: z.array(
      z.tuple([
        z.number().nonnegative(),
        z
          .array(
            z
              .object({
                itemId: z.number().int().positive(),
                count: z.number().int().nonnegative(),
              })
              .nullable(),
          )
          .length(7),
      ]),
    ),
  }),
);
const reply = z.object({
  requestKeys: z.array(z.string()),
  decodeChampionStats: z.boolean(),
  decodeChampionInventory: z.boolean(),
  stats: z
    .object({
      championHealthTracks: health,
      championResourceTracks: resources,
    })
    .optional(),
  inventoryTracks: inventory.optional(),
});

export async function observeDirectChampionStatsWorker(page: Page) {
  await page.addInitScript(() => {
    const OriginalWorker = globalThis.Worker;
    Object.defineProperty(globalThis, "Worker", {
      value: class ObservedWorker extends OriginalWorker {
        override postMessage(
          message: unknown,
          options?: Transferable[] | StructuredSerializeOptions,
        ) {
          const object =
            message !== null && typeof message === "object" ? message : {};
          const decodeChampionStats =
            Object.getOwnPropertyDescriptor(object, "decodeChampionStats")
              ?.value === true;
          const decodeChampionInventory =
            Object.getOwnPropertyDescriptor(object, "decodeChampionInventory")
              ?.value === true;
          if (decodeChampionStats || decodeChampionInventory) {
            const requestKeys = Object.keys(object).sort();
            const captureReady = ({ data }: MessageEvent<unknown>) => {
              const response =
                data !== null && typeof data === "object" ? data : {};
              if (
                Object.getOwnPropertyDescriptor(response, "type")?.value ===
                "ready"
              ) {
                this.removeEventListener("message", captureReady);
                const stats: unknown = Object.getOwnPropertyDescriptor(
                  response,
                  "championStats",
                )?.value;
                const inventoryTracks: unknown =
                  Object.getOwnPropertyDescriptor(
                    response,
                    "championInventoryTracks",
                  )?.value;
                Object.defineProperty(
                  globalThis,
                  "__scoutDirectChampionStatsProof",
                  {
                    configurable: true,
                    value: {
                      requestKeys,
                      decodeChampionStats,
                      decodeChampionInventory,
                      stats,
                      inventoryTracks,
                    },
                  },
                );
              }
            };
            this.addEventListener("message", captureReady);
          }
          if (Array.isArray(options)) super.postMessage(message, options);
          else super.postMessage(message, options);
        }
      },
    });
  });
}

const oracleFiles = {
  "scout-8428-champion-health.json":
    "f2b0232bc86868479da10e6ed38bdb233867605ffe64c2116db078878ad651bd",
  "scout-8428-champion-resources.json":
    "4678aaf2167c5186e6bf64df83757831bdd5510b29ce8edc5308dc6ce57772e7",
  "scout-8428-health-native.json":
    "3a84587c250585b04d5e16c6c3ad49c3bfed6d406161d118100f65703d711a38",
  "scout-8428-resources-native.json":
    "824d568719f530e728eebb0d0abea47761516acef53d5f28a1c3653433258e9f",
  "scout-8428-inventory-current-tracks.json":
    "56b91b8bc6b6de0bc8b4f7a57a007ff6f35a427d2c112da6cd942eb9830495f7",
};

const sha256 = (bytes: Uint8Array) =>
  new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
const decode = (bytes: Uint8Array): unknown =>
  JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));

async function readOracle(root: string, file: keyof typeof oracleFiles) {
  const bytes = await Bun.file(path.join(root, file)).bytes();
  if (sha256(bytes) !== oracleFiles[file])
    throw new Error(
      `Recorded champion observation oracle digest differs: ${file}.`,
    );
  return bytes;
}

function tracksHash(
  tracks:
    | z.infer<typeof health>
    | z.infer<typeof resources>
    | z.infer<typeof inventory>,
) {
  return sha256(
    new TextEncoder().encode(
      JSON.stringify(
        tracks.toSorted((a, b) => a.participantId - b.participantId),
      ),
    ),
  );
}

export async function verifyDirectChampionStatsWorker(
  page: Page,
  fixture: {
    descriptor: { sha256: string };
    directChampionStats: boolean;
    directChampionInventory: boolean;
  },
) {
  const { descriptor, directChampionStats, directChampionInventory } = fixture;
  const oracleRoot = Bun.env["SCOUT_REPLAY_E2E_STATS_ORACLE_DIRECTORY"];
  if (oracleRoot === undefined || oracleRoot === "")
    throw new Error(
      "Set SCOUT_REPLAY_E2E_STATS_ORACLE_DIRECTORY for direct champion observation verification.",
    );
  const capture: unknown = await page.evaluate((): unknown => {
    const observed: unknown = Object.getOwnPropertyDescriptor(
      globalThis,
      "__scoutDirectChampionStatsProof",
    )?.value;
    return observed;
  });
  const actual = reply.parse(capture);
  expect(actual.decodeChampionStats).toBe(directChampionStats);
  expect(actual.decodeChampionInventory).toBe(directChampionInventory);
  expect(actual.requestKeys).toEqual([
    "allowCurrentBuild",
    ...(directChampionInventory ? ["decodeChampionInventory"] : []),
    ...(directChampionStats ? ["decodeChampionStats"] : []),
    "decoderBytes",
    "identity",
    "replayBytes",
    "waypointOrigin",
  ]);
  if (directChampionStats) {
    const [healthOracle, resourceOracle] = await Promise.all([
      readOracle(oracleRoot, "scout-8428-champion-health.json"),
      readOracle(oracleRoot, "scout-8428-champion-resources.json"),
      readOracle(oracleRoot, "scout-8428-health-native.json"),
      readOracle(oracleRoot, "scout-8428-resources-native.json"),
    ]);
    const expectedHealth = z
      .object({ replaySha256: z.string(), tracks: health })
      .parse(decode(healthOracle));
    const expectedResource = z
      .object({ replaySha256: z.string(), tracks: resources })
      .parse(decode(resourceOracle));
    expect(expectedHealth.replaySha256).toBe(descriptor.sha256);
    expect(expectedResource.replaySha256).toBe(descriptor.sha256);
    if (actual.stats === undefined)
      throw new Error("Direct worker response is missing champion stats.");
    expect(tracksHash(actual.stats.championHealthTracks)).toBe(
      tracksHash(expectedHealth.tracks),
    );
    expect(tracksHash(actual.stats.championResourceTracks)).toBe(
      tracksHash(expectedResource.tracks),
    );
  }
  if (directChampionInventory) {
    const bytes = await readOracle(
      oracleRoot,
      "scout-8428-inventory-current-tracks.json",
    );
    const expected = z
      .object({ replaySha256: z.string(), tracks: inventory })
      .parse(decode(bytes));
    expect(expected.replaySha256).toBe(descriptor.sha256);
    if (actual.inventoryTracks === undefined)
      throw new Error("Direct worker response is missing champion inventory.");
    expect(tracksHash(actual.inventoryTracks)).toBe(
      tracksHash(expected.tracks),
    );
  }
}
