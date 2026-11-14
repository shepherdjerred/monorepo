import { randomBytes } from "node:crypto";
import { rm } from "node:fs/promises";
import path from "node:path";
import { afterAll, afterEach, beforeAll, expect, test, vi } from "vitest";
import { z } from "zod";
import { CredentialCipher } from "#application/security.ts";
import { libraryPlexFixture } from "#automation/handoff/plex-edit-fixture.ts";
import { prepareHandoffFiles } from "#automation/handoff/files.ts";
import { finishHandoffPreparation } from "#automation/handoff/plan.ts";
import { createHandoffNetworkProducer } from "#migration/handoff-network/producer.ts";
import type { WorkflowStart } from "#automation/store.ts";
import { prepareLibraryBatch } from "#client/library-import/prepare.ts";
import {
  libraryBatchEntries,
  libraryProfileGroups,
} from "#client/library-import/selection.ts";
import { lockDefaultScopes } from "#infrastructure/editions/locks.ts";
import { currentSubtitlePolicies } from "#infrastructure/subtitle-policy.ts";
import {
  captureFixture,
  mediaFixture,
} from "#migration/bundle-test-fixtures.ts";
import {
  CommandResultSchema,
  ProfileListSchema,
  QualityRulesSchema,
} from "#shared/api.ts";
import { UserSchema } from "#shared/contract.ts";
import { defaultScope } from "#shared/editions/scope.ts";
import { BundleReviewProtocolSchema } from "#shared/handoff/library-bundle.ts";
import {
  LibrarySubtitlePolicyVersionsSchema,
  ApplyLibraryHandoffV3Schema,
} from "#shared/handoff/library-v3.ts";
import { HandoffDetailSchema } from "#shared/handoff.ts";
import { MigrationProposalSchema } from "#shared/migration.ts";
import { HandoffScopeProtocolSchema } from "#shared/handoff/protocol.ts";
import { startMediaTestPostgres } from "#testing/postgres.ts";
import { SystemHttpBrowser } from "./browser.ts";
import { systemExternalServices } from "./external.ts";
import { createSystemHttpServer } from "./http.ts";

let cluster: Awaited<ReturnType<typeof startMediaTestPostgres>>;
let fixture: Awaited<ReturnType<typeof libraryPlexFixture>>;
let external: ReturnType<typeof systemExternalServices>;
let http: ReturnType<typeof createSystemHttpServer>;
let owner: z.infer<typeof UserSchema>;
let browser: SystemHttpBrowser;
const starts: WorkflowStart[] = [];

async function read<T>(
  client: SystemHttpBrowser,
  route: string,
  schema: z.ZodType<T>,
  body?: unknown,
) {
  const response = await client.request(
    `/api/v1${route}`,
    body === undefined ? {} : { body, key: crypto.randomUUID() },
  );
  const payload: unknown = await response.json();
  const diagnostic = JSON.stringify({
    route,
    body: payload,
    errors: http.errors.map((error) => ({
      name: error.name,
      message: error.message,
    })),
  });
  expect(response.status, diagnostic).toBeGreaterThanOrEqual(200);
  expect(response.status, diagnostic).toBeLessThan(300);
  return schema.parse(payload);
}
async function login(client: SystemHttpBrowser) {
  const pin = await read(
    client,
    "/auth/plex/start",
    z.object({ id: z.uuid() }),
    {},
  );
  const result = await read(
    client,
    `/auth/plex/poll/${pin.id}`,
    z.object({ status: z.literal("authenticated"), user: UserSchema }),
    {},
  );
  return result.user;
}
async function approveLibraryScope(
  review: z.infer<typeof BundleReviewProtocolSchema>,
  selected: z.infer<typeof BundleReviewProtocolSchema>["selection"],
) {
  return read(
    browser,
    `/admin/migration/bundles/${review.id}/review`,
    CommandResultSchema,
    {
      action: "approve",
      expectedVersion: review.version,
      bundleHash: review.manifest.bundleHash,
      reportHash: review.report.reportHash,
      recoveryEpoch: review.recoveryEpoch,
      runtimeVersion: review.runtimeVersion,
      acknowledgeNoOwnershipTransfer: true,
      selected,
    },
  );
}
async function rejectUnapprovedFile(
  created: z.infer<typeof BundleReviewProtocolSchema>,
  unrelatedId: string,
  provenanceKey: string,
) {
  const unrelatedEntries = created.report.entries.filter(
    (entry) => entry.kind === "media" && entry.mediaIds.includes(unrelatedId),
  );
  expect(unrelatedEntries).toHaveLength(1);
  expect(unrelatedEntries[0]?.state).toBe("adoptable_evidence_ready");
  await approveLibraryScope(
    created,
    unrelatedEntries.map((entry) => ({
      provenanceKey: entry.provenanceKey,
      evidenceHash: entry.observationHash,
    })),
  );
  const unrelatedReview = await read(
    browser,
    `/admin/migration/bundles/${created.id}`,
    BundleReviewProtocolSchema,
  );
  const rejectedPreview = await browser.request(
    `/api/v1/admin/migration/personal/passive?${new URLSearchParams([
      ["bundleReviewId", created.id],
      ["bundleReviewVersion", String(unrelatedReview.version)],
      ["provenanceKey", provenanceKey],
    ]).toString()}`,
  );
  expect(rejectedPreview.status).toBe(409);
  expect(await rejectedPreview.json()).toMatchObject({
    error: { code: "handoff_scope_expansion_requires_review" },
  });
  return unrelatedReview;
}
function bindLibraryClient() {
  const originalFetch = globalThis.fetch;
  vi.stubGlobal(
    "fetch",
    async (input: string | URL | Request, init?: RequestInit) => {
      if (typeof input !== "string" || !input.startsWith("/api/v1/"))
        return originalFetch(input, init);
      const response = await browser.request(input);
      const diagnostic = JSON.stringify({
        route: input,
        body: response.ok ? null : await response.clone().json(),
        errors: http.errors.map((error) => ({
          name: error.name,
          message: error.message,
        })),
      });
      expect(response.status, diagnostic).toBeGreaterThanOrEqual(200);
      expect(response.status, diagnostic).toBeLessThan(300);
      return response;
    },
  );
}
beforeAll(async () => {
  cluster = await startMediaTestPostgres();
  fixture = await libraryPlexFixture(cluster.database, "directors_cut", {
    classify: "from_filename",
  });
  external = systemExternalServices();
  http = createSystemHttpServer({
    ...external,
    db: cluster.database,
    cipher: new CredentialCipher(randomBytes(32).toString("base64")),
    plexTransport: external.transport,
    startWorkflow: (input) => {
      starts.push(input);
      return Promise.resolve();
    },
    describeWorkflow: () => Promise.resolve(null),
  });
  browser = new SystemHttpBrowser(http.origin);
  owner = await login(browser);
}, 60_000);
afterEach(() => {
  vi.unstubAllGlobals();
});
afterAll(async () => {
  await http.close();
  await external.close();
  await cluster.close();
  await rm(fixture.directory, { recursive: true });
});

test("the owner batch producer prepares actual library-only HTTP captures and queues the exact scope without adopting or requesting", async () => {
  const requestsBefore = await cluster.database.mediaRequest.count();
  const profile = await cluster.database.qualityProfile.findUniqueOrThrow({
    where: { id: fixture.profile.id },
  });
  const resolved = QualityRulesSchema.parse(profile.rules).resolved;
  if (resolved === undefined) throw new Error("Missing imported profile");
  const media = mediaFixture("1", "movie", {
    tmdb: Number(fixture.network.media.tmdbId),
  });
  media.profileSourceId = String(resolved.profile.id);
  const unrelated = await cluster.database.mediaItem.create({
    data: {
      kind: "movie",
      title: "Unrelated review target",
      tmdbId: 2_000_000_001,
    },
  });
  const movie = await read(
    browser,
    "/admin/migration",
    MigrationProposalSchema,
    {
      snapshot: captureFixture("radarr", [
        media,
        mediaFixture("unrelated", "movie", { tmdb: 2_000_000_001 }),
        {
          kind: "file",
          sourceId: "file1",
          mediaSourceIds: ["1"],
          path: `/movies/${path.basename(fixture.target)}`,
          sizeBytes: Buffer.byteLength(fixture.bytes),
          checksum: null,
          downloadHash: null,
          qualitySourceId: "3",
        },
      ]),
    },
  );
  const tv = await read(browser, "/admin/migration", MigrationProposalSchema, {
    snapshot: captureFixture("sonarr"),
  });
  const rootMappings = [
    {
      captureId: movie.captureId,
      sourceRoot: "/movies",
      canonicalRoot: fixture.context.files.roots.movies.library,
      verified: false,
    },
    {
      captureId: tv.captureId,
      sourceRoot: "/tv",
      canonicalRoot: fixture.context.files.roots.tv.library,
      verified: false,
    },
  ];
  const created = await read(
    browser,
    "/admin/migration/bundles",
    BundleReviewProtocolSchema,
    {
      schemaVersion: 2,
      purpose: "initial_library",
      captureIds: [movie.captureId, tv.captureId],
      rootMappings,
    },
  );
  const canonicalMedia = created.report.entries.filter(
    (entry) =>
      entry.kind === "media" &&
      entry.mediaIds.length === 1 &&
      entry.mediaIds[0] === fixture.network.media.id,
  );
  expect(canonicalMedia).toHaveLength(1);
  expect(canonicalMedia[0]?.state).toBe("adoptable_evidence_ready");
  const capturedFiles = created.report.entries.filter(
    (entry) => entry.kind === "file" && entry.sourceId === "file1",
  );
  expect(capturedFiles).toHaveLength(1);
  expect(capturedFiles[0]).toMatchObject({
    state: "protected_exact",
    reasons: expect.arrayContaining(["live_mount_and_checksum_proof_required"]),
  });
  const selected = canonicalMedia.map((entry) => ({
    provenanceKey: entry.provenanceKey,
    evidenceHash: entry.observationHash,
  }));
  expect(selected.map((entry) => entry.provenanceKey)).not.toContain(
    capturedFiles[0]?.provenanceKey,
  );
  const unrelatedReview = await rejectUnapprovedFile(
    created,
    unrelated.id,
    z.string().parse(capturedFiles[0]?.provenanceKey),
  );
  await approveLibraryScope(unrelatedReview, selected);
  const review = await read(
    browser,
    `/admin/migration/bundles/${created.id}`,
    BundleReviewProtocolSchema,
  );
  const keys = review.report.entries
    .filter((entry) => entry.kind === "file")
    .map((entry) => entry.provenanceKey);
  const batch = libraryBatchEntries(review, keys);
  const profiles = await read(browser, "/profiles", ProfileListSchema);
  const groups = libraryProfileGroups(review, batch.media, profiles);
  bindLibraryClient();
  const body = await prepareLibraryBatch(
    review,
    { files: keys, profiles: {}, cuts: {}, chinese: {} },
    groups,
  );
  const commandKey = crypto.randomUUID();
  const response = await browser.request("/api/v1/admin/handoffs", {
    body,
    key: commandKey,
  });
  expect(response.status).toBe(202);
  const command = CommandResultSchema.parse(await response.json());
  const handoffId = z.uuid().parse(command.handoffId);
  const replay = await browser.request("/api/v1/admin/handoffs", {
    body,
    key: commandKey,
  });
  expect(await replay.json()).toEqual(command);
  const stored = await cluster.database.mediaHandoffPlan.findUniqueOrThrow({
    where: { id: handoffId },
  });
  expect(HandoffScopeProtocolSchema.parse(stored.scope)).toMatchObject({
    schemaVersion: 3,
    claims: [],
    files: [{ canonicalPath: fixture.target, edition: "directors_cut" }],
    request: { movies: [], plexEditionLabels: "update_in_place" },
  });
  await expect
    .poll(() => starts.filter((start) => start.input["planId"] === handoffId))
    .toHaveLength(1);
  await createHandoffNetworkProducer(fixture.network.context)(handoffId);
  const proof = await prepareHandoffFiles(fixture.context, handoffId);
  await finishHandoffPreparation(cluster.database, handoffId, proof);
  const detail = await read(
    browser,
    `/admin/handoffs/${handoffId}`,
    HandoffDetailSchema.safeExtend({ scope: HandoffScopeProtocolSchema }),
  );
  expect(detail.state).toBe("awaiting_review");
  const approval = await browser.request(
    `/api/v1/admin/handoffs/${handoffId}/apply`,
    {
      key: crypto.randomUUID(),
      body: ApplyLibraryHandoffV3Schema.parse({
        schemaVersion: 3,
        expectedVersion: detail.version,
        planHash: detail.planHash,
        recoveryEpoch: body.recoveryEpoch,
        runtimeVersion: body.runtimeVersion,
        acknowledgeRecoveryHolds: true,
      }),
    },
  );
  expect(approval.status).toBe(202);
  const applyCommand = CommandResultSchema.parse(await approval.json());
  await expect
    .poll(() =>
      starts.filter(
        (start) =>
          start.workflowType === "applyLibraryHandoffV3Workflow" &&
          start.input["planId"] === handoffId,
      ),
    )
    .toMatchObject([
      {
        input: {
          schemaVersion: 3,
          actorId: owner.id,
          operationId: applyCommand.operationId,
          planId: handoffId,
          planHash: detail.planHash,
        },
      },
    ]);
  expect(fixture.item().editionTitle).toBe("Incorrect label");
  expect(await cluster.database.libraryAsset.count()).toBe(0);
  expect(await cluster.database.mediaRequest.count()).toBe(requestsBefore);
  expect(
    await cluster.database.mediaRequest.count({ where: { userId: owner.id } }),
  ).toBe(0);
});

test("policy version review returns the target's own version independently of its inherited effective policy", async () => {
  const db = cluster.database;
  const series = await db.mediaItem.create({
    data: { kind: "series", title: "Policy parent" },
  });
  const episode = await db.mediaItem.create({
    data: {
      kind: "episode",
      title: "Policy child",
      parentId: series.id,
      seasonNumber: 1,
      episodeNumber: 1,
    },
  });
  await db.$transaction((tx) =>
    lockDefaultScopes(tx, [defaultScope(series.id)], { createMissing: true }),
  );
  await db.mediaSubtitlePolicyVersion.create({
    data: {
      mediaId: series.id,
      version: 0,
      actorId: owner.id,
      recoveryEpoch: 0,
      source: { fixture: "actual prior policy" },
      rules: { schemaVersion: 1, targets: [], protectedReasons: [] },
    },
  });
  expect(await currentSubtitlePolicies(db, [episode.id])).toMatchObject([
    { version: 0 },
  ]);
  const query = new URLSearchParams([
    ["mediaId", series.id],
    ["mediaId", episode.id],
  ]);
  const versions = await read(
    browser,
    `/admin/handoffs/subtitle-policies?${query.toString()}`,
    LibrarySubtitlePolicyVersionsSchema,
  );
  expect(versions).toEqual(
    expect.arrayContaining([
      { mediaId: series.id, version: 0 },
      { mediaId: episode.id, version: -1 },
    ]),
  );
  const missing = await browser.request(
    `/api/v1/admin/handoffs/subtitle-policies?mediaId=${crypto.randomUUID()}`,
  );
  expect(missing.status).toBe(409);
  const duplicate = await browser.request(
    `/api/v1/admin/handoffs/subtitle-policies?mediaId=${series.id}&mediaId=${series.id}`,
  );
  expect(duplicate.status).toBe(400);
  external.selectAccount("1002");
  const member = new SystemHttpBrowser(http.origin);
  const memberUser = await login(member);
  expect(memberUser.role).toBe("member");
  const denied = await member.request(
    `/api/v1/admin/handoffs/subtitle-policies?mediaId=${series.id}`,
  );
  expect(denied.status).toBe(403);
});
