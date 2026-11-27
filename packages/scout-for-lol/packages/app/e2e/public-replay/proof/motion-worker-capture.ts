import type { Page } from "@playwright/test";

export async function observeDirectChampionStatsWorker(page: Page) {
  await page.addInitScript(() => {
    const OriginalWorker = globalThis.Worker;
    const property = (object: object, name: string): unknown =>
      Object.getOwnPropertyDescriptor(object, name)?.value;
    const selectors = [
      "decodeChampionStats",
      "decodeChampionInventory",
      "decodeChampionExperience",
      "championAnimationCatalog",
      "announcerEvents",
      "decodeTeamVision",
      "terrainControllerGraph",
      "laneMinionCatalog",
      "neutralObjectiveModels",
      "decodeNeutralCamps",
    ];
    Object.defineProperty(globalThis, "Worker", {
      value: class ObservedWorker extends OriginalWorker {
        override postMessage(
          message: unknown,
          options?: Transferable[] | StructuredSerializeOptions,
        ) {
          const request =
            message !== null && typeof message === "object" ? message : {};
          if (selectors.some((key) => Object.hasOwn(request, key))) {
            const requestKeys = Object.keys(request).sort();
            const captureReady = ({ data }: MessageEvent<unknown>) => {
              const response =
                data !== null && typeof data === "object" ? data : {};
              if (property(response, "type") !== "ready") return;
              this.removeEventListener("message", captureReady);
              Object.defineProperty(
                globalThis,
                "__scoutDirectChampionStatsProof",
                {
                  configurable: true,
                  value: {
                    requestKeys,
                    decodeChampionStats:
                      property(request, "decodeChampionStats") === true,
                    decodeChampionInventory:
                      property(request, "decodeChampionInventory") === true,
                    decodeChampionExperience:
                      property(request, "decodeChampionExperience") === true,
                    hasChampionAnimationCatalog: Object.hasOwn(
                      request,
                      "championAnimationCatalog",
                    ),
                    stats: property(response, "championStats"),
                    inventoryTracks: property(
                      response,
                      "championInventoryTracks",
                    ),
                    experienceTracks: property(
                      response,
                      "championExperienceTracks",
                    ),
                    animationCues: property(response, "championAnimationCues"),
                    announcerCues: property(response, "announcerCues"),
                    teamVision: property(response, "teamVision"),
                    terrainVisibility: property(response, "terrainVisibility"),
                    laneMinionInstances: property(
                      response,
                      "laneMinionInstances",
                    ),
                    laneMinionCoverage: property(
                      response,
                      "laneMinionCoverage",
                    ),
                    neutralObjectiveInstances: property(
                      response,
                      "neutralObjectiveInstances",
                    ),
                    neutralObjectiveKills: property(
                      response,
                      "neutralObjectiveKills",
                    ),
                    neutralObjectiveOmissions: property(
                      response,
                      "neutralObjectiveOmissions",
                    ),
                    neutralCampCoverage: property(
                      response,
                      "neutralCampCoverage",
                    ),
                  },
                },
              );
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

export async function readDirectWorkerReply(
  page: Page,
  fields?: string[],
): Promise<unknown> {
  return page.evaluate((keys): unknown => {
    const observed: unknown = Object.getOwnPropertyDescriptor(
      globalThis,
      "__scoutDirectChampionStatsProof",
    )?.value;
    if (keys === undefined || observed === null || typeof observed !== "object")
      return observed;
    return Object.fromEntries(
      keys.map((key) => [
        key,
        Object.getOwnPropertyDescriptor(observed, key)?.value as unknown,
      ]),
    );
  }, fields);
}
