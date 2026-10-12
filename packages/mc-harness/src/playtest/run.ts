import { createHash } from "node:crypto";
import { mkdir, stat } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import {
  ActorListResponseSchema,
  ActorObservationSchema,
  ActorRemoveResponseSchema,
  ActorSchema,
  type BridgeEvent,
  type InfoResponse,
  InfoResponseSchema,
  SnapshotSchema,
} from "#protocol/bridge.ts";
import { ProfileSchema, SnapshotBytesResponseSchema } from "#protocol/ipc.ts";
import {
  type PlaytestReport,
  PlaytestReportSchema,
  type PlaytestStatus,
  RunIdSchema,
  type ScenarioMeta,
} from "#protocol/playtest.ts";
import {
  ActionFailed,
  AssertionFailed,
  type ContextParts,
  createContext,
  Recorder,
} from "#playtest/context.ts";
import type { DaemonClient } from "#playtest/daemon-client.ts";
import type { Scenario } from "#playtest/define.ts";
import { scenarioMeta } from "#playtest/scenario.ts";

export const RunDescriptorSchema = z.strictObject({
  file: z.string().startsWith("/"),
  runId: RunIdSchema,
  runDir: z.string().startsWith("/"),
  targetId: z.string().min(1),
  profile: ProfileSchema,
});
export type RunDescriptor = z.infer<typeof RunDescriptorSchema>;

const EVENT_TAIL = 30;
const LOG_TAIL = 50;

type Failure = NonNullable<PlaytestReport["failure"]>;
type Artifact = PlaytestReport["artifacts"][number];

class ScenarioTimeout extends Error {
  constructor(ms: number) {
    super(`scenario did not finish within ${ms.toString()}ms`);
    this.name = "ScenarioTimeout";
  }
}

async function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: Timer | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new ScenarioTimeout(ms));
    }, ms);
  });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

function statusFor(error: unknown): PlaytestStatus {
  if (error instanceof ScenarioTimeout) {
    return "timedOut";
  }
  return error instanceof AssertionFailed || error instanceof ActionFailed
    ? "failed"
    : "errored";
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Plugins, capabilities and profiles the target lacks, or an empty list. */
export function missingRequirements(
  meta: ScenarioMeta,
  info: InfoResponse,
  profile: z.infer<typeof ProfileSchema>,
): string[] {
  const missing: string[] = [];
  if (
    meta.requires.profiles.length > 0 &&
    !meta.requires.profiles.includes(profile)
  ) {
    missing.push(
      `profile ${meta.requires.profiles.join(" or ")} (target is ${profile})`,
    );
  }
  const enabled = new Set(
    info.plugins
      .filter((plugin) => plugin.enabled)
      .map((plugin) => plugin.name),
  );
  missing.push(
    ...meta.requires.plugins
      .filter((plugin) => !enabled.has(plugin))
      .map((plugin) => `plugin ${plugin}`),
    ...meta.requires.capabilities
      .filter((capability) => !info.capabilities.includes(capability))
      .map((capability) => `capability ${capability}`),
  );
  return missing;
}

/** One scenario run: setup, run, evidence and cleanup against one target. */
class ScenarioRun {
  private readonly meta: ScenarioMeta;
  private readonly parts: ContextParts;
  private readonly artifacts: Artifact[] = [];
  private readonly started = Date.now();
  private startCursor = 0;

  constructor(
    private readonly scenario: Scenario,
    private readonly descriptor: RunDescriptor,
    private readonly daemon: DaemonClient,
  ) {
    this.meta = scenarioMeta(scenario);
    this.parts = createContext(scenario, daemon, new Recorder());
  }

  private get actorNames(): string[] {
    return this.meta.actors;
  }

  async execute(): Promise<PlaytestReport> {
    await mkdir(this.descriptor.runDir, { recursive: true });
    this.startCursor = await this.parts.context.events.cursor();
    this.parts.recorder.stepCursor = this.startCursor;
    const info = await this.daemon.target(InfoResponseSchema, "GET", "info");
    const missing = missingRequirements(
      this.meta,
      info,
      this.descriptor.profile,
    );
    if (missing.length > 0) {
      return this.finish({
        status: "errored",
        reason: `target ${this.descriptor.targetId} lacks ${missing.join(", ")}`,
      });
    }
    let outcome: { status: PlaytestStatus; failure?: Failure } = {
      status: "passed",
    };
    try {
      await withTimeout(this.play(), this.meta.timeoutMs);
    } catch (error) {
      outcome = {
        status: statusFor(error),
        failure: await this.describeFailure(error),
      };
    }
    await this.removeActors();
    await this.snapshot("region-after").catch((error: unknown) => {
      this.parts.recorder.notes.push(
        `region-after snapshot failed: ${message(error)}`,
      );
    });
    return this.finish(outcome);
  }

  private async play(): Promise<void> {
    const { context, recorder } = this.parts;
    await this.snapshot("region-before");
    for (const [name, spec] of Object.entries(this.scenario.actors ?? {})) {
      await this.daemon.target(ActorSchema, "POST", "actors", {
        name,
        world: context.world,
        at: spec.at,
        ...(spec.gameMode === undefined ? {} : { gameMode: spec.gameMode }),
        ...(spec.op === undefined ? {} : { op: spec.op }),
      });
    }
    recorder.currentStep = "setup";
    await this.scenario.setup?.(context);
    recorder.currentStep = undefined;
    recorder.stepCursor = await context.events.cursor();
    await this.scenario.run(context);
  }

  private async snapshot(
    name: "region-before" | "region-after",
  ): Promise<void> {
    const region = this.scenario.region;
    if (region === undefined) {
      return;
    }
    const snapshot = await this.daemon.target(
      SnapshotSchema,
      "POST",
      "snapshot",
      {
        box: {
          world: this.parts.context.world,
          min: region.min,
          max: region.max,
        },
        label: `${this.descriptor.runId} ${name}`,
      },
    );
    const bytes = await this.daemon.target(
      SnapshotBytesResponseSchema,
      "GET",
      `snapshots/${encodeURIComponent(snapshot.id)}`,
    );
    const file = path.join(this.descriptor.runDir, `${name}.schem`);
    await Bun.write(file, Buffer.from(bytes.base64, "base64"));
    this.artifacts.push({
      name: `${name}.schem`,
      path: file,
      bytes: snapshot.bytes,
    });
  }

  private async observe(
    name: string,
  ): Promise<Failure["observations"][string]> {
    try {
      return await this.daemon.target(
        ActorObservationSchema,
        "GET",
        `actors/${encodeURIComponent(name)}`,
      );
    } catch (error) {
      return { error: message(error) };
    }
  }

  private async describeFailure(error: unknown): Promise<Failure> {
    const observations: Failure["observations"] = {};
    for (const name of this.actorNames) {
      observations[name] = await this.observe(name);
    }
    const recent = await this.parts.context.events.since(this.startCursor);
    const step = this.parts.recorder.currentStep;
    return {
      message: message(error),
      ...(error instanceof Error && error.stack !== undefined
        ? { stack: error.stack }
        : {}),
      ...(step === undefined ? {} : { step }),
      observations,
      eventTail: recent.slice(-EVENT_TAIL),
      logTail: recent
        .filter((event) => event.type === "log")
        .map((event) => event.text)
        .slice(-LOG_TAIL),
    };
  }

  private async removeActors(): Promise<void> {
    if (this.actorNames.length === 0) {
      return;
    }
    const { actors } = await this.daemon.target(
      ActorListResponseSchema,
      "GET",
      "actors",
    );
    for (const actor of actors.filter((entry) =>
      this.actorNames.includes(entry.name),
    )) {
      await this.daemon.target(
        ActorRemoveResponseSchema,
        "DELETE",
        `actors/${encodeURIComponent(actor.name)}`,
      );
    }
  }

  private async writeEvidence(): Promise<void> {
    const events: BridgeEvent[] = await this.parts.context.events.since(
      this.startCursor,
    );
    const files: [string, string][] = [
      ["events.jsonl", events.map((event) => JSON.stringify(event)).join("\n")],
      [
        "server.log",
        events
          .filter((event) => event.type === "log")
          .map((event) => `${event.ts} ${event.text}`)
          .join("\n"),
      ],
    ];
    for (const [name, content] of files) {
      const file = path.join(this.descriptor.runDir, name);
      await Bun.write(file, `${content}\n`);
      const info = await stat(file);
      this.artifacts.push({ name, path: file, bytes: info.size });
    }
  }

  private async finish(outcome: {
    status: PlaytestStatus;
    reason?: string;
    failure?: Failure;
  }): Promise<PlaytestReport> {
    await this.writeEvidence();
    const source = await Bun.file(this.descriptor.file).bytes();
    const { recorder } = this.parts;
    const report = PlaytestReportSchema.parse({
      runId: this.descriptor.runId,
      dir: this.descriptor.runDir,
      scenario: {
        name: this.meta.name,
        description: this.meta.description,
        file: this.descriptor.file,
        sha256: createHash("sha256").update(source).digest("hex"),
      },
      target: {
        id: this.descriptor.targetId,
        profile: this.descriptor.profile,
      },
      startedAt: new Date(this.started).toISOString(),
      durationMs: Date.now() - this.started,
      ...outcome,
      steps: recorder.steps,
      assertions: recorder.assertions,
      notes: recorder.notes,
      artifacts: this.artifacts,
    });
    await Bun.write(
      path.join(this.descriptor.runDir, "report.json"),
      JSON.stringify(report, null, 2),
    );
    return report;
  }
}

/**
 * Runs one scenario against the descriptor's target and writes its run
 * directory. Scenario failures become the report; only broken plumbing throws.
 */
export async function runScenario(
  scenario: Scenario,
  descriptor: RunDescriptor,
  daemon: DaemonClient,
): Promise<PlaytestReport> {
  return new ScenarioRun(scenario, descriptor, daemon).execute();
}
