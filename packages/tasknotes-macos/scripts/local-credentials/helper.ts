import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  linkSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmdirSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { userInfo } from "node:os";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { childEnvironment } from "../mac-account-contract.ts";
import { LocalCredentialFailure, maximumCredentialBytes } from "./payload.ts";

export const helperSigning = {
  identity: "C445EC1DD505AB262B88427771DCF284D43B613C",
  team: "63ZAG7X889",
  identifier: "red.sjer.facet.acceptance.credentials",
} as const;
const sourceNames = ["LocalCredentialStore.swift", "main.swift"];
const sourceRoot = path.join(import.meta.dir, "native");
export function helperPaths() {
  const account = userInfo();
  if (account.uid !== process.getuid?.() || account.uid === 0) fail("owner");
  const directory = path.join(
    account.homedir,
    "Library/Application Support/FacetAcceptanceCredentials",
  );
  return {
    directory,
    bin: path.join(directory, "bin"),
    executable: path.join(directory, "bin/facet-credentials"),
    receipt: path.join(directory, "installation.json"),
  };
}
function fail(reason: string): never {
  throw new LocalCredentialFailure(`local_credentials_helper_${reason}`);
}
function digest(bytes: Uint8Array) {
  return new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
}
function owned(file: string, directory: boolean, privateMode = false) {
  const value = lstatSync(file);
  if (
    value.isSymbolicLink() ||
    value.uid !== process.getuid?.() ||
    (directory ? !value.isDirectory() : !value.isFile()) ||
    (value.mode & 0o022) !== 0 ||
    (privateMode && (value.mode & 0o077) !== 0) ||
    realpathSync(file) !== file
  )
    fail("owner");
  return value;
}
function sourceInventory() {
  return Object.fromEntries(
    sourceNames.map((name) => {
      const file = path.join(sourceRoot, name);
      owned(file, false);
      return [name, digest(readFileSync(file))];
    }),
  );
}
export type HelperCommand = (argv: string[]) => {
  status: number | null;
  stdout: string;
  stderr: string;
};
const runCommand: HelperCommand = (argv) => {
  const result = spawnSync(argv[0] ?? "", argv.slice(1), {
    env: childEnvironment(process.env),
    timeout: 60_000,
    maxBuffer: 1_048_576,
    encoding: "utf8",
  });
  if (result.error || result.signal) fail("tooling");
  return result;
};
function requireCommand(argv: string[], run: HelperCommand) {
  if (run(argv).status !== 0) fail("signature_or_tooling");
}
export function signatureRequirement() {
  return `=identifier "${helperSigning.identifier}" and certificate leaf = H"${helperSigning.identity}" and certificate leaf[subject.OU] = "${helperSigning.team}"`;
}
export function requireHelperProvenance(
  value: unknown,
  expected: {
    schemaVersion: number;
    kind: string;
    identity: string;
    team: string;
    identifier: string;
    compilerVersion: string;
    helperSHA256: string;
    sourceFiles: Record<string, string>;
  },
) {
  if (!isDeepStrictEqual(value, expected)) fail("provenance");
}
export function verifyInstalledHelper(run: HelperCommand = runCommand) {
  try {
    if (process.platform !== "darwin") fail("platform");
    const selected = helperPaths();
    owned(selected.directory, true, true);
    owned(selected.bin, true, true);
    const metadata = owned(selected.executable, false, true);
    if ((metadata.mode & 0o100) === 0) fail("owner");
    const receiptMetadata = owned(selected.receipt, false, true);
    if (receiptMetadata.size > maximumCredentialBytes) fail("provenance");
    const receipt: unknown = JSON.parse(readFileSync(selected.receipt, "utf8"));
    if (
      typeof receipt !== "object" ||
      receipt === null ||
      !("compilerVersion" in receipt) ||
      typeof receipt.compilerVersion !== "string" ||
      !receipt.compilerVersion.includes("Apple Swift version ") ||
      receipt.compilerVersion.length > 4096
    )
      fail("provenance");
    const expected = {
      schemaVersion: 1,
      kind: "facet-local-credential-helper",
      ...helperSigning,
      compilerVersion: receipt.compilerVersion,
      helperSHA256: digest(readFileSync(selected.executable)),
      sourceFiles: sourceInventory(),
    };
    requireHelperProvenance(receipt, expected);
    requireCommand(
      [
        "/usr/bin/codesign",
        "--verify",
        "--strict",
        "--test-requirement",
        signatureRequirement(),
        selected.executable,
      ],
      run,
    );
    // Signature checking is read-only. Rebind the same file before a credential operation.
    const after = owned(selected.executable, false, true);
    if (
      after.dev !== metadata.dev ||
      after.ino !== metadata.ino ||
      after.size !== metadata.size ||
      after.mtimeMs !== metadata.mtimeMs ||
      digest(readFileSync(selected.executable)) !== expected.helperSHA256
    )
      fail("changed");
    return selected.executable;
  } catch (error) {
    if (error instanceof LocalCredentialFailure) throw error;
    fail("not_installed_or_invalid");
  }
}
/** Explicit setup only; credential reads never build, sign, repair ACLs or enroll. */
export function installLocalHelper(
  identity: string,
  team: string,
  run: HelperCommand = runCommand,
) {
  if (identity !== helperSigning.identity || team !== helperSigning.team)
    fail("signing_identity");
  if (process.platform !== "darwin") fail("platform");
  const selected = helperPaths();
  if (existsSync(selected.executable) || existsSync(selected.receipt)) {
    verifyInstalledHelper(run);
    return { status: "already-installed", executable: selected.executable };
  }
  for (const directory of [selected.directory, selected.bin]) {
    if (!existsSync(directory)) mkdirSync(directory, { mode: 0o700 });
    owned(directory, true, true);
  }
  const inputs = sourceInventory();
  const temporary = path.join(
    selected.directory,
    ".install-" + crypto.randomUUID(),
  );
  mkdirSync(temporary, { mode: 0o700 });
  const executable = path.join(temporary, "facet-credentials");
  let published = false;
  try {
    const compiler = run(["/usr/bin/xcrun", "swiftc", "--version"]);
    if (
      compiler.status !== 0 ||
      !compiler.stdout.includes("Apple Swift version ") ||
      compiler.stdout.length > 4096
    )
      fail("compiler");
    requireCommand(
      [
        "/usr/bin/xcrun",
        "swiftc",
        "-swift-version",
        "6",
        ...sourceNames.map((name) => path.join(sourceRoot, name)),
        "-o",
        executable,
      ],
      run,
    );
    chmodSync(executable, 0o700);
    requireCommand(
      [
        "/usr/bin/codesign",
        "--force",
        "--sign",
        identity,
        "--identifier",
        helperSigning.identifier,
        executable,
      ],
      run,
    );
    requireCommand(
      [
        "/usr/bin/codesign",
        "--verify",
        "--strict",
        "--test-requirement",
        signatureRequirement(),
        executable,
      ],
      run,
    );
    if (JSON.stringify(sourceInventory()) !== JSON.stringify(inputs))
      fail("source_changed");
    const receipt = {
      schemaVersion: 1,
      kind: "facet-local-credential-helper",
      ...helperSigning,
      compilerVersion: compiler.stdout,
      helperSHA256: digest(readFileSync(executable)),
      sourceFiles: inputs,
    };
    linkSync(executable, selected.executable);
    published = true;
    writeFileSync(selected.receipt, JSON.stringify(receipt), {
      flag: "wx",
      mode: 0o600,
    });
    verifyInstalledHelper(run);
  } catch (error) {
    if (published && !existsSync(selected.receipt))
      unlinkSync(selected.executable);
    if (error instanceof LocalCredentialFailure) throw error;
    fail("installation");
  } finally {
    if (existsSync(executable)) unlinkSync(executable);
    rmdirSync(temporary);
  }
  return { status: "installed", executable: selected.executable };
}
