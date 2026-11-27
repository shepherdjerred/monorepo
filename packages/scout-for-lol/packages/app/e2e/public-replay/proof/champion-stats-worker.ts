import { expect, type Page } from "@playwright/test";
import path from "node:path";
import { z } from "zod";
import {
  verifyDirectAnimationCues,
  workerAnimationCues,
} from "./animation-worker-oracle.ts";

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
const experience = z.array(
  z.object({
    participantId: schemaTrack,
    levelCaps: z.array(
      z.tuple([z.number().nonnegative(), z.number().int().positive()]),
    ),
    points: z.array(
      z.tuple([
        z.number().nonnegative(),
        z.number().nonnegative(),
        z.number().int().positive(),
      ]),
    ),
  }),
);
const reply = z.object({
  requestKeys: z.array(z.string()),
  decodeChampionStats: z.boolean(),
  decodeChampionInventory: z.boolean(),
  decodeChampionExperience: z.boolean(),
  hasChampionAnimationCatalog: z.boolean(),
  stats: z
    .object({
      championHealthTracks: health,
      championResourceTracks: resources,
    })
    .optional(),
  inventoryTracks: inventory.optional(),
  experienceTracks: experience.optional(),
  animationCues: workerAnimationCues.optional(),
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
          const decodeChampionExperience =
            Object.getOwnPropertyDescriptor(object, "decodeChampionExperience")
              ?.value === true;
          const hasChampionAnimationCatalog = Object.hasOwn(
            object,
            "championAnimationCatalog",
          );
          if (
            decodeChampionStats ||
            decodeChampionInventory ||
            decodeChampionExperience ||
            hasChampionAnimationCatalog
          ) {
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
                const experienceTracks: unknown =
                  Object.getOwnPropertyDescriptor(
                    response,
                    "championExperienceTracks",
                  )?.value;
                const animationCues: unknown = Object.getOwnPropertyDescriptor(
                  response,
                  "championAnimationCues",
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
                      decodeChampionExperience,
                      hasChampionAnimationCatalog,
                      stats,
                      inventoryTracks,
                      experienceTracks,
                      animationCues,
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
  "scout-8428-experience-tracks.json":
    "23ce79d3a3cc4f3d9620d2473ff95edcb58b65fed8067f52f28b6a8e17dd4ab9",
  "scout-8428-experience-native-proof.json":
    "456b97569682af9d810fa3380302f838ecc1b185f45103fc6f5a9c2c61685acd",
  "scout-8428-experience-cap-proof.json":
    "17d0f890d8d99e3659b656ae153a3c82190461979b056e361948892caf74f46b",
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
    | z.infer<typeof inventory>
    | z.infer<typeof experience>,
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
    directChampionExperience: boolean;
    directChampionAnimation: boolean;
    directChampionObservations: boolean;
    championAnimationCueCount: number;
  },
) {
  if (!fixture.directChampionObservations)
    return fixture.championAnimationCueCount;
  const {
    descriptor,
    directChampionStats,
    directChampionInventory,
    directChampionExperience,
    directChampionAnimation,
  } = fixture;
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
  expect(actual.decodeChampionExperience).toBe(directChampionExperience);
  expect(actual.hasChampionAnimationCatalog).toBe(directChampionAnimation);
  const optionalKeys = Object.entries({
    championAnimationCatalog: directChampionAnimation,
    decodeChampionExperience: directChampionExperience,
    decodeChampionInventory: directChampionInventory,
    decodeChampionStats: directChampionStats,
  })
    .filter(([, enabled]) => enabled)
    .map(([key]) => key);
  expect(actual.requestKeys).toEqual([
    "allowCurrentBuild",
    ...optionalKeys,
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
  if (directChampionExperience) {
    const [bytes] = await Promise.all([
      readOracle(oracleRoot, "scout-8428-experience-tracks.json"),
      readOracle(oracleRoot, "scout-8428-experience-native-proof.json"),
      readOracle(oracleRoot, "scout-8428-experience-cap-proof.json"),
    ]);
    const expected = z
      .object({ replaySha256: z.string(), tracks: experience })
      .parse(decode(bytes));
    expect(expected.replaySha256).toBe(descriptor.sha256);
    if (actual.experienceTracks === undefined)
      throw new Error("Direct worker response is missing champion experience.");
    expect(tracksHash(actual.experienceTracks)).toBe(
      tracksHash(expected.tracks),
    );
  } else {
    expect(actual.experienceTracks).toBeUndefined();
  }
  if (directChampionAnimation) {
    if (actual.animationCues === undefined)
      throw new Error(
        "Direct worker response is missing champion animation cues.",
      );
    await verifyDirectAnimationCues(
      oracleRoot,
      descriptor.sha256,
      actual.animationCues,
    );
    return actual.animationCues.length;
  }
  expect(actual.animationCues).toBeUndefined();
  return fixture.championAnimationCueCount;
}
