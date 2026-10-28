import assert from "node:assert/strict";
import { homedir } from "node:os";
import path from "node:path";
import {
  ManifestSchema,
  root,
  runDirectory,
  uuid,
  validate,
} from "../../tasks-for-obsidian/scripts/apple-sync-live/model.ts";

export type Operation =
  "present" | "probe" | "credentials" | "verification" | "vault";
export type PasswordManagerBackend = "service-account" | "desktop";
export type CredentialBackend = PasswordManagerBackend | "keychain";

export function credentialBackend(
  value: string | undefined,
): CredentialBackend {
  assert.ok(
    value === undefined ||
      value === "service-account" ||
      value === "desktop" ||
      value === "keychain",
  );
  return value ?? "keychain";
}

export function vaultPasswordBackend(
  value: string | undefined,
): PasswordManagerBackend {
  assert.ok(
    value === undefined || value === "service-account" || value === "desktop",
  );
  return value ?? "service-account";
}

export function parseArguments(args: string[]): {
  runID: string;
  operation: Operation;
  parameters: Record<string, string>;
  lifecycleRound: number | undefined;
} {
  const [run, operation, ...options] = args[0] === "--" ? args.slice(1) : args;
  const runID = uuid.parse(run).toLowerCase();
  assert.ok(
    operation === "present" ||
      operation === "probe" ||
      operation === "credentials" ||
      operation === "verification" ||
      operation === "vault",
  );
  if (operation === "probe") assert.equal(options.length, 0);
  const parameters: Record<string, string> = {};
  for (let index = 0; index < options.length; index += 2) {
    const key = options[index];
    const value = options[index + 1];
    assert.ok(key !== undefined && value !== undefined);
    assert.ok(
      [
        "--account",
        "--vault",
        "--item",
        "--vault-password-ref",
        "--credential-backend",
        "--vault-password-backend",
        "--lifecycle-round",
      ].includes(key),
    );
    assert.ok(!(key in parameters));
    assert.ok(
      value.length > 0 &&
        value.length <= 512 &&
        !/[\u0000-\u001f\u007f]/u.test(value),
    );
    parameters[key] = value;
  }
  const lifecycleValue = parameters["--lifecycle-round"];
  const lifecycleRound =
    lifecycleValue === undefined ? undefined : Number(lifecycleValue);
  if (lifecycleValue !== undefined) assert.match(lifecycleValue, /^[123]$/u);
  delete parameters["--lifecycle-round"];
  const backendKey =
    operation === "vault" ? "--vault-password-backend" : "--credential-backend";
  const otherBackendKey =
    operation === "vault" ? "--credential-backend" : "--vault-password-backend";
  assert.equal(parameters[otherBackendKey], undefined);
  if (operation === "present" || operation === "probe")
    assert.equal(parameters[backendKey], undefined);
  const backend =
    operation === "vault"
      ? vaultPasswordBackend(parameters[backendKey])
      : credentialBackend(parameters[backendKey]);
  if (operation === "verification")
    assert.equal(
      backend,
      "keychain",
      "Mac verification requires cached expiry-bearing OTP",
    );
  delete parameters[backendKey];
  if (operation === "credentials" || operation === "verification") {
    assert.deepEqual(Object.keys(parameters).sort(), [
      "--account",
      "--item",
      "--vault",
    ]);
    assert.ok(
      Object.values(parameters).every((value) =>
        /^[a-zA-Z0-9]{20,32}$/u.test(value),
      ),
    );
  } else if (operation === "vault") {
    assert.deepEqual(Object.keys(parameters), ["--vault-password-ref"]);
    assert.match(
      parameters["--vault-password-ref"] ?? "",
      /^op:\/\/[a-zA-Z0-9]{20,32}\/[a-zA-Z0-9]{20,32}\/password$/u,
    );
  } else assert.deepEqual(parameters, {});
  if (operation !== "present" && operation !== "probe")
    parameters[backendKey] = backend;
  return { runID, operation, parameters, lifecycleRound };
}

export function bindingFor(
  runID: string,
  value: unknown,
  descriptor: unknown,
  lifecycleRound?: number,
) {
  const manifest = ManifestSchema.parse(value);
  assert.equal(manifest.schemaVersion, 2);
  assert.ok(manifest.schemaVersion === 2 && manifest.scope === "macos");
  assert.equal(manifest.runID, runID);
  assert.equal(
    manifest.stage,
    lifecycleRound === undefined ? "bound" : "initial-verified",
  );
  if (lifecycleRound !== undefined) {
    assert.equal(manifest.round, lifecycleRound);
    assert.equal(manifest.cases["initial-download"], "pass");
    assert.equal(manifest.operations["lifecycle-begin:macos"], "pass");
    assert.equal(manifest.operations["lifecycle-finish:macos"], undefined);
  }
  assert.equal(manifest.failures.length, 0);
  assert.equal(manifest.cases["official-reference"], "pass");
  assert.ok(manifest.allowedRemoteVaultID !== null);
  validate("descriptor", descriptor);
  const container = path.join(
    homedir(),
    "Library/Containers/red.sjer.tasknotes.mac.acceptance/Data",
  );
  const stateDirectory = path.join(
    container,
    "Library/Application Support/FacetAcceptance",
    runID,
  );
  const client = {
    container,
    stateDirectory,
    descriptor: path.join(stateDirectory, "acceptance.json"),
  };
  assert.deepEqual(manifest.clients, { macos: client });
  assert.deepEqual(descriptor, {
    schemaVersion: 1,
    runID,
    stateDirectory,
    allowedRemoteVaultID: manifest.allowedRemoteVaultID,
  });
  return {
    runID,
    runDirectory: runDirectory(runID),
    container,
    stateDirectory,
    executable: path.join(
      runDirectory(runID),
      "macos/Build/Products/Debug/FacetAcceptance.app/Contents/MacOS/FacetAcceptance",
    ),
    remoteID: manifest.allowedRemoteVaultID,
  };
}

export function assertFreshInitialStatus(
  value: unknown,
  runID: string,
  now = Date.now(),
) {
  validate("status", value);
  assert.ok(
    typeof value === "object" && value !== null && !Array.isArray(value),
  );
  assert.ok(
    "runID" in value &&
      typeof value.runID === "string" &&
      uuid.parse(value.runID).toLowerCase() === runID.toLowerCase(),
  );
  assert.ok("capturedAt" in value && typeof value.capturedAt === "string");
  const age = now - Date.parse(value.capturedAt);
  assert.ok(age >= -1000 && age <= 5000);
  assert.ok(
    "profiles" in value &&
      Array.isArray(value.profiles) &&
      value.profiles.length === 0,
  );
  assert.ok("accountBusy" in value && value.accountBusy === false);
}

export function selectCredentials(
  value: unknown,
  itemID: string,
  vaultID: string,
) {
  assert.ok(
    typeof value === "object" && value !== null && !Array.isArray(value),
  );
  assert.ok("id" in value && value.id === itemID);
  assert.ok(
    "vault" in value &&
      typeof value.vault === "object" &&
      value.vault !== null &&
      "id" in value.vault &&
      value.vault.id === vaultID,
  );
  assert.ok("fields" in value && Array.isArray(value.fields));
  const fields: unknown[] = value.fields;
  function field(id: string, maximum: number) {
    const matches: unknown[] = fields.filter(
      (entry: unknown) =>
        typeof entry === "object" &&
        entry !== null &&
        "id" in entry &&
        entry.id === id,
    );
    assert.equal(matches.length, 1);
    const entry = matches[0];
    assert.ok(
      typeof entry === "object" &&
        entry !== null &&
        "value" in entry &&
        typeof entry.value === "string",
    );
    assertSecret(entry.value, maximum);
    assert.ok(
      !["********", "[concealed]", "<concealed>"].includes(entry.value),
    );
    return entry.value;
  }
  return { email: field("username", 256), password: field("password", 512) };
}

export function assertSecret(value: string, maximum: number) {
  assert.ok(
    value.length > 0 &&
      Buffer.byteLength(value) <= maximum &&
      !/[\u0000-\u001f\u007f]/u.test(value),
  );
}

export function classifyPasswordManagerFailure(stderr: string): string {
  const text = stderr.toLowerCase();
  for (const [label, pattern] of [
    [
      "missing_otp",
      /no one-time password|no otp|does not (?:contain|have) a one-time password/u,
    ],
    ["cancelled", /cancelled|canceled/u],
    [
      "locked",
      /1password (?:app )?is locked|desktop app is locked|unlock (?:the )?1password/u,
    ],
    [
      "integration_disabled",
      /(?:app integration|integration with the 1password app) is (?:disabled|not enabled)/u,
    ],
    ["not_signed_in", /not signed in/u],
    [
      "not_found",
      /(?:account|item) not found|could not find (?:an? )?(?:account|item)|no accounts configured/u,
    ],
    ["permission", /denied|not authorized|insufficient permissions|forbidden/u],
    ["timeout", /timed out|timeout|deadline exceeded/u],
    [
      "network",
      /network|connection refused|connection reset|no such host|could not resolve host|dial tcp|tls handshake/u,
    ],
    ["rate_limit", /rate limit|too many requests|(?:status|http) 429/u],
  ] as const)
    if (pattern.test(text)) return label;
  return "unknown";
}

export function childEnvironment(
  source: NodeJS.ProcessEnv,
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const key of [
    "PATH",
    "HOME",
    "TMPDIR",
    "DEVELOPER_DIR",
    "SDKROOT",
    "LANG",
    "USER",
    "LOGNAME",
  ])
    if (source[key] !== undefined) result[key] = source[key];
  return result;
}

export function exactPID(output: string, executable: string): number {
  const matches = output.split("\n").flatMap((line) => {
    const match = /^\s*([0-9]+)\s+(.+)$/u.exec(line);
    return match?.[2] === executable ? [Number(match[1])] : [];
  });
  assert.equal(matches.length, 1);
  const pid = matches[0];
  assert.ok(
    pid !== undefined &&
      Number.isSafeInteger(pid) &&
      pid > 0 &&
      pid <= 2_147_483_647,
  );
  return pid;
}

export { root, runDirectory };
