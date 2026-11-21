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
  outcome?: "failed";
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

/** Arcade's build of the same commit, failed in qualification with a raw reason. */
async function failAnotherService(
  delivery: Delivery,
  sourceRevision: string,
  pipelineNumber: number,
) {
  const build = await delivery.publish(
    {
      requestId: `history/partial/arcade`,
      serviceId: "arcade",
      sourceRevision,
      ciUrl: `https://woodpecker.sjer.red/repos/1/pipeline/${String(pipelineNumber)}`,
      verifiedAt: new Date().toISOString(),
      artifacts: [
        {
          id: "history/partial/arcade-image",
          component: "server",
          kind: "image",
          uri: "docker.io/shepherdjerred/arcade",
          version: "0.9.0",
          digest: `sha256:${"d".repeat(64)}`,
        },
      ],
    },
    testPublisher,
    { repositoryId: 1, pipelineNumber },
  );
  await delivery.qualify(
    build.buildId,
    "failed",
    testExecutor,
    PARTIAL_FAILURE_REASON,
  );
}

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
    if (position === PARTIAL_FAILURE_POSITION)
      await failAnotherService(delivery, sourceRevision, pipelineNumber);
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
