import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

/**
 * Windows CurrentUser DPAPI secret store.
 *
 * Win32 Credential Manager (`CredWriteW` / `Bun.secrets`) enforces a 2,560-byte
 * `CRED_MAX_CREDENTIAL_BLOB_SIZE` cap (too small for kubeconfig/Talos certs)
 * and fails with `ERROR_ACCESS_DENIED` inside restricted sandboxes. DPAPI
 * (`ProtectedData` with `DataProtectionScope.CurrentUser`) encrypts blobs to
 * the Windows user with no size ceiling, requires no binary code signing, and
 * works in both interactive and non-interactive sessions under the same user.
 *
 * Plaintext and ciphertext are passed over stdin/stdout only — never in CLI
 * arguments or environment variables.
 */

export type DpapiCodec = {
  protect: (plaintext: string) => Promise<string>;
  unprotect: (ciphertext: string) => Promise<string>;
};

export type WindowsSecretStoreOptions = {
  readonly rootDir?: string;
  readonly codec?: DpapiCodec;
};

const SAFE_SEGMENT = /^[\w.-]+$/;

const PROTECT_SCRIPT = [
  "$ErrorActionPreference = 'Stop'",
  "[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)",
  "[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)",
  "Add-Type -AssemblyName System.Security",
  "$plain = [Console]::In.ReadToEnd()",
  "$bytes = [System.Text.Encoding]::UTF8.GetBytes($plain)",
  "$protected = [System.Security.Cryptography.ProtectedData]::Protect($bytes, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)",
  "[Console]::Out.Write([Convert]::ToBase64String($protected))",
].join("; ");

const UNPROTECT_SCRIPT = [
  "$ErrorActionPreference = 'Stop'",
  "[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)",
  "[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)",
  "Add-Type -AssemblyName System.Security",
  "$encoded = [Console]::In.ReadToEnd().Trim()",
  "$bytes = [Convert]::FromBase64String($encoded)",
  "$plain = [System.Security.Cryptography.ProtectedData]::Unprotect($bytes, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)",
  "[Console]::Out.Write([System.Text.Encoding]::UTF8.GetString($plain))",
].join("; ");

export function defaultWindowsSecretsDir(
  env: Readonly<Record<string, string | undefined>> = Bun.env,
  home: string = os.homedir(),
): string {
  const localAppData = env["LOCALAPPDATA"];
  const base =
    localAppData !== undefined && localAppData.length > 0
      ? localAppData
      : path.join(home, "AppData", "Local");
  return path.join(base, "toolkit", "secrets");
}

export function sanitizeSecretSegment(segment: string, label: string): string {
  const trimmed = segment.trim();
  if (trimmed === "." || trimmed === ".." || trimmed.length === 0) {
    throw new Error(`toolkit: invalid Windows secret ${label}`);
  }
  const safe = SAFE_SEGMENT.test(trimmed)
    ? trimmed
    : trimmed.replaceAll(/[^\w.-]/g, "_");
  if (safe === "." || safe === "..") {
    throw new Error(`toolkit: invalid Windows secret ${label}`);
  }
  return safe;
}

export function windowsSecretFilePath(
  rootDir: string,
  options: { service: string; name: string },
): string {
  const service = sanitizeSecretSegment(options.service, "service");
  const name = sanitizeSecretSegment(options.name, "account");
  return path.join(rootDir, service, `${name}.dpapi`);
}

function errorCode(error: unknown): unknown {
  return error instanceof Error && "code" in error ? error.code : undefined;
}

async function runPowerShellCodec(
  script: string,
  stdinText: string,
  operation: "protect" | "unprotect",
): Promise<string> {
  const child = Bun.spawn(
    [
      "powershell.exe",
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      script,
    ],
    {
      stdin: new TextEncoder().encode(stdinText),
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  const [stdout, stderr, exit] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (exit !== 0) {
    const detail = stderr.trim().split(/\r?\n/u)[0] ?? `exit ${String(exit)}`;
    throw new Error(`toolkit: Windows DPAPI ${operation} failed: ${detail}`);
  }
  return stdout;
}

export const defaultWindowsDpapiCodec: DpapiCodec = {
  protect: (plaintext) =>
    runPowerShellCodec(PROTECT_SCRIPT, plaintext, "protect"),
  unprotect: (ciphertext) =>
    runPowerShellCodec(UNPROTECT_SCRIPT, ciphertext, "unprotect"),
};

export const SERVICE_ACCOUNT_KEYCHAIN_SERVICE =
  "monorepo-homelab-1password-service-account";

export const SERVICE_ACCOUNT_ENROLLMENT_MACOS =
  "swift scripts/onepassword/enroll-service-account.swift";

export const SERVICE_ACCOUNT_ENROLLMENT_WINDOWS =
  "pwsh scripts/onepassword/enroll-service-account.ps1";

export function serviceAccountEnrollment(platform: NodeJS.Platform): string {
  return platform === "win32"
    ? SERVICE_ACCOUNT_ENROLLMENT_WINDOWS
    : SERVICE_ACCOUNT_ENROLLMENT_MACOS;
}

export function workstationSecretEnrollment(
  service: string,
  ref: string,
  platform: NodeJS.Platform,
): string {
  return platform === "win32"
    ? `pwsh scripts/onepassword/enroll-workstation-secret.ps1 -Service ${service} -Ref ${ref}`
    : `swift scripts/onepassword/enroll-workstation-secret.swift --service ${service} --ref ${ref}`;
}

export function credentialError(
  name: string,
  description: string,
  enrollment: string,
): Error {
  return new Error(
    `toolkit: ${name} (${description}) is not set and could not be resolved. Enroll it with: ${enrollment}`,
  );
}

export function resolveWindowsSecretStore(options: {
  readonly explicitStore?:
    ReturnType<typeof createWindowsDpapiSecretStore> | null | undefined;
  readonly explicitPlatform?: NodeJS.Platform | undefined;
  readonly platform: NodeJS.Platform;
  readonly liveSubprocesses: boolean;
}): ReturnType<typeof createWindowsDpapiSecretStore> | null {
  if (options.explicitStore !== undefined) return options.explicitStore;
  const shouldUseWindowsStore =
    options.platform === "win32" &&
    (options.liveSubprocesses || options.explicitPlatform === "win32");
  return shouldUseWindowsStore ? createWindowsDpapiSecretStore() : null;
}

export async function readStoredSecret(options: {
  readonly service: string;
  readonly platform: NodeJS.Platform;
  readonly liveSubprocesses: boolean;
  readonly secretStore: ReturnType<typeof createWindowsDpapiSecretStore> | null;
  readonly run: (
    argv: string[],
    extraEnvironment?: Readonly<Record<string, string>>,
  ) => Promise<{ exit: number; stdout: string; stderr: string }>;
}): Promise<string | null> {
  if (options.secretStore !== null) {
    const raw = await options.secretStore.get({
      service: options.service,
      name: os.userInfo().username,
    });
    const value = raw?.trim() ?? "";
    return value.length > 0 ? value : null;
  }
  if (options.liveSubprocesses && options.platform !== "darwin") {
    throw new Error(
      `toolkit: Keychain credential ${options.service} requires macOS or Windows DPAPI; on other hosts set the variable or use a config op:// override.`,
    );
  }
  const result = await options.run([
    "security",
    "find-generic-password",
    "-a",
    os.userInfo().username,
    "-s",
    options.service,
    "-w",
  ]);
  if (result.exit !== 0) return null;
  const value = result.stdout.trim();
  return value.length > 0 ? value : null;
}

export function createWindowsDpapiSecretStore(
  options: WindowsSecretStoreOptions = {},
): {
  get: (target: { service: string; name: string }) => Promise<string | null>;
  set: (target: {
    service: string;
    name: string;
    value: string;
  }) => Promise<void>;
  delete: (target: { service: string; name: string }) => Promise<boolean>;
} {
  const rootDir = options.rootDir ?? defaultWindowsSecretsDir();
  const codec = options.codec ?? defaultWindowsDpapiCodec;
  return {
    async get(target) {
      const filePath = windowsSecretFilePath(rootDir, target);
      let raw: string;
      try {
        raw = await readFile(filePath, "utf8");
      } catch (error) {
        if (errorCode(error) === "ENOENT") return null;
        throw error;
      }
      const encoded = raw.trim();
      return encoded.length === 0 ? null : codec.unprotect(encoded);
    },
    async set(target) {
      const filePath = windowsSecretFilePath(rootDir, target);
      await mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
      const encoded = await codec.protect(target.value);
      const tempPath = `${filePath}.${randomUUID()}.tmp`;
      await writeFile(tempPath, `${encoded}\n`, {
        encoding: "utf8",
        mode: 0o600,
      });
      await rename(tempPath, filePath);
    },
    async delete(target) {
      const filePath = windowsSecretFilePath(rootDir, target);
      try {
        await rm(filePath);
        return true;
      } catch (error) {
        if (errorCode(error) === "ENOENT") return false;
        throw error;
      }
    },
  };
}
