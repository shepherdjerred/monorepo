import type { Database } from "#infrastructure/database.ts";
import type { Delivery } from "#infrastructure/delivery.ts";
import { testExecutor, testOperator, testPublisher } from "#testing/seed.ts";

// Commit history for the browser harness. Publication, qualification and
// source capture all go through Delivery's own operations.

/** A service no other seed deploys, so its history changes no other page's newest state. */
const SERVICE = "birmel";
const FIRST_PIPELINE = 301;

/** The commit whose CI failed: its title must show all the same. */
export const FAILED_COMMIT_TITLE =
  "fix(birmel): reconnect to voice after a gateway resume";
/** A title with one unbreakable token, to prove a narrow row wraps instead of scrolling. */
export const LONG_COMMIT_TITLE =
  "refactor(birmel): replace packages/birmel/src/voice/reallyLongGeneratedIdentifierNameThatNeverBreaksOnItsOwnAcrossTheWholeRow.ts with a typed session store (#4104)";

/**
 * Oldest first. A null title is a commit Delivery saw before it captured
 * titles: its row shows the sha alone.
 */
const HISTORY: {
  title: string | null;
  author: string;
  /**
   * `failed`: Birmel's build failed CI. `pipeline_failed`: the whole
   * pipeline failed before it published Birmel, so only CI's own build of
   * the commit exists, and it failed.
   */
  outcome?: "failed" | "pipeline_failed";
}[] = [
  {
    title: "feat(birmel): add the voice session store",
    author: "shepherdjerred",
  },
  {
    title: "chore(deps): update dependency discord.js to v14.19.3",
    author: "renovate[bot]",
  },
  { title: null, author: "shepherdjerred" },
  {
    title: "fix(birmel): keep the music queue across reconnects (#4071)",
    author: "shepherdjerred",
  },
  {
    title: "feat(birmel): announce the next track in the channel topic",
    author: "shepherdjerred",
  },
  {
    title: "docs(birmel): explain the voice permission model",
    author: "shepherdjerred",
  },
  { title: FAILED_COMMIT_TITLE, author: "shepherdjerred", outcome: "failed" },
  {
    title: "fix(birmel): retry voice reconnects with backoff (#4082)",
    author: "shepherdjerred",
  },
  {
    title: "chore(deps): update dependency @discordjs/voice to v0.19.1",
    author: "renovate[bot]",
  },
  {
    title: "test(birmel): cover the queue's shuffle order",
    author: "shepherdjerred",
  },
  {
    title: "perf(birmel): cache resolved track metadata",
    author: "shepherdjerred",
  },
  { title: LONG_COMMIT_TITLE, author: "shepherdjerred" },
  {
    title: "feat(birmel): add a /skip vote threshold",
    author: "shepherdjerred",
  },
  { title: "chore(deps): lock file maintenance", author: "renovate[bot]" },
  {
    title: "fix(birmel): stop double-posting the now-playing embed",
    author: "shepherdjerred",
  },
  {
    title: "ci(birmel): split the image build from the chart package",
    author: "shepherdjerred",
    outcome: "pipeline_failed",
  },
  {
    title: "feat(birmel): remember each guild's volume",
    author: "shepherdjerred",
  },
  {
    title: "fix(birmel): handle a stage channel without speakers (#4131)",
    author: "shepherdjerred",
  },
  {
    title: "chore(birmel): drop the unused lavalink client",
    author: "shepherdjerred",
  },
  {
    title: "feat(birmel): show queue length in the status line",
    author: "shepherdjerred",
  },
];

/** Distinct in their first seven digits, and unlike any other seed's revision. */
const revision = (position: number) =>
  `${position.toString(16).padStart(2, "0")}${"c0ffee".repeat(7)}`.slice(0, 40);

/** The full sha of the history commit at a position, oldest first. */
export const historySha = (position: number) => revision(position + 1);

/** The Woodpecker pipeline that built the history commit at a position. */
export const historyPipeline = (position: number) => FIRST_PIPELINE + position;

/** The commit whose only build, Birmel's, failed CI; the next commit's passed. */
export const FAILED_POSITION = HISTORY.findIndex(
  (commit) => commit.outcome === "failed",
);

/**
 * Birmel ships a new image every fourth commit. Its prod environment, which
 * needs a manual release, accepted the third, has the fourth queued with no
 * stage started, and has never been asked for the fifth.
 */
export const ACCEPTED_POSITION = 8;
export const QUEUED_POSITION = 12;
export const UNRELEASED_POSITION = 16;
/** How long ago the fourth was queued: past the overview's attention threshold. */
export const QUEUED_MINUTES = 50;
/**
 * A commit whose CI failed for one service while Birmel's change from it is
 * live through the newer accepted release.
 */
export const PARTIAL_FAILURE_POSITION = 4;
export const PARTIAL_FAILURE_REASON = `archive:arcade-client requires exact image:arcade digest sha256:${"c".repeat(64)}`;

/** The lineage Birmel's sets had before a component-list change. */
const PREVIOUS_LINEAGE = "0".repeat(64);

/**
 * A commit whose CI failed for Golink while Birmel's change from it waits on
 * a manual release in prod. The next commit's Golink build passed, so that
 * failure held nothing back: the commit's headline is the manual release.
 * Golink has no environment in the harness, so its passing build deploys
 * nothing.
 */
export const CARRIED_FAILURE_POSITION = UNRELEASED_POSITION;
export const CARRIER_POSITION = UNRELEASED_POSITION + 1;

/**
 * A commit whose whole pipeline failed: CI published only its own build of
 * the commit, which failed, and nothing for Birmel. The next commit's
 * pipeline passed and released Birmel, so this commit's change ships in that
 * release, which waits on a manual release in prod.
 */
export const PIPELINE_FAILURE_POSITION = HISTORY.findIndex(
  (commit) => commit.outcome === "pipeline_failed",
);
export const PIPELINE_CARRIER_POSITION = PIPELINE_FAILURE_POSITION + 1;

type OtherBuild = {
  serviceId: string;
  digest: string;
  failure?: string;
  /** Ship no new image and keep the one built at this history position. */
  retainFrom?: number;
};

/** The image another service's build at a pipeline publishes. */
const otherImage = (serviceId: string, pipelineNumber: number) =>
  `history/${String(pipelineNumber)}/${serviceId}-image`;

/** Another service's build of a history commit, verified or failed with a reason; its id. */
async function publishOther(
  delivery: Delivery,
  build: OtherBuild & { sourceRevision: string; pipelineNumber: number },
) {
  const published = await delivery.publish(
    {
      requestId: `history/${String(build.pipelineNumber)}/${build.serviceId}`,
      serviceId: build.serviceId,
      sourceRevision: build.sourceRevision,
      ciUrl: `https://woodpecker.sjer.red/repos/1/pipeline/${String(build.pipelineNumber)}`,
      verifiedAt: new Date().toISOString(),
      artifacts:
        build.retainFrom === undefined
          ? [
              {
                id: otherImage(build.serviceId, build.pipelineNumber),
                component: "server",
                kind: "image",
                uri: `docker.io/shepherdjerred/${build.serviceId}`,
                version: `0.${String(build.pipelineNumber)}.0`,
                digest: `sha256:${build.digest.repeat(64)}`,
              },
            ]
          : [],
      retainedArtifactIds:
        build.retainFrom === undefined
          ? []
          : [otherImage(build.serviceId, FIRST_PIPELINE + build.retainFrom)],
    },
    testPublisher,
    { repositoryId: 1, pipelineNumber: build.pipelineNumber },
  );
  await delivery.qualify(
    published.buildId,
    build.failure === undefined ? "verified" : "failed",
    testExecutor,
    build.failure,
  );
  return published.buildId;
}

const PIPELINE_FAILED = "CI pipeline did not pass exact main push verification";

/** The builds of other services the history's commits carry, by position. */
const OTHERS: Record<number, OtherBuild[]> = {
  // CI's own image, which the pipeline failure's carrier keeps unchanged.
  0: [{ serviceId: "ci", digest: "a" }],
  // Arcade's build failed in qualification with a raw reason; nothing later passes.
  [PARTIAL_FAILURE_POSITION]: [
    { serviceId: "arcade", digest: "d", failure: PARTIAL_FAILURE_REASON },
  ],
  [PIPELINE_FAILURE_POSITION]: [
    { serviceId: "ci", digest: "b", failure: PIPELINE_FAILED },
  ],
  [CARRIED_FAILURE_POSITION]: [
    { serviceId: "golink", digest: "e", failure: PIPELINE_FAILED },
    { serviceId: "ci", digest: "a", retainFrom: 0 },
  ],
  [CARRIER_POSITION]: [{ serviceId: "golink", digest: "f" }],
};

/**
 * Give Birmel a prod environment and record where its history stands there:
 * the release of `ACCEPTED_POSITION` accepted, the one of `QUEUED_POSITION`
 * queued `QUEUED_MINUTES` ago with no stage started, and nothing asked for
 * `UNRELEASED_POSITION`. The environment is not enabled for dispatch, so the
 * queued deployment stays queued. Deployments are written as records,
 * dated in the past, so they sort behind every other seed's.
 */
export async function seedBirmelRelease(
  delivery: Delivery,
  database: Database,
) {
  await delivery.registerPipeline(
    "birmel/1",
    { kind: "manual", reason: "Browser fixture: Birmel releases by hand" },
    testOperator,
  );
  const environment = await delivery.registerEnvironment(
    {
      id: "birmel/prod",
      serviceId: SERVICE,
      name: "prod",
      pipelineRevisionId: "birmel/1",
      configurationRevision: "birmel/config/1",
      configuration: {},
      automatic: false,
    },
    testOperator,
  );
  const row = await database.environment.findUniqueOrThrow({
    where: { id: environment.id },
  });
  const [sets, builds] = await Promise.all([
    database.versionSet.findMany({ where: { serviceId: SERVICE } }),
    database.build.findMany({
      where: { serviceId: SERVICE },
      select: { id: true, sourceRevision: true },
    }),
  ]);
  const setOf = (position: number) => {
    const build = builds.find(
      (entry) => entry.sourceRevision === historySha(position),
    );
    const set = sets.find((entry) => entry.qualifiedBuildId === build?.id);
    if (set === undefined)
      throw new Error(`Birmel's commit ${String(position)} composed no set`);
    return set;
  };
  const now = Date.now();
  const record = (
    id: string,
    position: number,
    status: string,
    minutesAgo: number,
  ) =>
    database.deployment.create({
      data: {
        id,
        requestId: `history/${id}`,
        environmentId: row.id,
        serviceId: SERVICE,
        versionSetRevisionId: setOf(position).id,
        pipelineRevisionId: row.pipelineRevisionId,
        configurationId: row.declaredConfigurationId,
        catalogRevision: "test-catalog",
        expectedGeneration: row.generation,
        kind: "deploy",
        status,
        requestedBy: testOperator.id,
        createdAt: new Date(now - minutesAgo * 60_000),
        ...(status === "succeeded"
          ? {
              startedAt: new Date(now - (minutesAgo - 1) * 60_000),
              finishedAt: new Date(now - (minutesAgo - 2) * 60_000),
            }
          : {}),
      },
    });
  // The partial-failure commit's release ran in prod first. Then a component
  // list change started a new lineage: every set before the accepted one
  // belongs to the previous lineage, so only the newer set's place in main's
  // history says the accepted release still carries that change.
  await record("birmel-first", PARTIAL_FAILURE_POSITION, "succeeded", 240);
  await database.versionSet.updateMany({
    where: {
      id: {
        in: [0, PARTIAL_FAILURE_POSITION].map((position) => setOf(position).id),
      },
    },
    data: { lineage: PREVIOUS_LINEAGE },
  });
  const accepted = await record(
    "birmel-accepted",
    ACCEPTED_POSITION,
    "succeeded",
    180,
  );
  await database.environment.update({
    where: { id: row.id },
    data: {
      acceptedVersionSetRevisionId: accepted.versionSetRevisionId,
      acceptedDeploymentId: accepted.id,
    },
  });
  await record("birmel-queued", QUEUED_POSITION, "queued", QUEUED_MINUTES);
  // Nothing was asked for the newest set.
  setOf(UNRELEASED_POSITION);
}

/** The other services' builds of the history commit at a position. */
async function publishOthers(delivery: Delivery, position: number) {
  for (const other of OTHERS[position] ?? [])
    await publishOther(delivery, {
      ...other,
      sourceRevision: historySha(position),
      pipelineNumber: historyPipeline(position),
    });
}

/**
 * A history commit whose pipeline failed before it published Birmel: CI's
 * own failed build, and the commit's title, are all Delivery holds.
 */
async function seedPipelineFailure(
  delivery: Delivery,
  position: number,
  { title, author }: { title: string | null; author: string },
) {
  const others = OTHERS[position] ?? [];
  const [ci] = others;
  if (title === null || ci === undefined || others.length > 1)
    throw new Error("A failed pipeline records CI's build and a title");
  const sourceRevision = historySha(position);
  const pipelineNumber = historyPipeline(position);
  const buildId = await publishOther(delivery, {
    ...ci,
    sourceRevision,
    pipelineNumber,
  });
  await delivery.recordSourceCommit({
    sourceRevision,
    message: `${title}\n\nSeeded by the browser harness.`,
    author,
    pipelineNumber,
    buildId,
    actor: testExecutor,
    requestId: `history/${String(position + 1)}/source`,
  });
}

/**
 * Publish enough older commits that the commit list pages. Call this before
 * every other seed, so these are the oldest commits and builds the harness has
 * and every newest-first page keeps showing the other seeds' rows first. Every
 * fourth commit ships a new image; the rest retain it, as a commit that
 * changed nothing for the service does.
 */
export async function seedCommitHistory(delivery: Delivery) {
  let image: string | undefined;
  for (const [position, commit] of HISTORY.entries()) {
    const pipelineNumber = FIRST_PIPELINE + position;
    const sourceRevision = revision(position + 1);
    const tag = String(position + 1);
    if (commit.outcome === "pipeline_failed") {
      await seedPipelineFailure(delivery, position, commit);
      continue;
    }
    const ships = position % 4 === 0;
    const artifactId = `history/${tag}/image`;
    if (!ships && image === undefined)
      throw new Error("Commit history must begin with a shipped image");
    const build = await delivery.publish(
      {
        requestId: `history/${tag}`,
        serviceId: SERVICE,
        sourceRevision,
        ciUrl: `https://woodpecker.sjer.red/repos/1/pipeline/${String(pipelineNumber)}`,
        verifiedAt: new Date().toISOString(),
        artifacts: ships
          ? [
              {
                id: artifactId,
                component: "server",
                kind: "image",
                uri: "docker.io/shepherdjerred/birmel",
                version: `2.${tag}.0`,
                digest: `sha256:${sourceRevision}${"0".repeat(24)}`,
              },
            ]
          : [],
        retainedArtifactIds: ships || image === undefined ? [] : [image],
      },
      testPublisher,
      { repositoryId: 1, pipelineNumber },
    );
    if (ships) image = artifactId;
    await delivery.qualify(
      build.buildId,
      commit.outcome ?? "verified",
      testExecutor,
    );
    await publishOthers(delivery, position);
    if (commit.title !== null)
      await delivery.recordSourceCommit({
        sourceRevision,
        message: `${commit.title}\n\nSeeded by the browser harness.`,
        author: commit.author,
        pipelineNumber,
        buildId: build.buildId,
        actor: testExecutor,
        requestId: `history/${tag}/source`,
      });
  }
}

/**
 * Record what qualification would have read from Woodpecker for every commit
 * the other seeds published. A commit already recorded keeps its values, and
 * one the history left without a title stays without.
 */
export async function describeSeededCommits(delivery: Delivery) {
  const builds = await delivery.database.build.findMany({
    where: { sourceKind: "ci", serviceId: { not: SERVICE } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: {
      id: true,
      sourceRevision: true,
      serviceId: true,
      pipelineNumber: true,
    },
  });
  const described = new Set<string>();
  for (const build of builds) {
    if (described.has(build.sourceRevision)) continue;
    described.add(build.sourceRevision);
    if (build.pipelineNumber === null)
      throw new Error("A CI build names its pipeline");
    await delivery.recordSourceCommit({
      sourceRevision: build.sourceRevision,
      message: `feat(${build.serviceId}): publish the ${build.serviceId} fixture\n\nSeeded by the browser harness.`,
      author: "shepherdjerred",
      pipelineNumber: build.pipelineNumber,
      buildId: build.id,
      actor: testExecutor,
      requestId: `describe/${build.id}`,
    });
  }
}
