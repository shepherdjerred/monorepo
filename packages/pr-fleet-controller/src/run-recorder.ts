import { createHash } from "node:crypto";
import {
  access,
  chmod,
  constants,
  lstat,
  mkdir,
  open,
  readdir,
  rename,
  unlink,
} from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { redactSecrets } from "@shepherdjerred/llm-observability";
import type { FleetTelemetry } from "./ports.ts";
import {
  GENESIS_EVENT_HASH,
  JsonValueSchema,
  RecordedRunEventSchema,
  RUN_BUNDLE_SCHEMA_VERSION,
  RunEventPayloadSchema,
  RunManifestSchema,
  RunSummarySchema,
  UnsignedRunEventSchema,
  type JsonValue,
  type RecordedRunEvent,
  type RunEventCorrelation,
  type RunEventKind,
  type RunManifest,
  type RunSummary,
} from "./run-events.ts";
import type { FleetSnapshot } from "./schemas.ts";
import {
  writeFileSinkSynchronously,
  type SynchronousFileSinkWriter,
} from "./synchronous-file-sink.ts";
import {
  redactFleetSnapshot,
  redactSummaryError,
} from "./run-summary-redaction.ts";

const PRIVATE_DIRECTORY_MODE = 0o700;
const PRIVATE_FILE_MODE = 0o600;
const FORBIDDEN_DIRECTORY_MODE = 0o077;

export type RunPaths = {
  root: string;
  runDirectory: string;
  manifest: string;
  events: string;
  summary: string;
  mastra: string;
  observability: string;
};

export type CreateRunRecorderOptions = {
  stateDirectory?: string;
  controllerVersion: string;
  controllerCommit: string;
  controllerSourceDirty: boolean;
  controllerSourceFingerprint: string;
  controllerSourceResolved?: boolean;
  model: string;
  repository: string;
  checkout: string;
  worktreeRoot: string;
  maxWorkers: number;
  now?: () => Date;
  randomId?: () => string;
  secretValues?: readonly string[];
  writeEvent?: SynchronousFileSinkWriter;
};

type RunRecorderConstructorOptions = {
  paths: RunPaths;
  manifest: RunManifest;
  now: () => Date;
  secretValues: readonly string[];
  eventsSink: Bun.FileSink;
  writeEvent: SynchronousFileSinkWriter;
};

function defaultStateDirectory(): string {
  const xdgState = Bun.env["XDG_STATE_HOME"];
  const stateBase =
    xdgState === undefined || xdgState.length === 0
      ? path.join(homedir(), ".local", "state")
      : xdgState;
  return path.join(stateBase, "pr-fleet-controller");
}

export function resolveStateDirectory(stateDirectory?: string): string {
  return path.resolve(stateDirectory ?? defaultStateDirectory());
}

async function assertPrivateDirectory(
  directory: string,
  create: boolean,
): Promise<void> {
  if (create) {
    await mkdir(directory, { recursive: true, mode: PRIVATE_DIRECTORY_MODE });
  }
  const stats = await lstat(directory);
  if (stats.isSymbolicLink() || !stats.isDirectory()) {
    throw new Error(`State path is not a real directory: ${directory}`);
  }
  const getuid = process.getuid;
  if (getuid === undefined || stats.uid !== getuid()) {
    throw new Error(
      `State directory is not owned by this process: ${directory}`,
    );
  }
  if ((stats.mode & FORBIDDEN_DIRECTORY_MODE) !== 0) {
    throw new Error(`State directory permissions must be 0700: ${directory}`);
  }
  await access(directory, constants.R_OK | constants.W_OK | constants.X_OK);
}

async function secureWriteJson(file: string, value: unknown): Promise<void> {
  const validated = JsonValueSchema.parse(value);
  const handle = await open(file, "wx", PRIVATE_FILE_MODE);
  try {
    await handle.writeFile(`${JSON.stringify(validated, null, 2)}\n`);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function secureReplaceJson(file: string, value: unknown): Promise<void> {
  const replacement = `${file}.${crypto.randomUUID()}.tmp`;
  await secureWriteJson(replacement, value);
  try {
    await rename(replacement, file);
  } catch (error) {
    try {
      await unlink(replacement);
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        `Failed to replace ${file} and remove its temporary file`,
        { cause: cleanupError },
      );
    }
    throw error;
  }
}

function validateSecretValues(values: readonly string[]): void {
  const unsafeSecret = values.find(
    (secret) => secret.length > 0 && secret.length < 8,
  );
  if (unsafeSecret !== undefined) {
    throw new Error(
      "Explicit run-bundle secret values must be at least 8 characters",
    );
  }
}

function canonicalJsonValue(value: JsonValue): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJsonValue(item)).join(",")}]`;
  }
  const fields = Object.entries(value)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(
      ([key, inner]) => `${JSON.stringify(key)}:${canonicalJsonValue(inner)}`,
    );
  return `{${fields.join(",")}}`;
}

export function canonicalJson(value: unknown): string {
  return canonicalJsonValue(JsonValueSchema.parse(value));
}

export function hashEvent(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

export function errorDetails(error: unknown): {
  message: string;
  stack?: string;
} {
  if (error instanceof Error) {
    return error.stack === undefined
      ? { message: error.message }
      : { message: error.message, stack: error.stack };
  }
  return { message: String(error) };
}

function parseJson(text: string): unknown {
  return JSON.parse(text);
}

export class RunRecorder implements FleetTelemetry {
  readonly runId: string;
  readonly paths: RunPaths;
  manifest: RunManifest;
  readonly #eventsSink: Bun.FileSink;
  readonly #now: () => Date;
  readonly #createdAt: Date;
  readonly #counts = new Map<RunEventKind, number>();
  #secretValues: readonly string[];
  #sequence = 0;
  #lastHash = GENESIS_EVENT_HASH;
  #closed = false;
  readonly #writeEvent: SynchronousFileSinkWriter;
  #finalizationPromise: Promise<RunSummary> | undefined;

  private constructor(options: RunRecorderConstructorOptions) {
    this.runId = options.manifest.runId;
    this.paths = options.paths;
    this.manifest = options.manifest;
    this.#now = options.now;
    this.#createdAt = new Date(options.manifest.createdAt);
    this.#secretValues = options.secretValues;
    this.#eventsSink = options.eventsSink;
    this.#writeEvent = options.writeEvent;
  }

  static async create(options: CreateRunRecorderOptions): Promise<RunRecorder> {
    validateSecretValues(options.secretValues ?? []);
    const now = options.now ?? (() => new Date());
    const randomId = options.randomId ?? (() => crypto.randomUUID());
    const root = resolveStateDirectory(options.stateDirectory);
    await assertPrivateDirectory(root, true);
    const createdAt = now();
    const runId = `${createdAt.toISOString().replaceAll(":", "-")}-${randomId()}`;
    const runDirectory = path.join(root, runId);
    await mkdir(runDirectory, { mode: PRIVATE_DIRECTORY_MODE });
    await assertPrivateDirectory(runDirectory, false);
    const paths: RunPaths = {
      root,
      runDirectory,
      manifest: path.join(runDirectory, "manifest.json"),
      events: path.join(runDirectory, "events.jsonl"),
      summary: path.join(runDirectory, "summary.json"),
      mastra: path.join(runDirectory, "mastra.db"),
      observability: path.join(runDirectory, "observability.duckdb"),
    };
    const manifest = RunManifestSchema.parse({
      schemaVersion: RUN_BUNDLE_SCHEMA_VERSION,
      runId,
      createdAt: createdAt.toISOString(),
      controllerVersion: options.controllerVersion,
      controllerCommit: options.controllerCommit,
      controllerSourceDirty: options.controllerSourceDirty,
      controllerSourceFingerprint: options.controllerSourceFingerprint,
      controllerSourceResolved: options.controllerSourceResolved ?? true,
      model: options.model,
      repository: options.repository,
      checkout: options.checkout,
      worktreeRoot: options.worktreeRoot,
      maxWorkers: options.maxWorkers,
      files: {
        events: "events.jsonl",
        summary: "summary.json",
        mastra: "mastra.db",
        observability: "observability.duckdb",
      },
      capture: {
        localOnly: true,
        redactedBeforePersistence: true,
        retention: "indefinite",
      },
    });
    await secureWriteJson(paths.manifest, manifest);
    const eventsHandle = await open(paths.events, "wx", PRIVATE_FILE_MODE);
    await eventsHandle.close();
    const eventsSink = Bun.file(paths.events).writer();
    return new RunRecorder({
      paths,
      manifest,
      now,
      secretValues: options.secretValues ?? [],
      eventsSink,
      writeEvent: options.writeEvent ?? writeFileSinkSynchronously,
    });
  }

  configureSecretValues(values: readonly string[]): void {
    validateSecretValues(values);
    this.#secretValues = values;
  }

  async initializeController(controller: {
    controllerVersion: string;
    controllerCommit: string;
    controllerSourceDirty: boolean;
    controllerSourceFingerprint: string;
    model: string;
    repository: string;
    checkout: string;
    worktreeRoot: string;
    maxWorkers: number;
  }): Promise<void> {
    if (this.manifest.controllerSourceResolved) {
      throw new Error("Controller source provenance is already resolved");
    }
    const manifest = RunManifestSchema.parse({
      ...this.manifest,
      ...controller,
      controllerSourceResolved: true,
    });
    await secureReplaceJson(this.paths.manifest, manifest);
    this.manifest = manifest;
  }

  newId(prefix: string): string {
    return `${prefix}-${crypto.randomUUID()}`;
  }

  traceId(...parts: string[]): string {
    return createHash("sha256")
      .update([this.runId, ...parts].join(":"))
      .digest("hex")
      .slice(0, 32);
  }

  redact(value: unknown): unknown {
    return redactSecrets(value, this.#secretValues);
  }

  record(
    kind: RunEventKind,
    payload: Record<string, unknown>,
    correlation: RunEventCorrelation = {},
  ): void {
    if (this.#closed) {
      throw new Error(`Cannot record ${kind} after run finalization`);
    }
    const redactedPayload = RunEventPayloadSchema.parse(this.redact(payload));
    const unsigned = UnsignedRunEventSchema.parse({
      schemaVersion: RUN_BUNDLE_SCHEMA_VERSION,
      runId: this.runId,
      sequence: this.#sequence + 1,
      timestamp: this.#now().toISOString(),
      previousHash: this.#lastHash,
      kind,
      correlation,
      payload: redactedPayload,
    });
    const event = RecordedRunEventSchema.parse({
      ...unsigned,
      hash: hashEvent(unsigned),
    });
    const line = `${JSON.stringify(event)}\n`;
    // Audit capture is a prerequisite for controller work. Persist and sync the
    // event before returning so a full disk or failed state volume stops the
    // caller before it can perform the action represented by the next event.
    this.#writeEvent(this.#eventsSink, line);
    this.#sequence = event.sequence;
    this.#lastHash = event.hash;
    this.#counts.set(kind, (this.#counts.get(kind) ?? 0) + 1);
  }

  async secureArtifact(file: string): Promise<void> {
    const stats = await lstat(file);
    if (!stats.isFile() || stats.isSymbolicLink()) {
      throw new Error(`Run artifact is not a regular file: ${file}`);
    }
    await chmod(file, PRIVATE_FILE_MODE);
  }

  async secureRunArtifacts(): Promise<void> {
    const entries = await readdir(this.paths.runDirectory, {
      withFileTypes: true,
    });
    for (const entry of entries) {
      const artifact = path.join(this.paths.runDirectory, entry.name);
      if (!entry.isFile() || entry.isSymbolicLink()) {
        throw new Error(`Unexpected non-file run artifact: ${artifact}`);
      }
      await this.secureArtifact(artifact);
    }
  }

  finalize(
    status: RunSummary["status"],
    finalSnapshot: FleetSnapshot | null,
    error: unknown = null,
  ): Promise<RunSummary> {
    this.#finalizationPromise ??= this.#finalize(status, finalSnapshot, error);
    return this.#finalizationPromise;
  }

  async #finalize(
    status: RunSummary["status"],
    finalSnapshot: FleetSnapshot | null,
    error: unknown,
  ): Promise<RunSummary> {
    if (this.#closed) {
      return readRunSummary(this.paths.runDirectory);
    }
    const kind = status === "completed" ? "run.completed" : "run.failed";
    this.record(
      kind,
      error === null ? { status } : { status, error: errorDetails(error) },
    );
    await this.#eventsSink.end();
    this.#closed = true;
    const countsByKind = Object.fromEntries(this.#counts);
    const finishedAt = this.#now();
    const details = error === null ? null : errorDetails(error);
    const summary = RunSummarySchema.parse({
      schemaVersion: RUN_BUNDLE_SCHEMA_VERSION,
      runId: this.runId,
      status,
      finishedAt: finishedAt.toISOString(),
      durationMs: Math.max(0, finishedAt.getTime() - this.#createdAt.getTime()),
      eventCount: this.#sequence,
      lastHash: this.#lastHash,
      countsByKind,
      finalSnapshot:
        finalSnapshot === null
          ? null
          : redactFleetSnapshot(finalSnapshot, this.#secretValues),
      error: redactSummaryError(details, this.#secretValues),
    });
    await secureWriteJson(this.paths.summary, summary);
    await this.secureRunArtifacts();
    return summary;
  }
}

export function resolveRunDirectory(
  run: string,
  stateDirectory?: string,
): string {
  if (path.isAbsolute(run) || run.includes(path.sep)) {
    return path.resolve(run);
  }
  return path.join(resolveStateDirectory(stateDirectory), run);
}

export async function readRunManifest(
  runDirectory: string,
): Promise<RunManifest> {
  return RunManifestSchema.parse(
    parseJson(await Bun.file(path.join(runDirectory, "manifest.json")).text()),
  );
}

export async function readRunSummary(
  runDirectory: string,
): Promise<RunSummary> {
  return RunSummarySchema.parse(
    parseJson(await Bun.file(path.join(runDirectory, "summary.json")).text()),
  );
}

export async function readAndVerifyEvents(
  runDirectory: string,
): Promise<RecordedRunEvent[]> {
  const text = await Bun.file(path.join(runDirectory, "events.jsonl")).text();
  const lines = text.split("\n").filter((line) => line.length > 0);
  const events: RecordedRunEvent[] = [];
  let expectedPreviousHash = GENESIS_EVENT_HASH;
  for (const [index, line] of lines.entries()) {
    const event = RecordedRunEventSchema.parse(parseJson(line));
    const expectedSequence = index + 1;
    if (event.sequence !== expectedSequence) {
      throw new Error(
        `Event sequence mismatch: expected ${String(expectedSequence)}, got ${String(event.sequence)}`,
      );
    }
    if (event.previousHash !== expectedPreviousHash) {
      throw new Error(
        `Event hash chain broke at sequence ${String(event.sequence)}`,
      );
    }
    const { hash, ...unsignedInput } = event;
    const unsigned = UnsignedRunEventSchema.parse(unsignedInput);
    const expectedHash = hashEvent(unsigned);
    if (hash !== expectedHash) {
      throw new Error(
        `Event hash mismatch at sequence ${String(event.sequence)}`,
      );
    }
    expectedPreviousHash = hash;
    events.push(event);
  }
  return events;
}
