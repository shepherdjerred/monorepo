import { z } from "zod";

const CatalogSchema = z
  .object({
    entries: z.array(
      z
        .object({
          name: z.string().min(1),
          value: z.string().min(1),
        })
        .loose(),
    ),
  })
  .loose();

const TemporalWorkflowImageValueSchema = z
  .string()
  .regex(/^\d+\.\d+\.\d+-\d+@sha256:[0-9a-f]{64}$/);
const PinStateSchema = z
  .object({
    schema: z.literal("pin-candidates-state/v1"),
    pins: z.record(
      z.string(),
      z.object({
        version: z.string().min(1),
        digest: z.string().regex(/^sha256:[0-9a-f]{64}$/),
        buildNumber: z.number().int().positive(),
      }),
    ),
  })
  .strict();

export type StablePinPromotion = {
  candidateImage: string;
  contents: string;
  stateContents: string;
  alreadyPromoted: boolean;
};

export type CandidatePinReset = {
  contents: string;
  changed: boolean;
};

export type CandidatePinStateReset = {
  contents: string;
  changed: boolean;
};

function parseCatalog(raw: string): z.infer<typeof CatalogSchema> {
  try {
    return CatalogSchema.parse(JSON.parse(raw));
  } catch (error: unknown) {
    throw new Error("Temporal version catalog is invalid", { cause: error });
  }
}

export async function prepareStablePinPromotion(
  catalogPath: string,
  statePath: string,
): Promise<StablePinPromotion> {
  const catalog = parseCatalog(await Bun.file(catalogPath).text());
  const candidateName = "shepherdjerred/temporal-worker/workflows/candidate";
  const stableName = "shepherdjerred/temporal-worker/workflows/stable";
  const candidate = catalog.entries.find(
    (entry) => entry.name === candidateName,
  );
  const stable = catalog.entries.find((entry) => entry.name === stableName);
  if (candidate === undefined || stable === undefined) {
    throw new Error("Temporal workflow stable/candidate pins are missing");
  }
  const candidateValue = TemporalWorkflowImageValueSchema.parse(
    candidate.value,
  );
  const stableValue = TemporalWorkflowImageValueSchema.parse(stable.value);
  const alreadyPromoted = candidateValue === stableValue;
  stable.value = candidate.value;
  let state: z.infer<typeof PinStateSchema>;
  try {
    state = PinStateSchema.parse(JSON.parse(await Bun.file(statePath).text()));
  } catch (error: unknown) {
    throw new Error("Temporal pin candidate state is invalid", {
      cause: error,
    });
  }
  const candidateVersion = candidateValue.slice(
    0,
    candidateValue.lastIndexOf("@"),
  );
  const buildNumberText = /-(\d+)$/.exec(candidateVersion)?.[1];
  if (buildNumberText === undefined) {
    throw new Error("Temporal workflow candidate pin has no build number");
  }
  const pins = {
    ...state.pins,
    [stableName]: {
      version: candidateVersion,
      digest: candidateValue.slice(candidateValue.lastIndexOf("@") + 1),
      buildNumber: Number.parseInt(buildNumberText, 10),
    },
  };
  return {
    candidateImage: `ghcr.io/shepherdjerred/temporal-worker:${candidateValue}`,
    contents: `${JSON.stringify(catalog, null, 2)}\n`,
    stateContents: `${JSON.stringify({ schema: state.schema, pins }, null, 2)}\n`,
    alreadyPromoted,
  };
}

export async function prepareCandidatePinReset(
  catalogPath: string,
  candidatePinName = "shepherdjerred/temporal-worker/workflows/candidate",
  stablePinName = "shepherdjerred/temporal-worker/workflows/stable",
): Promise<CandidatePinReset> {
  const catalog = parseCatalog(await Bun.file(catalogPath).text());
  const candidate = catalog.entries.find(
    (entry) => entry.name === candidatePinName,
  );
  const stable = catalog.entries.find((entry) => entry.name === stablePinName);
  if (candidate === undefined || stable === undefined) {
    throw new Error("Temporal workflow stable/candidate pins are missing");
  }
  TemporalWorkflowImageValueSchema.parse(candidate.value);
  const stableValue = TemporalWorkflowImageValueSchema.parse(stable.value);
  const changed = candidate.value !== stableValue;
  candidate.value = stableValue;
  return {
    contents: `${JSON.stringify(catalog, null, 2)}\n`,
    changed,
  };
}

export async function prepareCandidatePinStateReset(
  statePath: string,
  candidatePinName: string,
): Promise<CandidatePinStateReset> {
  let state: z.infer<typeof PinStateSchema>;
  try {
    state = PinStateSchema.parse(JSON.parse(await Bun.file(statePath).text()));
  } catch (error: unknown) {
    throw new Error("Temporal pin candidate state is invalid", {
      cause: error,
    });
  }
  if (!(candidatePinName in state.pins)) {
    return { contents: `${JSON.stringify(state, null, 2)}\n`, changed: false };
  }
  const pins = Object.fromEntries(
    Object.entries(state.pins)
      .filter(([name]) => name !== candidatePinName)
      .sort(([left], [right]) => left.localeCompare(right)),
  );
  return {
    contents: `${JSON.stringify({ schema: state.schema, pins }, null, 2)}\n`,
    changed: true,
  };
}
