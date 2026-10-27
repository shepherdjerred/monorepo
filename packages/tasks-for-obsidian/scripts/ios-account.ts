import { z } from "zod";
import { readManifest } from "./apple-sync-live/platform";
import {
  IOSAccountOptionsSchema,
  runIosAccountAuthentication,
} from "./ios-account/authenticate";
import { runIosAccountProbe } from "./ios-account/probe";
import { PasswordManagerFailure } from "./apple-sync-live/transport/execution/credential-host";

export function parseIosCredentialOptions(args: string[]) {
  const options: Record<string, string> = {};
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index],
      value = args[index + 1];
    if (key === undefined || value === undefined || key in options)
      throw new Error("Specify each nonsecret account locator once");
    if (
      ![
        "--account",
        "--vault",
        "--item",
        "--vault-password-ref",
        "--credential-backend",
        "--vault-password-backend",
        "--lifecycle-round",
      ].includes(key)
    )
      throw new Error("Unsupported private account option");
    options[key] = value;
  }
  return IOSAccountOptionsSchema.parse({
    account: options["--account"],
    vault: options["--vault"],
    item: options["--item"],
    credentialBackend: options["--credential-backend"],
    vaultPasswordRef: options["--vault-password-ref"],
    vaultPasswordBackend: options["--vault-password-backend"],
    ...(options["--lifecycle-round"] === undefined
      ? {}
      : { lifecycleRound: Number(options["--lifecycle-round"]) }),
  });
}

async function main() {
  const [runID, operation, ...args] = Bun.argv.slice(2);
  z.uuid().parse(runID);
  const manifest = await readManifest(z.string().parse(runID));
  if (manifest.schemaVersion !== 3 || manifest.scope !== "apple")
    throw new Error(
      "Private iOS input requires an explicit dual-client guest live run",
    );
  if (operation === "probe") {
    z.tuple([]).parse(args);
    console.log(JSON.stringify(await runIosAccountProbe(manifest)));
    return;
  }
  if (operation !== "credentials")
    throw new Error("Choose probe or credentials");
  console.log(
    JSON.stringify(
      await runIosAccountAuthentication(
        manifest,
        parseIosCredentialOptions(args),
      ),
    ),
  );
}

if (import.meta.main) {
  try {
    await main();
  } catch (error) {
    // SDK and password-manager diagnostics remain private, including on failure.
    console.error(
      JSON.stringify({
        status: "blocked",
        reason:
          error instanceof PasswordManagerFailure
            ? error.classification
            : "private-input-or-authentication",
        automaticRetry: false,
      }),
    );
    process.exitCode = 1;
  }
}
