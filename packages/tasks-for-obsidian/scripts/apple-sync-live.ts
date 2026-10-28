import { mkdir } from "node:fs/promises";
import { z } from "zod";
import {
  runs,
  clients,
  validate,
  type Manifest,
  activeClients,
} from "./apple-sync-live/model";
import {
  readManifest,
  bindVault,
  launch,
  resume,
  cleanup,
  statuses,
} from "./apple-sync-live/platform";
import {
  prepare,
  sealReference,
  parseExecutionArguments,
} from "./apple-sync-live/prepare";
import { control, verify } from "./apple-sync-live/native";
import {
  journeys,
  referenceChanges,
  offline,
} from "./apple-sync-live/journeys";
import {
  conflicts,
  lifecycleBegin,
  lifecycleFinish,
} from "./apple-sync-live/recovery";
import { authenticationFixtures } from "./apple-sync-live/authentication";
import { completeRound, guardedStage } from "./apple-sync-live/ledger";
import {
  officialInstructions,
  officialSteps,
  officialUI,
} from "./apple-sync-live/official-ui";

type Handler = (manifest: Manifest, arguments_: string[]) => Promise<void>;

function withoutArguments(
  action: (manifest: Manifest) => Promise<void> | void,
): Handler {
  return async (manifest, args) => {
    z.tuple([]).parse(args);
    await action(manifest);
  };
}

async function discover(manifest: Manifest) {
  if (manifest.allowedRemoteVaultID !== null)
    throw new Error("Discovery requires an unbound prepared run");
  await launch(manifest, true);
  console.log(
    "Sign in manually with recording off. Locate only the synthetic vault; authorization is disabled until bind-vault.",
  );
}

async function reportStatus(manifest: Manifest) {
  console.log(
    JSON.stringify(
      {
        runID: manifest.runID,
        selectedClients: activeClients(manifest),
        replicaCount: activeClients(manifest).length + 1,
        round: manifest.round,
        stage: manifest.stage,
        cases: manifest.cases,
        failures: manifest.failures,
        completedRounds: manifest.completedRounds,
      },
      null,
      2,
    ),
  );
  if (manifest.clients === null || manifest.stage === "cleaned") return;
  for (const entry of await statuses(manifest)) {
    validate("status", entry.value);
    console.log(JSON.stringify(entry, null, 2));
  }
}

const handlers: Record<string, Handler> = {
  "bind-vault": async (manifest, args) => {
    await bindVault(manifest, z.tuple([z.string()]).parse(args)[0]);
  },
  "seal-reference": withoutArguments(sealReference),
  discover: withoutArguments(discover),
  resume: withoutArguments(resume),
  verify: withoutArguments(verify),
  "reference-changes": withoutArguments(referenceChanges),
  journeys: withoutArguments(journeys),
  offline: withoutArguments(offline),
  conflicts: withoutArguments(conflicts),
  "lifecycle-begin": async (manifest, args) => {
    await lifecycleBegin(manifest, z.tuple([clients]).parse(args)[0]);
  },
  "lifecycle-finish": async (manifest, args) => {
    await lifecycleFinish(manifest, z.tuple([clients]).parse(args)[0]);
  },
  "authentication-fixtures": withoutArguments(authenticationFixtures),
  "official-ui-instructions": withoutArguments(officialInstructions),
  "official-ui": async (manifest, args) => {
    await officialUI(manifest, z.tuple([officialSteps]).parse(args)[0]);
  },
  "complete-round": withoutArguments(completeRound),
  status: withoutArguments(reportStatus),
  control: async (manifest, args) => {
    const [client, kind, profileID] = z
      .tuple([
        clients,
        z.enum(["refresh", "interrupt", "resume"]),
        z.string().optional(),
      ])
      .parse(args);
    await control(manifest, client, kind, profileID);
  },
  cleanup: withoutArguments(cleanup),
};
const evidenceStages = new Set([
  "seal-reference",
  "verify",
  "reference-changes",
  "journeys",
  "offline",
  "conflicts",
  "lifecycle-begin",
  "lifecycle-finish",
  "authentication-fixtures",
  "official-ui",
  "complete-round",
]);

async function main() {
  if (process.platform !== "darwin")
    throw new Error("Apple live acceptance requires macOS and Xcode");
  const raw = Bun.argv.slice(2);
  const [operation, runID, ...arguments_] = raw.filter(
    (argument) => argument !== "--host-ui",
  );
  if (operation === undefined)
    throw new Error("Specify a live acceptance stage");
  if (operation === "prepare") {
    const { scope, vm, officialApp, referenceArchive } =
      parseExecutionArguments(raw.slice(1));
    await mkdir(runs, { recursive: true, mode: 0o700 });
    await prepare(scope, vm, officialApp, referenceArchive);
    return;
  }
  if (runID === undefined)
    throw new Error(`Specify a runID for: ${Object.keys(handlers).join(", ")}`);
  const manifest = await readManifest(runID);
  if (manifest.schemaVersion !== 3 && !raw.includes("--host-ui"))
    throw new Error(
      "Legacy live runs require explicit --host-ui; automated acceptance uses --vm",
    );
  if (manifest.schemaVersion === 3 && raw.includes("--host-ui"))
    throw new Error("A guest run cannot fall back to host UI");
  const handler = handlers[operation];
  if (handler === undefined) throw new Error("Unknown live acceptance stage");
  if (!evidenceStages.has(operation)) {
    await handler(manifest, arguments_);
    return;
  }
  const key = [operation, ...arguments_].join(":");
  await guardedStage(manifest, key, async () => {
    await handler(manifest, arguments_);
  });
}

if (import.meta.main) await main();
