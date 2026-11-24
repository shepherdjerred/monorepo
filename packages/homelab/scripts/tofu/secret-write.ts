import { spawn } from "node:child_process";
import { parseArgs } from "node:util";
import { z } from "zod";
import {
  OpItemSchema,
  VAULT_ID,
  type OpItem,
} from "#cdk8s/scripts/onepassword-lib.ts";
import {
  CredentialTargetSchema,
  type CredentialTarget,
} from "./application-secrets.ts";
import {
  applyTargetUpdateToTemplate,
  capturedRead,
  parsePrivateJson,
  RawOpItemSchema,
  readVaultItem,
  resolveItemTargetValue,
  type RawOpItem,
} from "./secret-read.ts";

const repositoryRoot = new URL("../../../../", import.meta.url).pathname;
const ALLOWED_OP_ENV_KEYS = [
  "PATH",
  "HOME",
  "TMPDIR",
  "USER",
  "LOGNAME",
  "OP_SERVICE_ACCOUNT_TOKEN",
  "OP_ACCOUNT",
  "OP_CONFIG_DIR",
  "HTTPS_PROXY",
  "HTTP_PROXY",
  "NO_PROXY",
  "SSL_CERT_FILE",
  "SSL_CERT_DIR",
] as const;

export type SecretFieldWrite = {
  unit?: string;
  target: CredentialTarget;
  value: string;
};
export type SecretWriteReportEntry = {
  unit: string | null;
  target: CredentialTarget;
  resolved_item_id: string;
  dry_run: boolean;
  changed: boolean;
  verified_readback: boolean;
};

function isolatedOpEnvironment(
  env: Record<string, string | undefined>,
): NodeJS.ProcessEnv {
  if (
    (env["OP_SERVICE_ACCOUNT_TOKEN"] ?? "") === "" &&
    (env["OP_ACCOUNT"] ?? "") === ""
  ) {
    throw new Error(
      "1Password write requires OP_SERVICE_ACCOUNT_TOKEN (via scripts/onepassword/with-service-account.sh) or OP_ACCOUNT.",
    );
  }
  const isolated: NodeJS.ProcessEnv = {};
  for (const key of ALLOWED_OP_ENV_KEYS) {
    const value = env[key];
    if (value !== undefined && value !== "") isolated[key] = value;
  }
  return isolated;
}

async function readRawVaultItem(
  id: string,
  vaultId: string,
  env: Record<string, string | undefined>,
): Promise<RawOpItem> {
  const item = parsePrivateJson(
    await capturedRead(
      [
        `${repositoryRoot}/scripts/onepassword/with-service-account.sh`,
        "op",
        "--cache=false",
        "item",
        "get",
        id,
        "--vault",
        vaultId,
        "--format",
        "json",
      ],
      "1Password item template",
      env,
    ),
    RawOpItemSchema,
  );
  if (item.vault !== undefined && item.vault.id !== vaultId) {
    throw new Error("1Password returned an item from a different vault.");
  }
  return { ...item, vault: { ...item.vault, id: vaultId } };
}

/**
 * Updates a 1Password item via `node:child_process.spawn` and `/dev/fd/3` so
 * `op` reads an explicit template descriptor instead of checking `os.ModeNamedPipe`
 * against `Bun.spawn`'s `S_IFSOCK` stdin.
 */
export async function editVaultItemTemplate(options: {
  itemId: string;
  vaultId?: string;
  template: RawOpItem;
  dryRun?: boolean;
  timeoutMs?: number;
  env?: Record<string, string | undefined>;
}): Promise<OpItem> {
  const vaultId = options.vaultId ?? VAULT_ID;
  const dryRun = options.dryRun ?? false;
  const timeoutMs = options.timeoutMs ?? 20_000;
  const env = isolatedOpEnvironment(options.env ?? Bun.env);
  const opExecutable = Bun.which("op", { PATH: env["PATH"] ?? "" }) ?? "op";
  const args = [
    "--cache=false",
    "item",
    "edit",
    options.itemId,
    "--vault",
    vaultId,
    ...(dryRun ? ["--dry-run"] : []),
    "--template",
    "/dev/fd/3",
    "--format",
    "json",
  ];

  const child = spawn(opExecutable, args, {
    cwd: repositoryRoot,
    env,
    stdio: ["ignore", "pipe", "pipe", "pipe"],
  });

  const input = child.stdio[3];
  if (!input || !("end" in input)) {
    child.kill("SIGKILL");
    throw new Error("Credential template pipe is unavailable.");
  }
  input.on("error", () => {
    // Suppress broken-pipe errors; non-zero exit handles failure.
  });
  input.end(JSON.stringify(options.template));

  let output = "";
  child.stdout?.setEncoding("utf8");
  child.stdout?.on("data", (chunk: string) => {
    output += chunk;
  });
  child.stderr?.resume();

  const timer = setTimeout(() => {
    child.kill("SIGKILL");
  }, timeoutMs);
  timer.unref();

  let exitCode: number | null;
  try {
    exitCode = await new Promise<number | null>((resolve, reject) => {
      child.once("close", (code) => {
        resolve(code);
      });
      child.once("error", () => {
        reject(new Error("spawn_failed"));
      });
    });
  } catch {
    throw new Error(
      "1Password template update failed; no credential values were logged.",
    );
  } finally {
    clearTimeout(timer);
  }

  if (exitCode !== 0) {
    throw new Error(
      "1Password template update failed; no credential values were logged.",
    );
  }
  const edited = parsePrivateJson(output, OpItemSchema);
  if (edited.vault !== undefined && edited.vault.id !== vaultId) {
    throw new Error("1Password returned an item from a different vault.");
  }
  return { ...edited, vault: { ...edited.vault, id: vaultId } };
}

type ItemWriteGroup = {
  template: RawOpItem;
  entries: { write: SecretFieldWrite; changed: boolean }[];
};

function assertItemMatchesWrites(
  item: OpItem,
  itemId: string,
  entries: readonly { write: SecretFieldWrite; changed: boolean }[],
  errorMessage: string,
): void {
  for (const { write } of entries) {
    const canonical = { ...write.target, vault_item_id: itemId };
    if (resolveItemTargetValue([item], canonical) !== write.value)
      throw new Error(errorMessage);
  }
}

async function buildItemWriteGroups(
  writes: readonly SecretFieldWrite[],
  vaultId: string,
  env: Record<string, string | undefined>,
): Promise<Map<string, ItemWriteGroup>> {
  const rawByRef = new Map<string, RawOpItem>();
  for (const write of writes) {
    if (write.value.length === 0)
      throw new Error("Refusing to write an empty credential value.");
    if (!rawByRef.has(write.target.vault_item_id)) {
      rawByRef.set(
        write.target.vault_item_id,
        await readRawVaultItem(write.target.vault_item_id, vaultId, env),
      );
    }
  }

  const groups = new Map<string, ItemWriteGroup>();
  const seenTargets = new Set<string>();
  for (const write of writes) {
    const rawItem = rawByRef.get(write.target.vault_item_id);
    if (rawItem === undefined)
      throw new Error("Unable to resolve 1Password item for target.");
    const key = JSON.stringify([
      rawItem.id,
      write.target.vault_section_id ?? null,
      write.target.vault_field_id ?? null,
      write.target.vault_field,
      write.target.vault_json_path ?? null,
    ]);
    if (seenTargets.has(key))
      throw new Error("Duplicate credential write target in single batch.");
    seenTargets.add(key);

    let group = groups.get(rawItem.id);
    if (group === undefined) {
      group = { template: structuredClone(rawItem), entries: [] };
      groups.set(rawItem.id, group);
    }
    const changed = applyTargetUpdateToTemplate(
      group.template,
      write.target,
      write.value,
    );
    group.entries.push({ write, changed });
  }
  return groups;
}

export async function writeSecretTargets(
  writes: readonly SecretFieldWrite[],
  options?: {
    vaultId?: string;
    dryRun?: boolean;
    timeoutMs?: number;
    env?: Record<string, string | undefined>;
    readItem?: (id: string, vaultId: string) => Promise<OpItem>;
  },
): Promise<SecretWriteReportEntry[]> {
  if (writes.length === 0)
    throw new Error("No credential targets selected for write.");
  const vaultId = options?.vaultId ?? VAULT_ID;
  const dryRun = options?.dryRun ?? false;
  const env = options?.env ?? Bun.env;
  const readBack =
    options?.readItem ?? ((id: string, v: string) => readVaultItem(id, v));

  isolatedOpEnvironment(env);
  const groups = await buildItemWriteGroups(writes, vaultId, env);
  const report: SecretWriteReportEntry[] = [];

  for (const [itemId, group] of groups) {
    assertItemMatchesWrites(
      OpItemSchema.parse(group.template),
      itemId,
      group.entries,
      "Prepared 1Password template failed target consistency check.",
    );
    const edited = await editVaultItemTemplate({
      itemId,
      vaultId,
      template: group.template,
      dryRun,
      env,
      ...(options?.timeoutMs === undefined
        ? {}
        : { timeoutMs: options.timeoutMs }),
    });
    assertItemMatchesWrites(
      edited,
      itemId,
      group.entries,
      "1Password did not accept the intended credential field update.",
    );
    if (!dryRun) {
      assertItemMatchesWrites(
        await readBack(itemId, vaultId),
        itemId,
        group.entries,
        "Independent 1Password readback did not match intended credential update.",
      );
    }
    for (const { write, changed } of group.entries) {
      report.push({
        unit: write.unit ?? null,
        target: write.target,
        resolved_item_id: itemId,
        dry_run: dryRun,
        changed,
        verified_readback: !dryRun,
      });
    }
  }
  return report;
}

async function readSecretFromStdin(): Promise<string> {
  if (process.stdin.isTTY) {
    throw new Error(
      "Pipe the replacement secret on standard input; interactive TTY input and CLI value arguments are disabled.",
    );
  }
  const raw = await new Response(Bun.stdin.stream()).text();
  const trimmed = raw.replace(/\r?\n$/u, "");
  if (trimmed.length === 0)
    throw new Error("Standard input contained an empty credential value.");
  return trimmed;
}

export async function runSecretWriteCli(
  rawArgs: readonly string[],
  options?: {
    readSecret?: () => Promise<string>;
    env?: Record<string, string | undefined>;
  },
): Promise<SecretWriteReportEntry[]> {
  let parsedArgs: ReturnType<typeof parseArgs>;
  try {
    parsedArgs = parseArgs({
      args: [...rawArgs],
      strict: true,
      allowPositionals: false,
      options: {
        item: { type: "string" },
        field: { type: "string" },
        section: { type: "string" },
        "field-id": { type: "string" },
        "json-path": { type: "string" },
        vault: { type: "string" },
        "dry-run": { type: "boolean", default: false },
      },
    });
  } catch {
    throw new Error("Invalid secret-write arguments.");
  }
  const item = z.string().min(1).safeParse(parsedArgs.values["item"]);
  const field = z.string().min(1).safeParse(parsedArgs.values["field"]);
  if (!item.success || !field.success) {
    throw new Error(
      "Usage: secret-write.ts --item <id> --field <label> [--dry-run] < secret",
    );
  }
  const target = CredentialTargetSchema.parse({
    vault_item_id: item.data,
    vault_field: field.data,
    ...(typeof parsedArgs.values["section"] === "string"
      ? { vault_section_id: parsedArgs.values["section"] }
      : {}),
    ...(typeof parsedArgs.values["field-id"] === "string"
      ? { vault_field_id: parsedArgs.values["field-id"] }
      : {}),
    ...(typeof parsedArgs.values["json-path"] === "string"
      ? { vault_json_path: parsedArgs.values["json-path"] }
      : {}),
  });
  const readSecret = options?.readSecret ?? readSecretFromStdin;
  const vaultOption =
    typeof parsedArgs.values["vault"] === "string"
      ? parsedArgs.values["vault"]
      : undefined;
  return writeSecretTargets([{ target, value: await readSecret() }], {
    dryRun: parsedArgs.values["dry-run"] === true,
    ...(vaultOption === undefined ? {} : { vaultId: vaultOption }),
    ...(options?.env === undefined ? {} : { env: options.env }),
  });
}

if (import.meta.main) {
  try {
    const results = await runSecretWriteCli(Bun.argv.slice(2));
    process.stdout.write(`${JSON.stringify({ results }, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : "Secret write failed; details withheld."}\n`,
    );
    process.exitCode = 1;
  }
}
