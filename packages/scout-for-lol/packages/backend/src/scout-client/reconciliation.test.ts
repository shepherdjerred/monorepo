import { beforeEach, expect, test, vi } from "vitest";
import { RiotMatchIdSchema } from "@scout-for-lol/domain/identity/brands.ts";

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
  update: vi.fn(),
  revalidate: vi.fn(),
  start: vi.fn(),
  project: vi.fn(),
}));
vi.mock("#src/database/index.ts", () => ({
  prisma: {
    scoutClientObservation: { findMany: mocks.findMany, update: mocks.update },
    scoutClientGameResult: { findFirst: vi.fn(() => Promise.resolve(null)) },
  },
}));
vi.mock("#src/configuration/flags.ts", () => ({
  isFeatureHardDisabled: () => false,
  isPolicyEnabled: () => Promise.resolve(true),
}));
vi.mock("./revalidation.ts", () => ({
  revalidateClientObservation: mocks.revalidate,
}));
vi.mock("./game-results.ts", () => ({
  projectClientGameResult: mocks.project,
}));
vi.mock("./clash-entities.ts", () => ({
  projectClashEntity: vi.fn(() => Promise.resolve()),
}));
vi.mock("./ingress.ts", () => ({ startAcceptedClientMatches: mocks.start }));

const { reconcileAcceptedClientEvidence } = await import("./reconciliation.ts");
const { ClientBindingReconciliationPending } =
  await import("./late-binding.ts");

const riotMatchId = RiotMatchIdSchema.parse("NA1_7101");
const now = new Date("2026-11-10T12:00:00.000Z");

function row(observationId: string) {
  return {
    observationId,
    kind: "post_game",
    platformId: "NA1",
    device: { ownerId: "160509172704739328" },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.findMany.mockResolvedValue([row("pending"), row("broken")]);
  mocks.update.mockResolvedValue({});
  mocks.project.mockResolvedValue("projected");
  mocks.revalidate.mockImplementation((candidate: { observationId: string }) =>
    Promise.resolve({
      observationId: candidate.observationId,
      kind: "post_game",
      platformId: "NA1",
      gameId: "7101",
      localPuuid: "p".repeat(78),
    }),
  );
});

test("a pending late binding defers its row without failing the page", async () => {
  mocks.start.mockRejectedValue(
    new ClientBindingReconciliationPending(riotMatchId),
  );

  await expect(reconcileAcceptedClientEvidence(now)).resolves.toBe(2);

  // Only the pre-work checkpoint ran, so both rows stay incomplete and retryable.
  expect(mocks.update).toHaveBeenCalledTimes(2);
  for (const [call] of mocks.update.mock.calls) {
    expect(call).toMatchObject({
      data: { recoveryAttemptAt: now, recoveryComplete: false },
    });
  }
});

test("an unexpected row failure still fails the page", async () => {
  mocks.start
    .mockRejectedValueOnce(new ClientBindingReconciliationPending(riotMatchId))
    .mockRejectedValueOnce(new Error("Temporal is unavailable"));

  const page = reconcileAcceptedClientEvidence(now);
  await expect(page).rejects.toBeInstanceOf(AggregateError);
  await expect(page).rejects.toMatchObject({
    errors: [new Error("Temporal is unavailable")],
  });
});

test("an Arena post-game row completes as unsupported_mode and is not retried", async () => {
  mocks.findMany.mockResolvedValue([row("arena")]);
  mocks.project.mockResolvedValue("unsupported_mode");

  await expect(reconcileAcceptedClientEvidence(now)).resolves.toBe(1);

  expect(mocks.start).not.toHaveBeenCalled();
  expect(mocks.update).toHaveBeenLastCalledWith({
    where: { observationId: "arena" },
    data: expect.objectContaining({ recoveryComplete: true }),
  });
});
