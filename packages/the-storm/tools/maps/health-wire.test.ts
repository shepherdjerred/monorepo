import { describe, expect, it } from "vitest";
import {
  HealthSample,
  HealthCapabilities,
  HealthFall,
  HealthRegain,
  HealthPrediction,
  HealthStatus,
  healthContract,
  inspectNativeRegains,
  summarizeHealth,
} from "./health-wire.ts";

const identity = {
  match: "00000000-0000-4000-8000-000000000001",
  body: "00000000-0000-4000-8000-000000000002",
  world: "00000000-0000-4000-8000-000000000003",
};
const traversal = {
  maySprint: true,
  safeFallDistance: 3,
  fallDamageMultiplier: 1,
  fallProtectionPoints: 0,
  resistanceAmplifier: -1,
  resistanceUntilTick: -1,
  noFallUntilTick: -1,
  slowFallingUntilTick: -1,
  healingConsumables: 0,
  regenerationAmplifier: -1,
  regenerationUntilTick: -1,
  jumpBoostAmplifier: -1,
  jumpBoostUntilTick: -1,
  maxHealth: 20,
  fallDistance: 0,
};

/** Synthetic contract examples are never native acceptance evidence. */
function fixture(kit = "trooper", drops = 1, refused = false) {
  const maximum = kit === "juggernaut" ? 30 : 20;
  let sequence = 1;
  const sample = (serverTick: number, health: number, y: number) =>
    HealthSample.parse({
      sequence: ++sequence,
      serverTick,
      ...identity,
      kit,
      alive: true,
      health,
      absorption: 0,
      maxHealth: maximum,
      lastHurtTick: y === 65 ? serverTick : -1,
      position: [22.5, y, 6.5],
      velocity: [0, y === 69 ? -0.6 : 0, 0],
      onGround: y !== 69,
      fallDistance: y === 69 ? 4 : 0,
      noDamageTicks: 0,
      sprinting: false,
      inWater: false,
      foodLevel: 7,
      saturation: 0,
      difficulty: "HARD",
      traversal: {
        ...traversal,
        maxHealth: maximum,
        maySprint: kit !== "juggernaut",
        fallDistance: y === 69 ? 4 : 0,
      },
    });
  const samples: ReturnType<typeof HealthSample.parse>[] = [];
  const predictions: ReturnType<typeof HealthPrediction.parse>[] = [];
  const falls: ReturnType<typeof HealthFall.parse>[] = [];
  for (let index = 0; index < drops; index++) {
    const before = sample(10 + index * 20, maximum - index * 5, 69);
    samples.push(before);
    const prediction = HealthPrediction.parse({
      sequence: ++sequence,
      serverTick: before.serverTick,
      sourceSequence: before.sequence,
      arrivalTick: before.serverTick + 15,
      damage: 5,
      effectiveHealth: before.health,
      affordable: true,
      noSprint: kit === "juggernaut",
      waypoint: [25.5, 65, 6.5],
      fallDistance: before.traversal.fallDistance,
    });
    predictions.push(prediction);
    const after = sample(before.serverTick + 10, before.health - 5, 65);
    samples.push(after);
    falls.push(
      HealthFall.parse({
        sequence: ++sequence,
        eventTick: after.serverTick - 1,
        observedTick: after.serverTick,
        predictionSequence: prediction.sequence,
        cancelled: false,
        damage: 5,
        before: before.health,
        after: after.health,
        beforeAbsorption: 0,
        afterAbsorption: 0,
        fallDistance: 8,
        noDamageTicks: 0,
        snapshotHealth: after.health,
        hurtTick: after.serverTick,
      }),
    );
  }
  if (refused) {
    const source = sample(10 + drops * 20, maximum - drops * 5, 73);
    samples.push(source);
    predictions.push(
      HealthPrediction.parse({
        sequence: ++sequence,
        serverTick: source.serverTick,
        sourceSequence: source.sequence,
        arrivalTick: source.serverTick + 15,
        damage: 5,
        effectiveHealth: source.health,
        affordable: false,
        noSprint: kit === "juggernaut",
        waypoint: [25.5, 65, 6.5],
        fallDistance: 0,
      }),
    );
  }
  const last = samples.at(-1);
  if (last === undefined) throw new Error("Test native captures missing");
  const details = {
    difficulty: "HARD",
    foodLevel: "7",
    saturation: "0.0",
    originalDifficulty: "NORMAL",
    originalFoodLevel: "20",
    originalSaturation: "5.0",
    directHealthChange: "false",
    source: "explicit-controlled-diagnostic-environment",
  };
  const restored = {
    sequence: ++sequence,
    serverTick: last.serverTick,
    kind: "environment-restored",
    details: {
      ...details,
      difficulty: "NORMAL",
      foodLevel: "20",
      saturation: "5.0",
    },
  };
  samples.push({
    ...last,
    sequence: ++sequence,
    foodLevel: 20,
    saturation: 5,
    difficulty: "NORMAL",
  });
  return HealthStatus.parse({
    version: 3,
    kind: "controlled-route-diagnostic",
    humanDemonstration: false,
    scenario:
      kit === "juggernaut"
        ? "juggernaut-health"
        : refused
          ? "trooper-risk-refusal"
          : "trooper-affordable",
    state: refused ? "refused" : "closed",
    ...identity,
    samples,
    predictions,
    falls,
    setups: [
      { sequence: 1, serverTick: 10, kind: "environment-control", details },
      restored,
    ],
    regains: [],
  });
}

describe("captured accumulated fall distance", () => {
  it("requires actual accumulated fall metadata and binds it to the risk source", () => {
    for (const invalid of [undefined, -1, Number.NaN, Number.POSITIVE_INFINITY])
      expect(() =>
        HealthCapabilities.parse({ ...traversal, fallDistance: invalid }),
      ).toThrow();
    const original = fixture();
    const airborne = {
      ...original,
      samples: original.samples.map((sample, index) =>
        index === 0
          ? {
              ...sample,
              onGround: false,
              position: [22.5, 69, 6.5],
              velocity: [0, -0.6, 0],
              fallDistance: 4,
              traversal: { ...sample.traversal, fallDistance: 4 },
            }
          : sample,
      ),
      predictions: original.predictions.map((prediction) => ({
        ...prediction,
        fallDistance: 4,
      })),
    };
    expect(summarizeHealth(airborne).nativeFalls).toBe(1);
    expect(() =>
      summarizeHealth({
        ...airborne,
        samples: airborne.samples.map((sample, index) =>
          index === 0
            ? {
                ...sample,
                traversal: { ...sample.traversal, fallDistance: 0 },
              }
            : sample,
        ),
      }),
    ).toThrow(/Captured fall distance/);
    expect(() =>
      summarizeHealth({
        ...airborne,
        predictions: original.predictions.map((planned) => ({
          ...planned,
          fallDistance: 0,
        })),
      }),
    ).toThrow(/prediction/);
  });

  it("rejects a ground fall supported only by a zero-prefix pre-placement prediction", () => {
    const original = fixture();
    const missing = {
      ...original,
      samples: original.samples.map((sample, index) =>
        index === 0
          ? {
              ...sample,
              fallDistance: 0,
              traversal: { ...sample.traversal, fallDistance: 0 },
            }
          : sample,
      ),
      predictions: original.predictions.map((planned) => ({
        ...planned,
        fallDistance: 0,
      })),
    };
    expect(() => summarizeHealth(missing)).toThrow(
      /positive captured accumulated-fall/,
    );
  });
});

describe("passive native healing observations", () => {
  it("rejects an uncontrolled prediction and any HP change during restoration", () => {
    const original = fixture();
    expect(() =>
      summarizeHealth({
        ...original,
        predictions: original.predictions.map((row) => ({
          ...row,
          sequence: 0,
        })),
        falls: original.falls.map((row) => ({ ...row, predictionSequence: 0 })),
      }),
    ).toThrow(/Native trials/);
    expect(() =>
      summarizeHealth({
        ...original,
        samples: original.samples.map((sample, index) =>
          index === original.samples.length - 1
            ? { ...sample, health: sample.health + 1 }
            : sample,
        ),
      }),
    ).toThrow(/Health changed while restoring/);
  });

  it("requires the controlled native captures and exact reversible environment receipts", () => {
    const original = fixture();
    expect(summarizeHealth(original).nativeRegains).toBe(0);
    for (const kind of ["environment-control", "environment-restored"])
      expect(() =>
        summarizeHealth({
          ...original,
          setups: original.setups.filter((setup) => setup.kind !== kind),
        }),
      ).toThrow(/environment/);
    for (const changed of [
      { difficulty: "PEACEFUL" },
      { foodLevel: "20" },
      { saturation: "5.0" },
      { originalDifficulty: "HARD" },
      { originalFoodLevel: "7" },
      { originalSaturation: "0.0" },
      { directHealthChange: "true" },
    ])
      expect(() =>
        summarizeHealth({
          ...original,
          setups: original.setups.map((setup) =>
            setup.kind === "environment-control"
              ? { ...setup, details: { ...setup.details, ...changed } }
              : setup,
          ),
        }),
      ).toThrow();
    expect(() =>
      summarizeHealth({
        ...original,
        samples: original.samples.map((sample, index) =>
          index === 0 ? { ...sample, difficulty: "PEACEFUL" } : sample,
        ),
      }),
    ).toThrow(/Native captures/);
    expect(() =>
      summarizeHealth({
        ...original,
        samples: original.samples.slice(0, -1),
      }),
    ).toThrow(/Native captures/);
  });

  it("binds passive regain causes and nutrition to the exact before and next-tick captures", () => {
    const original = fixture();
    const landing = original.samples.at(-1);
    if (landing === undefined) throw new Error("Test landing capture missing");
    const source = { ...landing, sequence: 12, serverTick: 21 };
    const result = { ...source, sequence: 13, serverTick: 22, health: 16 };
    const regain = HealthRegain.parse({
      sequence: 14,
      eventTick: 21,
      observedTick: 22,
      sourceSequence: 12,
      resultSequence: 13,
      reason: "SATIATED",
      amount: 1,
      cancelled: false,
      before: 15,
      after: 16,
      foodLevel: 20,
      saturation: 5,
      difficulty: "NORMAL",
    });
    const receipt = {
      ...original,
      samples: [...original.samples, source, result],
      regains: [regain],
    };
    expect(inspectNativeRegains(receipt)).toHaveLength(1);
    expect(() => summarizeHealth(receipt)).toThrow(/native healing/);
    for (const change of [
      { sourceSequence: 999 },
      { resultSequence: 999 },
      { observedTick: 21 },
      { before: 14 },
      { after: 17 },
      { foodLevel: 19 },
      { saturation: 0 },
      { difficulty: "PEACEFUL" },
    ])
      expect(() =>
        inspectNativeRegains({
          ...receipt,
          regains: [{ ...regain, ...change }],
        }),
      ).toThrow();
    expect(
      inspectNativeRegains({
        ...receipt,
        samples: [...original.samples, source, { ...result, health: 15 }],
        regains: [{ ...regain, cancelled: true, after: 15 }],
      }),
    ).toHaveLength(1);
  });

  it("requires actual bounded nutrition and difficulty instead of assuming normal regeneration", () => {
    const sample = fixture().samples[0];
    if (sample === undefined) throw new Error("Test capture missing");
    for (const invalid of [
      { foodLevel: undefined },
      { foodLevel: -1 },
      { foodLevel: 21 },
      { saturation: Number.NaN },
      { saturation: -1 },
      { difficulty: "UNKNOWN" },
    ])
      expect(() => HealthSample.parse({ ...sample, ...invalid })).toThrow();
    expect(() => HealthStatus.parse({ ...fixture(), version: 1 })).toThrow();
  });
});

describe("joined RWF native health evidence contract", () => {
  it("pins five diagnostic cases without claiming human or autonomous evidence", () => {
    expect(healthContract.scenarios).toHaveLength(5);
    expect(summarizeHealth(fixture())).toMatchObject({
      nativeFalls: 1,
      finalHealth: 15,
      humanDemonstration: false,
      autonomousRoutingVerified: false,
    });
    for (const state of ["idle", "bound", "observing", "failed"])
      expect(() => summarizeHealth({ ...fixture(), state })).toThrow(
        /terminal/,
      );
  });

  it("requires deferred actual damage and the same captured body/risk prediction", () => {
    const original = fixture();
    const fall = original.falls[0];
    const prediction = original.predictions[0];
    if (fall === undefined || prediction === undefined)
      throw new Error("Test evidence missing");
    for (const changed of [
      { ...fall, observedTick: fall.eventTick },
      { ...fall, snapshotHealth: 20 },
      { ...fall, cancelled: true },
      { ...fall, hurtTick: fall.eventTick },
      { ...fall, predictionSequence: 999 },
    ])
      expect(() =>
        summarizeHealth({ ...original, falls: [changed] }),
      ).toThrow();
    for (const changed of [
      { ...prediction, sourceSequence: 999 },
      { ...prediction, effectiveHealth: 19 },
      { ...prediction, damage: 4 },
      { ...prediction, noSprint: true },
    ])
      expect(() =>
        summarizeHealth({ ...original, predictions: [changed] }),
      ).toThrow();
  });

  it("keeps real Juggernaut maximum30, five native drops and sprint restrictions", () => {
    const juggernaut = fixture("juggernaut", 5, true);
    expect(summarizeHealth(juggernaut)).toMatchObject({
      maximumHealth: 30,
      nativeFalls: 5,
      finalHealth: 5,
      riskRefused: true,
    });
    expect(juggernaut.falls[0]).toMatchObject({ before: 30, after: 25 });
    expect(() =>
      summarizeHealth({
        ...juggernaut,
        samples: juggernaut.samples.map((sample) => ({
          ...sample,
          sprinting: true,
        })),
      }),
    ).toThrow();
    expect(() =>
      summarizeHealth({
        ...juggernaut,
        samples: juggernaut.samples.map((sample) => ({
          ...sample,
          maxHealth: 20,
        })),
      }),
    ).toThrow();
  });

  it("requires water occupancy and rejects damage hidden by a water label", () => {
    const original = fixture();
    const water = {
      ...original,
      scenario: "water-landing",
      falls: [],
      samples: original.samples.map((sample, index) => ({
        ...sample,
        health: 20,
        inWater: index === 1,
      })),
      predictions: original.predictions.map((prediction) => ({
        ...prediction,
        damage: 0,
      })),
    };
    expect(summarizeHealth(water).nativeFalls).toBe(0);
    expect(() =>
      summarizeHealth({ ...water, falls: original.falls }),
    ).toThrow();
  });

  it("requires three real Trooper drops then refuses the fourth with oneHP reserved", () => {
    const refused = fixture("trooper", 3, true);
    expect(summarizeHealth(refused)).toMatchObject({
      nativeFalls: 3,
      finalHealth: 5,
      riskRefused: true,
    });
    const prediction = refused.predictions.at(-1);
    if (prediction === undefined) throw new Error("Test prediction missing");
    expect(() =>
      summarizeHealth({
        ...refused,
        predictions: [
          ...refused.predictions.slice(0, -1),
          { ...prediction, affordable: true },
        ],
      }),
    ).toThrow();
  });

  it("requires native captured protection expiry between two actual falls", () => {
    const original = fixture("trooper", 2);
    const protectedTrial = {
      ...original,
      scenario: "protection-expiry",
      samples: original.samples.map((sample, index) => ({
        ...sample,
        serverTick: sample.serverTick + (index >= 2 ? 100 : 0),
        lastHurtTick:
          sample.lastHurtTick < 0
            ? -1
            : sample.lastHurtTick + (index >= 2 ? 100 : 0),
        health: sample.health + (index > 0 ? 1 : 0),
        traversal: {
          ...sample.traversal,
          resistanceAmplifier: index < 2 ? 0 : -1,
          resistanceUntilTick: index < 2 ? 90 : -1,
        },
      })),
      predictions: original.predictions.map((prediction, index) => ({
        ...prediction,
        serverTick: prediction.serverTick + index * 100,
        arrivalTick: prediction.arrivalTick + index * 100,
        damage: index === 0 ? 4 : 5,
        effectiveHealth: prediction.effectiveHealth + index,
      })),
      falls: original.falls.map((fall, index) => ({
        ...fall,
        eventTick: fall.eventTick + index * 100,
        observedTick: fall.observedTick + index * 100,
        hurtTick: fall.hurtTick + index * 100,
        damage: index === 0 ? 4 : 5,
        before: fall.before + index,
        after: fall.after + 1,
        snapshotHealth: fall.snapshotHealth + 1,
      })),
      setups: [
        ...original.setups.map((setup) => ({
          ...setup,
          serverTick:
            setup.serverTick +
            (setup.kind === "environment-restored" ? 100 : 0),
        })),
        {
          sequence: 0,
          serverTick: 10,
          kind: "effect-add",
          details: { effect: "resistance", durationTicks: "80" },
        },
        {
          sequence: 12,
          serverTick: 140,
          kind: "effect-expired",
          details: { effect: "resistance" },
        },
      ],
    };
    expect(summarizeHealth(protectedTrial)).toMatchObject({
      nativeFalls: 2,
      finalHealth: 11,
    });
    expect(() =>
      summarizeHealth({
        ...protectedTrial,
        setups: protectedTrial.setups.filter(
          (setup) => setup.kind !== "effect-expired",
        ),
      }),
    ).toThrow(/protection/);
  });
});
