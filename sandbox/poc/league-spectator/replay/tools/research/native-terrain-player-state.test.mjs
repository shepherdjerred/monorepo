import assert from "node:assert/strict";
import test from "node:test";
import { readCurrentRecordedPlayerState } from "./native-terrain-player-state.mjs";

function recordedState() {
  const firstContext = 0x40000000;
  const verified = Array.from({ length: 10 }, (_, index) => ({
    context: firstContext + index,
    footerRow: index + 1,
  }));
  const actors = verified.map((actor, index) => ({
    ...actor,
    footerRow: index === 4 ? null : actor.footerRow,
    level: index === 4 ? 2 : 1,
  }));
  const level = {
    ...actors[4],
    kind: "actor-level",
    timeSeconds: 6,
    secondTimeBits: 10,
  };
  const events = [
    { kind: "champion-kill", context: firstContext, partition: 0 },
    { kind: "champion-death", context: firstContext + 5, partition: 1 },
  ].map((entry) => ({ ...entry, timeSeconds: 2, secondTimeBits: 8 }));
  const binding = { verified, unresolved: [], events, assists: [] };
  const observations = {
    duration: 10,
    roster: actors.map((_, index) => ({
      champion: `Champion${index}`,
      team: index < 5 ? 100 : 200,
    })),
    binding: {
      ...binding,
      verified: verified.filter(({ footerRow }) => footerRow !== 5),
      unresolved: [level.context],
    },
    levels: { initialLevel: 1, finalLevels: actors, events: [level] },
    returns: [{ ...events[1], kind: "champion-return", timeSeconds: 4 }],
  };
  const footer = new TextEncoder().encode(
    JSON.stringify({
      statsJson: JSON.stringify(
        actors.map(({ level }) => ({ LEVEL: String(level) })),
      ),
    }),
  );
  const bytes = new Uint8Array(271 + footer.length + 4);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 0x52494f54);
  view.setUint16(4, 2, true);
  bytes.set(footer, 271);
  view.setUint32(bytes.length - 4, footer.length, true);
  return { replay: { bytes, winningTeam: 100 }, observations, binding };
}

test("projects combat, level, and return clocks after resolving an opening identity", () => {
  const { replay, observations, binding } = recordedState();
  const { playerState, championEliminations, winningTeam } =
    readCurrentRecordedPlayerState(replay, observations, binding);
  const { checkpoints } = playerState;
  assert.deepEqual(
    checkpoints.map(({ timeSeconds }) => timeSeconds),
    [0, 2, 4, 6],
  );
  assert.equal(checkpoints[1].players[0].kills, 1);
  assert.equal(checkpoints[1].players[5].alive, false);
  assert.equal(checkpoints[2].players[5].alive, true);
  assert.equal(checkpoints[3].players[4].level, 2);
  assert.equal(championEliminations.length, 1);
  assert.equal(winningTeam, 100);
});

test("rejects incomplete player evidence and a level that disagrees with its footer", () => {
  const { replay, observations, binding } = recordedState();
  assert.throws(
    () =>
      readCurrentRecordedPlayerState(
        replay,
        { ...observations, returns: null },
        binding,
      ),
    /complete levels/,
  );
  observations.levels.finalLevels[4].level = 3;
  assert.throws(
    () => readCurrentRecordedPlayerState(replay, observations, binding),
    /level disagrees/,
  );
});
