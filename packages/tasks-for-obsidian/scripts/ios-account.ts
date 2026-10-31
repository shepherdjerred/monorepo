import { z } from "zod";
import { readManifest } from "./apple-sync-live/platform";
import {
  IOSAccountOptionsSchema,
  IOSVaultOptionsSchema,
  runIosAccountAuthentication,
} from "./ios-account/authenticate";
import { runIosAuthOnly } from "./ios-account/phases/auth-host";
import { runIosConnectOnly } from "./ios-account/phases/connect-host";
import { runIosAccountProbe } from "./ios-account/probe";
import { PasswordManagerFailure } from "./apple-sync-live/transport/execution/credential-host";

function parseOptions(args: string[], vaultOnly = false) {
  const options: Record<string, string> = {};
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index],
      value = args[index + 1];
    if (key === undefined || value === undefined || key in options)
      throw new Error("Specify each nonsecret account locator once");
    const allowed = vaultOnly
      ? [
          "--vault-password-ref",
          "--vault-password-backend",
          "--lifecycle-round",
        ]
      : [
          "--account",
          "--vault",
          "--item",
          "--vault-password-ref",
          "--credential-backend",
          "--vault-password-backend",
          "--lifecycle-round",
        ];
    if (!allowed.includes(key))
      throw new Error("Unsupported private account option");
    options[key] = value;
  }
  return options;
}
export function parseIosVaultOptions(args: string[]) {
  const options = parseOptions(args, true);
  return IOSVaultOptionsSchema.parse({
    vaultPasswordRef: options["--vault-password-ref"],
    vaultPasswordBackend: options["--vault-password-backend"],
    ...(options["--lifecycle-round"] === undefined
      ? {}
      : { lifecycleRound: Number(options["--lifecycle-round"]) }),
  });
}
export function parseIosCredentialOptions(args: string[]) {
  const options = parseOptions(args);
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
  if (operation === "connect-only") {
    console.log(
      JSON.stringify(
        await runIosConnectOnly(manifest, parseIosVaultOptions(args)),
      ),
    );
    return;
  }
  if (operation !== "credentials" && operation !== "auth-only")
    throw new Error("Choose probe, credentials, auth-only or connect-only");
  console.log(
    JSON.stringify(
      await (
        operation === "auth-only" ? runIosAuthOnly : runIosAccountAuthentication
      )(manifest, parseIosCredentialOptions(args)),
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
