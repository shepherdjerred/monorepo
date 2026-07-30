import { persistMaterializedDataset } from "#materialization/persist-dataset.ts";
import type { EvalStore } from "#server/store.ts";
import { makeCaseArtifact } from "#testing/eval-fixtures.ts";

type SeedCase = {
  matchId: string;
  playerName: string;
  puuid: string;
  championName: string;
  performanceSlice: "great" | "terrible" | "average";
  styleKey: string;
  outputText: string;
  previousOutputText?: string;
};

function addGeneratedCase(store: EvalStore, datasetId: string, seed: SeedCase) {
  const artifact = makeCaseArtifact(seed);
  const evalCase = store.addMaterializedCase({
    datasetId,
    artifact,
  });
  if (seed.previousOutputText !== undefined) {
    store.recordGeneration({
      caseId: evalCase.id,
      durationMs: 100,
      inputTokens: 50,
      model: "gpt-5.6-sol",
      outputText: seed.previousOutputText,
      outputTokens: 20,
      promptRevision: `${seed.matchId}-old`,
      renderedPrompts: artifact.context.renderedPrompts,
    });
  }
  store.recordGeneration({
    caseId: evalCase.id,
    durationMs: 120,
    inputTokens: 60,
    model: "gpt-5.6-sol",
    outputText: seed.outputText,
    outputTokens: 24,
    promptRevision: `${seed.matchId}-latest`,
    renderedPrompts: artifact.context.renderedPrompts,
  });
}

function seedDataset(
  store: EvalStore,
  input: {
    key: string;
    name: string;
    description: string;
    cases: SeedCase[];
    finalized: boolean;
  },
): void {
  const dataset = store.createDataset({
    description: input.description,
    key: input.key,
    name: input.name,
  });
  for (const evalCase of input.cases) {
    addGeneratedCase(store, dataset.id, evalCase);
  }
  if (input.finalized) store.finalizeDataset(dataset.id);
}

export function seedEndToEndStore(store: EvalStore): void {
  store.createDataset({
    key: "empty-draft",
    name: "Empty Draft",
    description: "No materialized cases.",
  });

  seedDataset(store, {
    key: "finalization-candidate",
    name: "Finalization Candidate",
    description: "Dedicated to the finalization scenario.",
    finalized: false,
    cases: [
      {
        matchId: "NA1_E2E_FINALIZE",
        playerName: "Finalizer",
        puuid: "puuid-finalizer",
        championName: "Ornn",
        performanceSlice: "average",
        styleKey: "aaron",
        outputText: "Finalization candidate review.",
      },
    ],
  });

  seedDataset(store, {
    key: "rating-workflow",
    name: "Rating Workflow",
    description: "Dedicated to individual review calibration.",
    finalized: true,
    cases: [
      {
        matchId: "NA1_E2E_RATE_1",
        playerName: "Jerred",
        puuid: "puuid-rating-jerred",
        championName: "Poppy",
        performanceSlice: "great",
        styleKey: "aaron",
        outputText: "Jerred turned every wall into a Poppy delivery address.",
      },
      {
        matchId: "NA1_E2E_RATE_2",
        playerName: "Ryan",
        puuid: "puuid-rating-ryan",
        championName: "Shaco",
        performanceSlice: "terrible",
        styleKey: "nekoryan",
        outputText: "Ryan made both Shaco boxes and himself decorative.",
      },
    ],
  });

  seedDataset(store, {
    key: "freshness-workflow",
    name: "Freshness Workflow",
    description: "Dedicated to batch freshness calibration.",
    finalized: true,
    cases: [
      {
        matchId: "NA1_E2E_FRESH_1",
        playerName: "Colin",
        puuid: "puuid-fresh-colin",
        championName: "JarvanIV",
        performanceSlice: "great",
        styleKey: "nekoryan",
        previousOutputText: "Obsolete generation must stay hidden.",
        outputText: "Colin made Cataclysm the enemy team's permanent address.",
      },
      {
        matchId: "NA1_E2E_FRESH_2",
        playerName: "Aaron",
        puuid: "puuid-fresh-aaron",
        championName: "Jhin",
        performanceSlice: "average",
        styleKey: "nekoryan",
        outputText: "Aaron counted to four and then invoiced the enemy team.",
      },
    ],
  });

  seedDataset(store, {
    key: "mobile-layout",
    name: "Mobile Layout",
    description: "Read-only responsive layout fixture.",
    finalized: true,
    cases: [
      {
        matchId: "NA1_E2E_MOBILE",
        playerName: "Mobile Player",
        puuid: "puuid-mobile",
        championName: "Braum",
        performanceSlice: "great",
        styleKey: "aaron",
        outputText: "Mobile Player put the entire match behind one shield.",
      },
    ],
  });
}

export function materializeEndToEndDraft(
  store: EvalStore,
  datasetId: string,
): { datasetId: string; caseIds: string[] } {
  const artifact = makeCaseArtifact({
    matchId: "NA1_E2E_UI_DRAFT",
    playerName: "Draft Player",
    puuid: "puuid-ui-draft",
    championName: "Taliyah",
    performanceSlice: "great",
    styleKey: "aaron",
  });
  return persistMaterializedDataset(store, { datasetId }, [
    {
      artifact,
      generation: {
        durationMs: 125,
        inputTokens: 70,
        model: "gpt-5.6-sol",
        outputText: "Draft Player turned every wall into a launch pad.",
        outputTokens: 25,
        promptRevision: "ui-draft-latest",
        renderedPrompts: artifact.context.renderedPrompts,
      },
    },
  ]);
}
