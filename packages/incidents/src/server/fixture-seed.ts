/**
 * Realistic seeded incidents for Hub's fixture mode and e2e. Everything goes
 * through the service, so the fixture obeys the same invariants as
 * production data.
 */
import {
  ChangeStatusInputSchema,
  DeclareIncidentInputSchema,
  IncidentSignalInputSchema,
  JoinInputSchema,
  PostUpdateInputSchema,
  ResolveInputSchema,
  TakeCommandInputSchema,
  type ActorInput,
} from "#shared/contract.ts";
import type { IncidentsService } from "#server/service.ts";

const MINUTE = 60_000;

export const FIXTURE_ACTORS = {
  jerred: { key: "human:jerred", kind: "human", name: "Jerred" },
  fixer: {
    key: "claude-code:7f3c1d2e-fixture-main-ci",
    kind: "agent",
    name: "claude-code",
    metadata: {
      hostname: "karpathy",
      branch: "temporal-schedule-split",
      sessionId: "7f3c1d2e-fixture-main-ci",
      sessionLink: "session_01FixtureMainCiSuspect",
      harness: "claude-code",
    },
  },
  blocked: {
    key: "claude-code:a51e0c44-fixture-blocked",
    kind: "agent",
    name: "claude-code",
    metadata: {
      hostname: "karpathy",
      branch: "errors-retention",
      harness: "claude-code",
    },
  },
  waiter: {
    key: "codex:9b2d6f10-fixture-waiter",
    kind: "agent",
    name: "codex",
    metadata: {
      hostname: "karpathy",
      branch: "media-acquisition",
      harness: "codex",
    },
  },
  tracker: {
    key: "claude-code:c0ffee00-fixture-tracker",
    kind: "agent",
    name: "claude-code",
    metadata: {
      hostname: "karpathy",
      branch: "tracker-migration",
      harness: "claude-code",
    },
  },
} as const satisfies Record<string, ActorInput>;

export type SeedClock = {
  readonly now: Date;
  readonly setClock: (value: Date) => void;
};

/** Moves the seed clock to `minutes` relative to the real now and returns that instant. */
type At = (minutes: number) => string;

async function seedResolved(service: IncidentsService, at: At) {
  at(-26 * 60);
  const tracker = await service.declare(
    DeclareIncidentInputSchema.parse({
      actor: FIXTURE_ACTORS.tracker,
      title: "Tracker API returned 502s after the views migration",
      summary:
        "The views backfill held a table lock; Tracker writes timed out.",
      severity: "sev2",
      systems: ["tracker"],
      components: ["tracker-api"],
      exitCondition:
        "Tracker writes succeed and the forum list loads in under a second.",
      takeCommand: true,
    }),
  );
  at(-25 * 60);
  await service.resolve(
    ResolveInputSchema.parse({
      actor: FIXTURE_ACTORS.tracker,
      ref: tracker.identifier,
      expectedRevision: tracker.revision,
      note: "Backfill finished; `toolkit forum list --json` answers in 180 ms and writes succeed.",
    }),
  );
}

async function seedMaintenance(
  service: IncidentsService,
  clock: SeedClock,
  at: At,
) {
  at(-90);
  await service.declare(
    DeclareIncidentInputSchema.parse({
      actor: FIXTURE_ACTORS.jerred,
      kind: "maintenance",
      title: "PostgreSQL minor upgrade on shared clusters",
      summary:
        "Rolling restart of every CloudNativePG cluster; each primary fails over once.",
      severity: "sev3",
      systems: ["databases"],
      exitCondition:
        "Every cluster reports the new minor version and all apps pass readiness.",
      scheduledStart: new Date(
        clock.now.getTime() + 120 * MINUTE,
      ).toISOString(),
      scheduledEnd: new Date(clock.now.getTime() + 180 * MINUTE).toISOString(),
    }),
  );
}

async function seedMainCi(service: IncidentsService, at: At) {
  const opened = await service.applySignals([
    IncidentSignalInputSchema.parse({
      source: "main-ci",
      key: "main-ci:main",
      firing: true,
      system: "main-ci",
      severity: "sev2",
      title: "main is red: pipeline #19256 failed verify",
      summary:
        "@shepherdjerred/temporal#lint: workflows/index.ts has 506 lines (max 500).",
      exitCondition:
        "The next main pipeline passes verify, images, helm-push and delivery-publish.",
      observedAt: at(-40),
      suspect: {
        commitSha: "c39e98ac531c",
        prNumber: 5142,
        branch: "temporal-schedule-split",
        sessionId: "https://claude.ai/code/session_01FixtureMainCiSuspect",
      },
      links: [{ kind: "pipeline", ref: "19256", title: "main #19256" }],
    }),
  ]);
  const ref = opened.results[0]?.identifier;
  if (ref === null || ref === undefined)
    throw new Error("fixture main-ci incident was not opened");
  at(-36);
  const taken = await service.take(
    TakeCommandInputSchema.parse({
      actor: FIXTURE_ACTORS.fixer,
      ref,
      note: "My merge pushed index.ts over the limit; splitting the barrel now.",
    }),
  );
  at(-30);
  const updated = await service.changeStatus(
    ChangeStatusInputSchema.parse({
      actor: FIXTURE_ACTORS.fixer,
      ref: taken.incident.identifier,
      expectedRevision: taken.incident.revision,
      status: "identified",
      note: "Extracting workflow exports into domain sub-barrels.",
    }),
  );
  at(-12);
  await service.postUpdate(
    PostUpdateInputSchema.parse({
      actor: FIXTURE_ACTORS.fixer,
      ref: updated.identifier,
      expectedRevision: updated.revision,
      body: "Fix PR #5145 is green locally; waiting on Woodpecker.",
    }),
  );
}

async function seedDelivery(service: IncidentsService, at: At) {
  const opened = await service.applySignals([
    IncidentSignalInputSchema.parse({
      source: "alertmanager",
      key: "fixture-delivery-recovery",
      firing: true,
      system: "delivery",
      severity: "sev1",
      title:
        "temporal-workers requires recovery and holds the Delivery dispatch barrier",
      summary:
        "A self-hosted deployment ended recovery-required and keeps its locks; every claim answers BUSY.",
      exitCondition:
        "The recovery-required deployment is settled through its recovery reader, DeliveryRecoveryRequired has resolved, and the queued deployments dispatch.",
      observedAt: at(-25),
      links: [
        {
          kind: "alert",
          ref: "fixture-delivery-recovery",
          title: "DeliveryRecoveryRequired",
        },
      ],
    }),
  ]);
  const ref = opened.results[0]?.identifier;
  if (ref === null || ref === undefined)
    throw new Error("fixture Delivery incident was not opened");
  at(-20);
  await service.join(
    JoinInputSchema.parse({
      actor: FIXTURE_ACTORS.blocked,
      ref,
      note: "Blocked deploying errors.",
    }),
  );
  at(-18);
  await service.join(
    JoinInputSchema.parse({ actor: FIXTURE_ACTORS.waiter, ref }),
  );
  at(-4);
  await service.take(
    TakeCommandInputSchema.parse({
      actor: FIXTURE_ACTORS.waiter,
      ref,
      dispatch: true,
      note: "Unowned past the takeover grace; spawning a commander session.",
    }),
  );
}

/** An incident nobody has claimed, past its takeover grace: anyone may take it. */
async function seedUnowned(service: IncidentsService, at: At) {
  at(-30);
  await service.declare(
    DeclareIncidentInputSchema.parse({
      actor: FIXTURE_ACTORS.tracker,
      title: "Loki queries time out; Grafana log panels are empty",
      summary:
        "Log panels across dashboards time out after 30 s since the Loki compactor restarted.",
      severity: "sev3",
      systems: ["observability"],
      components: ["loki"],
      exitCondition:
        "Grafana log panels load the last hour of logs in under 10 seconds.",
    }),
  );
}

/** Seed the five fixture incidents, moving the service clock through their history. */
export async function seedFixtureIncidents(
  service: IncidentsService,
  clock: SeedClock,
): Promise<void> {
  const at: At = (minutes) => {
    const instant = new Date(clock.now.getTime() + minutes * MINUTE);
    clock.setClock(instant);
    return instant.toISOString();
  };
  await seedResolved(service, at);
  await seedMaintenance(service, clock, at);
  await seedMainCi(service, at);
  await seedDelivery(service, at);
  await seedUnowned(service, at);
}
