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
const reply = z.object({
  requestKeys: z.array(z.string()),
  stats: z.object({
    championHealthTracks: health,
    championResourceTracks: resources,
  }),
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
          if (
            Object.getOwnPropertyDescriptor(object, "decodeChampionStats")
              ?.value === true
          ) {
            const requestKeys = Object.keys(object).sort();
            this.addEventListener(
              "message",
              ({ data }: MessageEvent<unknown>) => {
                const response =
                  data !== null && typeof data === "object" ? data : {};
                const stats: unknown = Object.getOwnPropertyDescriptor(
                  response,
                  "championStats",
                )?.value;
                if (
                  stats !== undefined &&
                  Object.getOwnPropertyDescriptor(response, "type")?.value ===
                    "ready"
                ) {
                  Object.defineProperty(
                    globalThis,
                    "__scoutDirectChampionStatsProof",
                    {
                      configurable: true,
                      value: { requestKeys, stats },
                    },
                  );
                }
              },
              { once: true },
            );
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
};

const sha256 = (bytes: Uint8Array) =>
  new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
const decode = (bytes: Uint8Array): unknown =>
  JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));

async function readOracle(root: string, file: keyof typeof oracleFiles) {
  const bytes = await Bun.file(path.join(root, file)).bytes();
  if (sha256(bytes) !== oracleFiles[file])
    throw new Error("Recorded champion stats oracle digest differs.");
  return bytes;
}

function tracksHash(
  tracks: z.infer<typeof health> | z.infer<typeof resources>,
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
  replaySha256: string,
) {
  const oracleRoot = Bun.env["SCOUT_REPLAY_E2E_STATS_ORACLE_DIRECTORY"];
  if (oracleRoot === undefined || oracleRoot === "")
    throw new Error(
      "Set SCOUT_REPLAY_E2E_STATS_ORACLE_DIRECTORY for direct champion stats verification.",
    );
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
  expect(expectedHealth.replaySha256).toBe(replaySha256);
  expect(expectedResource.replaySha256).toBe(replaySha256);
  const capture: unknown = await page.evaluate((): unknown => {
    const observed: unknown = Object.getOwnPropertyDescriptor(
      globalThis,
      "__scoutDirectChampionStatsProof",
    )?.value;
    return observed;
  });
  const actual = reply.parse(capture);
  expect(actual.requestKeys).toEqual([
    "allowCurrentBuild",
    "decodeChampionStats",
    "decoderBytes",
    "identity",
    "replayBytes",
    "waypointOrigin",
  ]);
  expect(tracksHash(actual.stats.championHealthTracks)).toBe(
    tracksHash(expectedHealth.tracks),
  );
  expect(tracksHash(actual.stats.championResourceTracks)).toBe(
    tracksHash(expectedResource.tracks),
  );
}
