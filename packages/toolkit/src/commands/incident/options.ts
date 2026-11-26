import { parseArgs } from "node:util";
import { z } from "zod";
import {
  IncidentLinkInputSchema,
  IncidentSystemSchema,
  type IncidentLinkInput,
  type IncidentSuspect,
  type IncidentSystem,
} from "@shepherdjerred/incidents/contract";

export const IncidentActionSchema = z.enum([
  "list",
  "check",
  "view",
  "show",
  "declare",
  "update",
  "status",
  "edit",
  "link",
  "join",
  "leave",
  "take",
  "claim",
  "handoff",
  "release",
  "resolve",
  "reopen",
  "watch",
  "wait",
]);
export type IncidentAction = z.infer<typeof IncidentActionSchema>;

/**
 * Exit codes. 0-8 keep their toolkit-wide meanings (2 usage, 6 timeout);
 * 10-15 are incident outcomes a script or agent branches on.
 */
export const INCIDENT_EXIT = {
  ok: 0,
  failure: 1,
  usage: 2,
  timeout: 6,
  /** `check`: a relevant open incident exists. */
  open: 10,
  /** `check`/`wait`: you likely caused it and nobody commands it; take it. */
  suspect: 11,
  /** `wait`: you are the commander (already, or took command with `--no-spawn`). */
  commander: 12,
  /** `declare`: an open incident already covers the system; join or wait on it. */
  duplicate: 13,
  /** A stale `--expected-revision`; re-read and retry. */
  stale: 14,
  /** `take`/`claim`: someone else holds command or the lease, or the grace has not passed. */
  notTaken: 15,
} as const;

/** A caller mistake: exit 2 with the message, never a stack. */
export class IncidentUsageError extends Error {
  override readonly name = "IncidentUsageError";
}

const string = { type: "string" } as const;
const boolean = { type: "boolean", default: false } as const;
const multiple = { type: "string", multiple: true } as const;

export function parseIncidentArgs(args: string[]) {
  try {
    return parseArgs({
      args,
      allowPositionals: true,
      options: {
        json: boolean,
        "hub-url": string,
        "actor-key": string,
        "actor-kind": string,
        "actor-name": string,
        state: string,
        kind: string,
        system: multiple,
        limit: string,
        title: string,
        summary: string,
        impact: string,
        severity: string,
        component: multiple,
        "exit-condition": string,
        link: multiple,
        "suspect-pr": string,
        "suspect-commit": string,
        "suspect-branch": string,
        "clear-suspect": boolean,
        take: boolean,
        start: string,
        end: string,
        body: string,
        "body-file": string,
        note: string,
        "note-file": string,
        "expected-revision": string,
        ref: string,
        url: string,
        force: boolean,
        spawn: boolean,
        "no-spawn": boolean,
        "dispatch-handle": string,
        to: string,
        "until-resolved": boolean,
        "timeout-sec": string,
      },
    });
  } catch (error) {
    throw new IncidentUsageError(
      error instanceof Error ? error.message : String(error),
    );
  }
}
export type IncidentOptions = ReturnType<typeof parseIncidentArgs>["values"];

export function requireValue(value: string | undefined, label: string): string {
  if (value === undefined || value.trim() === "")
    throw new IncidentUsageError(`${label} is required`);
  return value;
}

export function refArg(positionals: string[], action: string): string {
  return requireValue(positionals[0], `toolkit incident ${action} <INC-N>`);
}

export function systemsOf(options: IncidentOptions): IncidentSystem[] {
  return (options.system ?? []).flatMap((value) =>
    value.split(",").map((item) => {
      const parsed = IncidentSystemSchema.safeParse(item.trim());
      if (!parsed.success)
        throw new IncidentUsageError(
          `Unknown system ${item}; use one of ${IncidentSystemSchema.options.join(", ")}`,
        );
      return parsed.data;
    }),
  );
}

export function revisionOf(options: IncidentOptions): number | undefined {
  const raw = options["expected-revision"];
  if (raw === undefined) return undefined;
  const parsed = z.coerce.number().int().nonnegative().safeParse(raw);
  if (!parsed.success)
    throw new IncidentUsageError("--expected-revision must be an integer");
  return parsed.data;
}

export function positiveInt(
  raw: string | undefined,
  label: string,
): number | undefined {
  if (raw === undefined) return undefined;
  const parsed = z.coerce.number().int().positive().safeParse(raw);
  if (!parsed.success)
    throw new IncidentUsageError(`${label} must be a positive integer`);
  return parsed.data;
}

/** `--link kind=ref[,url]`, e.g. `pr=5144,https://github.com/o/r/pull/5144`. */
export function parseLink(value: string): IncidentLinkInput {
  const equals = value.indexOf("=");
  if (equals <= 0)
    throw new IncidentUsageError(
      `--link ${value}: expected kind=ref[,url] (kinds: pr, pipeline, alert, tracker-issue, forum-thread, delivery-deployment, commit, url)`,
    );
  const kind = value.slice(0, equals);
  const rest = value.slice(equals + 1);
  const comma = rest.indexOf(",http");
  const ref = comma === -1 ? rest : rest.slice(0, comma);
  const url = comma === -1 ? undefined : rest.slice(comma + 1);
  const parsed = IncidentLinkInputSchema.safeParse({
    kind,
    ref,
    ...(url === undefined ? {} : { url }),
  });
  if (!parsed.success)
    throw new IncidentUsageError(
      `--link ${value}: ${parsed.error.issues.map((issue) => `${issue.path.join(".")} ${issue.message}`).join("; ")}`,
    );
  return parsed.data;
}

export function suspectOf(
  options: IncidentOptions,
): IncidentSuspect | undefined {
  const pr = positiveInt(options["suspect-pr"], "--suspect-pr");
  const commit = options["suspect-commit"]?.trim().toLowerCase();
  const branch = options["suspect-branch"]?.trim();
  if (pr === undefined && commit === undefined && branch === undefined)
    return undefined;
  if (commit !== undefined && !/^[0-9a-f]{7,40}$/u.test(commit))
    throw new IncidentUsageError(
      "--suspect-commit must be a 7-40 character hex SHA",
    );
  return {
    ...(pr === undefined ? {} : { prNumber: pr }),
    ...(commit === undefined ? {} : { commitSha: commit }),
    ...(branch === undefined || branch === "" ? {} : { branch }),
  };
}

/** `--timeout-sec N` as milliseconds. */
export function timeoutMsOf(options: IncidentOptions): number | undefined {
  const seconds = positiveInt(options["timeout-sec"], "--timeout-sec");
  return seconds === undefined ? undefined : seconds * 1000;
}
