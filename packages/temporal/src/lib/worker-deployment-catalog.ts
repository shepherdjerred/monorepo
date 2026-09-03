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
        gitSha: z
          .string()
          .regex(/^[0-9a-f]{40}$/)
          .optional(),
      }),
    ),
  })
  .strict();

type PinStateEntry = z.infer<typeof PinStateSchema>["pins"][string];
type PinState = z.infer<typeof PinStateSchema>;
type CatalogEntry = z.infer<typeof CatalogSchema>["entries"][number];

function replaceCatalogPinValue(
  raw: string,
  pinName: string,
  value: string,
): string {
  const namePattern = new RegExp(`"name"\\s*:\\s*${JSON.stringify(pinName)}`);
  const nameMatch = namePattern.exec(raw);
  if (nameMatch === null || nameMatch.index === undefined) {
    throw new Error(`Temporal version catalog pin is missing: ${pinName}`);
  }
  const nameStart = nameMatch.index;
  const nextEntry = raw.indexOf("\n    {\n", nameStart + nameMatch[0].length);
  const entryEnd = nextEntry === -1 ? raw.length : nextEntry;
  const entry = raw.slice(nameStart, entryEnd);
  const valuePattern = /"value":\s*"[^"]*"/;
  if (!valuePattern.test(entry)) {
    throw new Error(`Temporal version catalog pin has no value: ${pinName}`);
  }
  return (
    raw.slice(0, nameStart) +
    entry.replace(valuePattern, `"value": ${JSON.stringify(value)}`) +
    raw.slice(entryEnd)
  );
}

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
    left.digest === right.digest &&
    left.gitSha === right.gitSha
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
  const raw = await Bun.file(catalogPath).text();
  const catalog = parseCatalog(raw);
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
  return {
    candidateImage: `${imageRepository}:${candidateValue}`,
    contents: replaceCatalogPinValue(raw, stablePinName, candidate.value),
    alreadyPromoted,
  };
}

export async function prepareCandidatePinReset(
  catalogPath: string,
  candidatePinName = "shepherdjerred/temporal-worker/workflows/candidate",
  stablePinName = "shepherdjerred/temporal-worker/workflows/stable",
): Promise<CandidatePinReset> {
  const raw = await Bun.file(catalogPath).text();
  const catalog = parseCatalog(raw);
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
  return {
    contents: replaceCatalogPinValue(raw, candidatePinName, stableValue),
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
