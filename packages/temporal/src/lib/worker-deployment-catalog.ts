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

type PinStateEntry = z.infer<typeof PinStateSchema>["pins"][string];
type PinState = z.infer<typeof PinStateSchema>;
type CatalogEntry = z.infer<typeof CatalogSchema>["entries"][number];

export type StablePinPromotion = {
  candidateImage: string;
  contents: string;
  alreadyPromoted: boolean;
};

export type CandidatePinReset = {
  contents: string;
  changed: boolean;
  candidateValue: string;
};

export type CandidatePinStateReset = {
  contents: string;
  changed: boolean;
};

export type StablePinStatePromotion = {
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

function pinStateEntriesEqual(
  left: PinStateEntry | undefined,
  right: PinStateEntry,
): boolean {
  if (left === undefined) return false;
  return (
    left.buildNumber === right.buildNumber &&
    left.version === right.version &&
    left.digest === right.digest
  );
}

async function readPinState(statePath: string): Promise<PinState> {
  try {
    return PinStateSchema.parse(JSON.parse(await Bun.file(statePath).text()));
  } catch (error: unknown) {
    throw new Error("Temporal pin candidate state is invalid", {
      cause: error,
    });
  }
}

function findWorkflowPins(
  catalog: z.infer<typeof CatalogSchema>,
  candidatePinName: string,
  stablePinName: string,
): { candidate: CatalogEntry; stable: CatalogEntry } {
  const candidate = catalog.entries.find(
    (entry) => entry.name === candidatePinName,
  );
  const stable = catalog.entries.find((entry) => entry.name === stablePinName);
  if (candidate === undefined || stable === undefined) {
    throw new Error("Temporal workflow stable/candidate pins are missing");
  }
  return { candidate, stable };
}

export async function prepareStablePinPromotion(
  catalogPath: string,
  candidatePinName = "shepherdjerred/temporal-worker/workflows/candidate",
  stablePinName = "shepherdjerred/temporal-worker/workflows/stable",
  imageRepository = "ghcr.io/shepherdjerred/temporal-worker",
): Promise<StablePinPromotion> {
  const catalog = parseCatalog(await Bun.file(catalogPath).text());
  const { candidate, stable } = findWorkflowPins(
    catalog,
    candidatePinName,
    stablePinName,
  );
  const candidateValue = TemporalWorkflowImageValueSchema.parse(
    candidate.value,
  );
  const stableValue = TemporalWorkflowImageValueSchema.parse(stable.value);
  const alreadyPromoted = candidateValue === stableValue;
  stable.value = candidate.value;
  return {
    candidateImage: `${imageRepository}:${candidateValue}`,
    contents: `${JSON.stringify(catalog, null, 2)}\n`,
    alreadyPromoted,
  };
}

export async function prepareCandidatePinReset(
  catalogPath: string,
  candidatePinName = "shepherdjerred/temporal-worker/workflows/candidate",
  stablePinName = "shepherdjerred/temporal-worker/workflows/stable",
): Promise<CandidatePinReset> {
  const catalog = parseCatalog(await Bun.file(catalogPath).text());
  const { candidate, stable } = findWorkflowPins(
    catalog,
    candidatePinName,
    stablePinName,
  );
  const candidateValue = TemporalWorkflowImageValueSchema.parse(
    candidate.value,
  );
  const stableValue = TemporalWorkflowImageValueSchema.parse(stable.value);
  const changed = candidate.value !== stableValue;
  candidate.value = stableValue;
  return {
    contents: `${JSON.stringify(catalog, null, 2)}\n`,
    changed,
    candidateValue,
  };
}

export async function prepareCandidatePinStateReset(
  statePath: string,
  candidatePinName: string,
): Promise<CandidatePinStateReset> {
  const state = await readPinState(statePath);
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

export async function prepareStablePinStatePromotion(
  statePath: string,
  candidatePinName: string,
  stablePinName: string,
): Promise<StablePinStatePromotion> {
  const state = await readPinState(statePath);
  const candidate = state.pins[candidatePinName];
  if (candidate === undefined) {
    return { contents: `${JSON.stringify(state, null, 2)}\n`, changed: false };
  }
  const stable = state.pins[stablePinName];
  if (pinStateEntriesEqual(stable, candidate)) {
    return {
      contents: `${JSON.stringify(state, null, 2)}\n`,
      changed: false,
    };
  }
  const pins = Object.fromEntries(
    Object.entries({ ...state.pins, [stablePinName]: candidate }).sort(
      ([left], [right]) => left.localeCompare(right),
    ),
  );
  return {
    contents: `${JSON.stringify({ schema: state.schema, pins }, null, 2)}\n`,
    changed: true,
  };
}
