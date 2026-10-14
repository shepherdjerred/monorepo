/** Explicit synthetic metadata for behavior and qualification boundary tests only. */
export const authoredExperienceFixture = {
  description: "difficulty=hard;style=varied;variety=high;maps=;kits=",
  readout:
    "Current game: hard difficulty, varied style, high variety. Maps: all; kits: all.",
};

export const capacityFeatureReceiptFixture = {
  source: "private-flipt-test-double",
  appliesBeforeBoot: true,
  configuredAt: 1_700_000_000_000,
  previous: [],
  enabled: [
    "the-storm-rwf-match-flow-enabled",
    "the-storm-rwf-host-settings-enabled",
    "the-storm-rwf-candidate-visits-enabled",
  ],
  evaluations: [
    ["the-storm-rwf-match-flow-enabled", true],
    ["the-storm-rwf-carry-over-enabled", false],
    ["the-storm-rwf-death-feed-enabled", false],
    ["the-storm-rwf-team-chat-enabled", false],
    ["the-storm-rwf-spectator-tools-enabled", false],
    ["the-storm-rwf-bomb-effects-enabled", false],
    ["the-storm-rwf-stats-enabled", false],
    ["the-storm-rwf-host-settings-enabled", true],
    ["the-storm-rwf-candidate-visits-enabled", true],
  ].map(([key, enabled]) => ({ key, enabled })),
};

export function capacityBehaviorFixture(
  match: string,
  total: number,
  map: string,
) {
  const human = "00000000-0000-4000-8000-000000000001";
  const bots = Array.from(
    { length: total - 1 },
    (_, index) =>
      `00000000-0000-4000-8000-${(index + 2).toString().padStart(12, "0")}`,
  );
  const experience = `experience-v1;seed=1;${authoredExperienceFixture.description}`;
  return {
    version: 1,
    kind: "rwf-capacity-behavior",
    serverTick: 100,
    match,
    phase: "LIVE",
    map,
    experience,
    experienceFingerprint: new Bun.CryptoHasher("sha256")
      .update(experience)
      .digest("hex"),
    host: {
      match,
      enabled: true,
      host: human,
      locked: true,
      selectedDifficulty: "NORMAL",
      currentDifficulty: "NORMAL",
    },
    humans: [human],
    bots,
    profiles: bots.map((body, index) => ({
      body,
      personality: `fixture-${index.toString()}`,
      levers: {
        reactionMs: 250,
        aimErrorDeg: 3,
        turnRateDegPerTick: 20,
        cps: 8,
        predictionQuality: 0.5,
        decisionTemperature: 0.5,
        awarenessRadius: 40,
        coordination: 0.5,
        technique: 0.5,
        aggression: 0.5,
      },
      style: { aggression: 0.5, patience: 0.5, teamplay: 0.5, risk: 0.5 },
    })),
  };
}
