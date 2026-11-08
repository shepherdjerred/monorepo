import path from "node:path";
import { z } from "zod";
import { ManifestSchema, runDirectory, uuid, type Manifest } from "../model";
import { command, save } from "../platform";
import { fingerprintApp, prepareNativeClients } from "../prepare";
import { prepareGuestLiveRun } from "../transport/execution/host";

export type PreparationScope = "apple" | "macos";
export type OfficialAppInput = { exportID: string; archiveSHA256: string };

export function parsePreparationArguments(args: string[]): PreparationScope {
  if (args.length === 0) return "apple";
  z.tuple([z.literal("--clients"), z.literal("macos")]).parse(args);
  return "macos";
}

export function parseExecutionArguments(args: string[]) {
  const values = [...args];
  const take = (key: string) => {
    const position = values.indexOf(key);
    if (position === -1) return;
    const value = z.string().parse(values[position + 1]);
    values.splice(position, 2);
    return value;
  };
  const vm = z
    .string()
    .regex(/^[A-Za-z0-9][\w.-]{0,63}$/u)
    .optional()
    .parse(take("--vm"));
  const manual = values.includes("--host-ui");
  if (manual) values.splice(values.indexOf("--host-ui"), 1);
  if ((vm === undefined) === !manual)
    throw new Error("Choose exactly --vm <running-VM> or explicit --host-ui");
  const exportID = take("--official-export");
  const archiveSHA256 = take("--official-sha256");
  const officialApp =
    vm === undefined
      ? undefined
      : {
          exportID: uuid.parse(exportID),
          archiveSHA256: z
            .string()
            .regex(/^[a-f0-9]{64}$/u)
            .parse(archiveSHA256),
        };
  if (
    vm === undefined &&
    (exportID !== undefined || archiveSHA256 !== undefined)
  )
    throw new Error(
      "Official app exports are only supported for guest execution",
    );
  return { scope: parsePreparationArguments(values), vm, officialApp };
}

export async function prepareGuestClients(
  manifest: Manifest,
  options: {
    scope: PreparationScope;
    vm: string;
    sourceFiles: Record<string, string>;
    runnerIdentity: string | undefined;
    officialApp: OfficialAppInput | undefined;
  },
) {
  const { scope, vm, sourceFiles, runnerIdentity, officialApp } = options;
  if (officialApp === undefined)
    throw new Error(
      "Guest preparation requires an explicitly pinned official app export",
    );
  const guest = await prepareGuestLiveRun({
    vm,
    runID: manifest.runID,
    scope,
    seedDirectory: path.join(runDirectory(manifest.runID), "reference-vault"),
    ...(runnerIdentity === undefined ? {} : { runnerIdentity }),
    sourceFiles,
    officialApp,
  });
  const prepared = ManifestSchema.parse({
    ...manifest,
    schemaVersion: 3,
    scope,
    execution: guest.execution,
    clients: scope === "apple" ? null : { macos: guest.macos },
  });
  let iosApp: string | undefined;
  if (scope === "apple") {
    prepared.clients = {
      macos: guest.macos,
      ios: { container: "", descriptor: "", stateDirectory: "" },
    };
    ({ iosApp } = await prepareNativeClients(
      prepared,
      command,
      save,
      runnerIdentity,
    ));
  }
  await save(prepared);
  return { manifest: prepared, iosApp, macApp: guest.macApp };
}

export async function preparedScopeProvenance(
  manifest: Manifest,
  macApp: string,
  iosApp: string | undefined,
) {
  if (manifest.schemaVersion === 3)
    return {
      schemaVersion: 3,
      scope: manifest.scope,
      execution: manifest.execution,
      macAppDirectory: macApp,
      ...(iosApp === undefined ? {} : { iosApp: await fingerprintApp(iosApp) }),
    };
  if (manifest.schemaVersion === 2)
    return { schemaVersion: 2, scope: manifest.scope };
  if (iosApp === undefined) throw new Error("Missing built iOS artifact");
  return { schemaVersion: 1, iosApp: await fingerprintApp(iosApp) };
}
