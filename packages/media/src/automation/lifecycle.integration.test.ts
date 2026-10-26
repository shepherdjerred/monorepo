import { defaultScope } from "#shared/editions/scope.ts";
import { targetWhere } from "#infrastructure/editions/targets.ts";
import { afterAll, describe, expect, test } from "vitest";
import { rm } from "node:fs/promises";
import { verifiedPublicationFixture } from "#automation/publication-proof/verified.test-fixture.ts";
import { createOutboxActivities } from "./store.ts";
import { observeRequesterWatch } from "./watch.ts";
import { automationTestHarness } from "#testing/automation.ts";
describe("durable media Activity invariants in PostgreSQL", () => {
  const { database, context, fixture, cipher } = automationTestHarness();
  const directories: string[] = [];
  afterAll(async () => {
    for (const directory of directories)
      await rm(directory, { recursive: true, force: true });
  });
  test("mark-unwatched cancels old grace and advances generation; rewatch cannot reuse it", async () => {
    const produced = await verifiedPublicationFixture(database(), context());
    const data = produced.files;
    directories.push(data.directory);
    await database().credential.create({
      data: {
        userId: data.user.id,
        kind: "plex",
        ciphertext: cipher.encrypt(
          JSON.stringify({ serverToken: "per-user-fixture" }),
          `plex:${data.user.plexAccountId}`,
        ),
      },
    });
    await database().watchState.create({
      data: {
        userId: data.user.id,
        mediaId: data.media.id,
        watched: true,
        observedAt: new Date(),
        source: "plex_current",
      },
    });
    const decision = await database().retentionDecision.create({
      data: {
        mediaId: data.media.id,
        generation: 1,
        state: "grace_period",
        evidence: {},
        warningAcceptedAt: new Date(0),
        graceUntil: new Date(1),
      },
    });
    produced.state.watched = null;
    expect(
      await observeRequesterWatch(produced.context, data.media.id),
    ).toMatchObject({ complete: false });
    expect(
      await database().watchState.count({ where: { mediaId: data.media.id } }),
    ).toBe(0);
    produced.state.watched = false;
    const userPlex = produced.context.userPlex;
    produced.context.userPlex = (token) => {
      expect(token).toBe("per-user-fixture");
      return userPlex(token);
    };
    const result = await observeRequesterWatch(produced.context, data.media.id);
    expect(result.complete).toBe(true);
    expect(
      await database().mediaIntent.findUnique({
        where: targetWhere(defaultScope(data.media.id)),
      }),
    ).toMatchObject({ generation: 2 });
    expect(
      await database().retentionDecision.findUnique({
        where: { id: decision.id },
      }),
    ).toMatchObject({ state: "cancelled" });
  });

  test("missing requester credentials invalidate formerly fresh watched evidence", async () => {
    const produced = await verifiedPublicationFixture(database(), context());
    const data = produced.files;
    directories.push(data.directory);
    await database().watchState.create({
      data: {
        userId: data.user.id,
        mediaId: data.media.id,
        watched: true,
        observedAt: new Date(),
        source: "plex_current",
      },
    });
    expect(
      await observeRequesterWatch(produced.context, data.media.id),
    ).toMatchObject({ complete: false });
    expect(
      await database().watchState.count({
        where: { mediaId: data.media.id },
      }),
    ).toBe(0);
  });

  test("Temporal outage preserves durable outbox and retry uses identical workflow identity", async () => {
    const data = await fixture();
    const attempted = new Set<string>();
    const failed = createOutboxActivities(database(), async (input) => {
      attempted.add(input.workflowId);
      throw new Error("Temporal unavailable");
    });
    await failed.dispatchMediaOutbox();
    const command = await database().outboxCommand.findUniqueOrThrow({
      where: { operationId: data.input.operationId },
    });
    expect(command.dispatchedAt).toBeNull();
    await database().outboxCommand.update({
      where: { id: command.id },
      data: { availableAt: new Date(0) },
    });
    const accepted: string[] = [];
    await createOutboxActivities(database(), async (input) => {
      accepted.push(input.workflowId);
    }).dispatchMediaOutbox();
    expect(accepted).toContain(`media-operation-${data.input.operationId}`);
    expect(attempted.has(`media-operation-${data.input.operationId}`)).toBe(
      true,
    );
    expect(
      await database().outboxCommand.findUnique({
        where: { id: command.id },
      }),
    ).not.toMatchObject({ dispatchedAt: null });
  });

  test("finishing a deferred operation preserves its durable subtitle journal", async () => {
    const data = await fixture();
    await database().operation.update({
      where: { id: data.input.operationId },
      data: {
        result: {
          subtitleBrowser: { phase: "waiting", ticketId: "opaque" },
          subtitleDownload: { claimed: true },
        },
      },
    });
    await createOutboxActivities(database(), async () => {
      throw new Error("Unexpected dispatch");
    }).finishMediaOperation({
      operationId: data.input.operationId,
      status: "reconciling",
      reason: "subtitle_browser_pending",
    });
    expect(
      await database().operation.findUnique({
        where: { id: data.input.operationId },
      }),
    ).toMatchObject({
      status: "reconciling",
      result: {
        subtitleBrowser: { phase: "waiting", ticketId: "opaque" },
        subtitleDownload: { claimed: true },
        reason: "subtitle_browser_pending",
      },
    });
  });
});
