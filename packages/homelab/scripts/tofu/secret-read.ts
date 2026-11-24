import { parseArgs } from "node:util";
import { z } from "zod";
import {
  OpItemSchema,
  OpItemListSchema,
  VAULT_ID,
  type OpItem,
} from "#cdk8s/scripts/onepassword-lib.ts";
import { resolveAuditItem } from "#cdk8s/scripts/onepassword/field-map.ts";
import {
  assertPreparationAction,
  jsonCredential,
  type CredentialTarget,
} from "./application-secrets.ts";

export function resolveItemTargetValue(
  items: readonly OpItem[],
  target: CredentialTarget,
): string | undefined {
  const item = resolveAuditItem(items, target.vault_item_id);
  if (item === undefined) return undefined;
  const labelOnly =
    target.vault_section_id === undefined &&
    target.vault_field_id === undefined;
  const matches = (item.fields ?? []).filter(
    (field) =>
      target.vault_field === (field.label ?? field.id) &&
      (labelOnly || field.section?.id === target.vault_section_id) &&
      (target.vault_field_id === undefined ||
        field.id === target.vault_field_id),
  );
  const value = matches.length === 1 ? matches[0]?.value : undefined;
  if (value === undefined || value === "") return undefined;
  return target.vault_json_path === undefined
    ? value
    : jsonCredential(value, target.vault_json_path);
}

const repositoryRoot = new URL("../../../../", import.meta.url).pathname;

/** Capture both streams. Never attach raw stderr, parsed values, or causes to errors. */
export async function capturedRead(
  command: string[],
  operation: string,
  env: Record<string, string | undefined> = Bun.env,
): Promise<string> {
  const isolated = Object.fromEntries(
    Object.entries(env).filter(
      ([key]) =>
        key !== "DEBUG" &&
        !key.startsWith("TF_LOG") &&
        !key.startsWith("TF_CLI_ARGS"),
    ),
  );
  try {
    const child = Bun.spawn(command, {
      cwd: repositoryRoot,
      env: isolated,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, , exitCode] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    if (exitCode !== 0) throw new Error("failed");
    return stdout;
  } catch {
    throw new Error(`Read failed (${operation}); command output withheld.`);
  }
}

export function parsePrivateJson<Schema extends z.ZodType>(
  value: string,
  schema: Schema,
): z.output<Schema> {
  try {
    return schema.parse(JSON.parse(value));
  } catch {
    throw new Error("Invalid private response; details withheld.");
  }
}

export async function readVaultItem(
  id: string,
  vaultId = VAULT_ID,
): Promise<OpItem> {
  const item = parsePrivateJson(
    await capturedRead(
      [
        `${repositoryRoot}/scripts/onepassword/with-service-account.sh`,
        "op",
        "item",
        "get",
        id,
        "--vault",
        vaultId,
        "--format",
        "json",
      ],
      "1Password item",
    ),
    OpItemSchema,
  );
  if (item.vault !== undefined && item.vault.id !== vaultId)
    throw new Error("1Password returned an item from a different vault.");
  return { ...item, vault: { ...item.vault, id: vaultId } };
}

export async function readVault(vaultId = VAULT_ID): Promise<OpItem[]> {
  const items = parsePrivateJson(
    await capturedRead(
      [
        `${repositoryRoot}/scripts/onepassword/with-service-account.sh`,
        "op",
        "item",
        "list",
        "--vault",
        vaultId,
        "--format",
        "json",
      ],
      "1Password list",
    ),
    OpItemListSchema,
  );
  if (items.length === 0)
    throw new Error("Vault inventory is empty; refusing an incomplete audit.");
  const result: OpItem[] = [];
  for (let index = 0; index < items.length; index += 4) {
    const batch = items.slice(index, index + 4);
    result.push(
      ...(await Promise.all(batch.map(({ id }) => readVaultItem(id, vaultId)))),
    );
  }
  return result;
}

const RawOpFieldSchema = z.looseObject({
  id: z.string(),
  label: z.string().optional(),
  value: z.string().optional(),
  section: z
    .looseObject({ id: z.string(), label: z.string().optional() })
    .optional(),
});
export const RawOpItemSchema = z.looseObject({
  id: z.string(),
  title: z.string(),
  vault: z
    .looseObject({ id: z.string(), name: z.string().optional() })
    .optional(),
  version: z.number().int().optional(),
  fields: z.array(RawOpFieldSchema).optional(),
});
export type RawOpItem = z.infer<typeof RawOpItemSchema>;

const FORBIDDEN_OBJECT_KEYS = new Set([
  "__proto__",
  "constructor",
  "prototype",
]);
const JsonRecordSchema = z.record(z.string(), z.unknown());

function parseJsonPointerSegments(jsonPath: string): string[] {
  if (!/^(?:\/(?:[^~/]|~[01])*)+$/u.test(jsonPath)) {
    throw new Error("Invalid target JSON pointer; details withheld.");
  }
  const segments = jsonPath
    .slice(1)
    .split("/")
    .map((s) => s.replaceAll("~1", "/").replaceAll("~0", "~"));
  if (segments.some((segment) => FORBIDDEN_OBJECT_KEYS.has(segment))) {
    throw new Error("Unsupported target JSON pointer segment.");
  }
  return segments;
}

function parseArrayIndex(segment: string, length: number): number {
  if (!/^(?:0|[1-9]\d*)$/u.test(segment))
    throw new Error("Invalid array index in target JSON pointer.");
  const index = Number(segment);
  if (index >= length)
    throw new Error("Target JSON pointer array index is out of bounds.");
  return index;
}

function stepJsonContainer(cursor: unknown, segment: string): unknown {
  if (Array.isArray(cursor))
    return cursor[parseArrayIndex(segment, cursor.length)];
  const record = JsonRecordSchema.safeParse(cursor);
  if (!record.success || !(segment in record.data)) {
    throw new Error("Target JSON pointer parent object is missing.");
  }
  return record.data[segment];
}

function mutateJsonLeaf(
  cursor: unknown,
  leafSegment: string,
  nextValue: string,
): boolean {
  if (Array.isArray(cursor)) {
    const index = parseArrayIndex(leafSegment, cursor.length);
    const changed = cursor[index] !== nextValue;
    cursor[index] = nextValue;
    return changed;
  }
  if (typeof cursor !== "object" || cursor === null) {
    throw new Error("Target JSON pointer does not address an object or array.");
  }
  const changed = Reflect.get(cursor, leafSegment) !== nextValue;
  Reflect.set(cursor, leafSegment, nextValue);
  return changed;
}

export function updateJsonCredential(
  rawJson: string,
  jsonPath: string,
  nextValue: string,
): { updated: string; changed: boolean } {
  if (nextValue.length === 0)
    throw new Error("Refusing to write an empty credential value.");
  const segments = parseJsonPointerSegments(jsonPath);
  let root: unknown;
  try {
    root = JSON.parse(rawJson);
  } catch {
    throw new Error(
      "Target field does not contain valid JSON; details withheld.",
    );
  }
  let cursor: unknown = root;
  for (const segment of segments.slice(0, -1))
    cursor = stepJsonContainer(cursor, segment);
  const leafSegment = segments.at(-1);
  if (leafSegment === undefined)
    throw new Error("Invalid target JSON pointer; details withheld.");
  const changed = mutateJsonLeaf(cursor, leafSegment, nextValue);
  const updated = JSON.stringify(root);
  if (jsonCredential(updated, jsonPath) !== nextValue) {
    throw new Error("Updated JSON credential failed post-update check.");
  }
  return { updated, changed };
}

export function applyTargetUpdateToTemplate(
  item: RawOpItem,
  target: CredentialTarget,
  nextValue: string,
): boolean {
  if (nextValue.length === 0)
    throw new Error("Refusing to write an empty credential value.");
  const labelOnly =
    target.vault_section_id === undefined &&
    target.vault_field_id === undefined;
  const matches = (item.fields ?? []).filter(
    (field) =>
      target.vault_field === (field.label ?? field.id) &&
      (labelOnly || field.section?.id === target.vault_section_id) &&
      (target.vault_field_id === undefined ||
        field.id === target.vault_field_id),
  );
  if (matches.length !== 1 || matches[0] === undefined) {
    throw new Error("Target field is missing or ambiguous in 1Password item.");
  }
  const field = matches[0];
  if (target.vault_json_path === undefined) {
    const changed = field.value !== nextValue;
    field.value = nextValue;
    return changed;
  }
  if (field.value === undefined || field.value === "") {
    throw new Error("Target JSON field is empty in 1Password item.");
  }
  const { updated, changed } = updateJsonCredential(
    field.value,
    target.vault_json_path,
    nextValue,
  );
  field.value = updated;
  return changed;
}

const HandoffTargetSchema = z
  .object({
    vault_item_id: z.string().min(1),
    vault_field: z.string().min(1),
    vault_section_id: z.string().optional(),
    vault_field_id: z.string().optional(),
    vault_json_path: z.string().nullish(),
  })
  .transform((t): CredentialTarget => ({
    vault_item_id: t.vault_item_id,
    vault_field: t.vault_field,
    ...(t.vault_json_path == null
      ? {}
      : { vault_json_path: t.vault_json_path }),
    ...(t.vault_section_id === undefined
      ? {}
      : { vault_section_id: t.vault_section_id }),
    ...(t.vault_field_id === undefined
      ? {}
      : { vault_field_id: t.vault_field_id }),
  }));

const HandoffUnitSchema = z.object({
  value: z.string().min(1).optional(),
  api_key: z.string().min(1).optional(),
  api_token: z.string().min(1).optional(),
  onepassword_targets: z.array(HandoffTargetSchema).optional(),
  vault_item_id: z.string().optional(),
  vault_field: z.string().optional(),
  vault_json_path: z.string().nullish(),
  supersedes_id: z.string().nullable().optional(),
});
const HandoffSchema = z.record(z.string(), HandoffUnitSchema);

export function targetKey(target: CredentialTarget): string {
  return JSON.stringify([
    target.vault_item_id,
    target.vault_field,
    target.vault_json_path ?? null,
    ...(target.vault_section_id === undefined &&
    target.vault_field_id === undefined
      ? []
      : [target.vault_section_id ?? null, target.vault_field_id ?? null]),
  ]);
}

function handoffTargets(
  handoff: z.infer<typeof HandoffUnitSchema>,
): CredentialTarget[] {
  if (handoff.onepassword_targets !== undefined)
    return handoff.onepassword_targets;
  if (handoff.vault_item_id === undefined || handoff.vault_field === undefined)
    return [];
  return [
    {
      vault_item_id: handoff.vault_item_id,
      vault_field: handoff.vault_field,
      ...(handoff.vault_json_path == null
        ? {}
        : { vault_json_path: handoff.vault_json_path }),
    },
  ];
}

export type ValidatedHandoffEntry = {
  unit: string;
  target: CredentialTarget;
  value: string;
  supersedes_id: string | null;
};

export function validateDeclaredHandoffs(
  raw: unknown,
  allowed: readonly CredentialTarget[],
  owners?: ReadonlyMap<string, string>,
): ValidatedHandoffEntry[] {
  const parsed = HandoffSchema.safeParse(raw);
  if (!parsed.success)
    throw new Error("Malformed sensitive handoff; details withheld.");
  const declared = new Set(allowed.map((target) => targetKey(target)));
  const visited = new Set<string>();
  const entries: ValidatedHandoffEntry[] = [];
  for (const [unit, handoff] of Object.entries(parsed.data)) {
    const value = handoff.value ?? handoff.api_key ?? handoff.api_token;
    const targets = handoffTargets(handoff);
    if (value === undefined || targets.length === 0)
      throw new Error(
        "Handoff value or targets are missing; details withheld.",
      );
    for (const target of targets) {
      const key = targetKey(target);
      if (!declared.has(key) || visited.has(key))
        throw new Error(
          "Handoff target is undeclared or has conflicting owners.",
        );
      if (owners !== undefined && owners.get(key) !== unit)
        throw new Error("Handoff unit does not own this target.");
      visited.add(key);
      entries.push({
        unit,
        target,
        value,
        supersedes_id: handoff.supersedes_id ?? null,
      });
    }
  }
  if (visited.size !== declared.size)
    throw new Error("Handoff does not cover every declared target.");
  return entries;
}

const HandoffStackSchema = z.enum([
  "openai",
  "cloudflare-tokens",
  "application-secrets",
]);
const HandoffActionSchema = z.enum(["preview", "verify", "apply", "write"]);
export type HandoffStack = z.infer<typeof HandoffStackSchema>;
export type HandoffAction = z.infer<typeof HandoffActionSchema>;

export function parseHandoffCliInvocation(args: readonly string[]): {
  stack: HandoffStack;
  action: HandoffAction;
  expectedHead: string | undefined;
  dryRun: boolean;
  requestedUnits: string[] | undefined;
} {
  let parsedArgs: {
    values: { "dry-run": boolean; unit?: string[] };
    positionals: string[];
  };
  try {
    parsedArgs = parseArgs({
      args: [...args],
      strict: true,
      allowPositionals: true,
      options: {
        "dry-run": { type: "boolean", default: false },
        unit: { type: "string", multiple: true },
      },
    });
  } catch {
    throw new Error("Invalid handoff arguments.");
  }
  const [rawStack, rawAction = "", expectedHead, ...rest] =
    parsedArgs.positionals;
  if (rest.length > 0) throw new Error("Unexpected positional arguments.");
  if (rawStack === "application-secrets") assertPreparationAction(rawAction);
  const stackResult = HandoffStackSchema.safeParse(rawStack);
  if (!stackResult.success)
    throw new Error("Choose openai, cloudflare-tokens or application-secrets.");
  const actionResult = HandoffActionSchema.safeParse(rawAction);
  if (!actionResult.success) {
    throw new Error(
      "Choose preview, verify, apply or write; imports, archives and deletes are disabled.",
    );
  }
  const action = actionResult.data;
  const dryRun = parsedArgs.values["dry-run"];
  const requestedUnits = parsedArgs.values.unit;
  const isWrite = action === "apply" || action === "write";
  if (!isWrite && (dryRun || (requestedUnits?.length ?? 0) > 0))
    throw new Error(
      "--unit and --dry-run are supported only with apply or write.",
    );
  if (action === "preview" && expectedHead !== undefined)
    throw new Error("Preview does not accept an expected source revision.");
  const ci = Bun.env["CI"];
  if (isWrite && ci !== undefined && !["", "0", "false"].includes(ci))
    throw new Error("Credential handoff writes are operator-only.");
  return {
    stack: stackResult.data,
    action,
    expectedHead,
    dryRun,
    requestedUnits,
  };
}
