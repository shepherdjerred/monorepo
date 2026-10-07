import type { regressionJournal } from "#learning/native/regression-gate.ts";

type Journal = ReturnType<typeof regressionJournal>;

/** Requires an original learned sword command to cause native damage to the joined player. */
export function humanCombat(journal: Journal) {
  const first = journal.transitions.find((row) => row.phase === "LIVE");
  if (
    first?.fighters.length !== 8 ||
    first.fighters.filter((row) => !row.bot).length !== 1 ||
    first.fighters.some((row) => row.kit !== "trooper")
  )
    throw new Error(
      "Human combat needs its original one-player, seven-Trooper roster",
    );
  const player = first.fighters.find((row) => !row.bot);
  if (player === undefined) throw new Error("Original joined player missing");
  const probes = journal.probes;
  if (
    probes.length === 0 ||
    probes.some(
      (row) =>
        row.player !== player.body ||
        row.gameMode !== "SURVIVAL" ||
        row.invulnerable ||
        !row.playerAlive ||
        !row.botAlive ||
        row.botKit !== "trooper" ||
        Math.abs(
          Math.hypot(row.playerX - row.botX, row.playerZ - row.botZ) - 1.75,
        ) > 1e-7 ||
        Math.abs(row.playerY - row.botY) > 1e-7,
    )
  )
    throw new Error(
      "Human combat lacks original vulnerable player contact probes",
    );
  const offered = new Set(probes.map((row) => row.bot));
  const attacks = journal.actions.filter(
    (row) =>
      row.decision === "applied" &&
      row.targetBody === player.body &&
      row.ticket?.action.attack === true &&
      offered.has(row.body),
  );
  const hits = journal.damage.filter(
    (row) =>
      row.victim === player.body &&
      row.cause === "ENTITY_ATTACK" &&
      row.cancelled &&
      row.before > row.after &&
      attacks.some(
        (action) =>
          action.body === row.attacker &&
          action.serverTick === row.serverTick &&
          action.sequence < row.sequence &&
          probes.some(
            (probe) =>
              probe.bot === row.attacker && probe.sequence < action.sequence,
          ),
      ),
  );
  if (attacks.length === 0 || hits.length === 0)
    throw new Error(
      "Human combat lacks actual joined-player damage from its applied Java sword action",
    );
  return {
    player: player.body,
    contactProbes: probes.length,
    appliedPlayerAttacks: attacks.length,
    confirmedPlayerHits: hits.length,
    actualPlayerDamage: hits.reduce(
      (sum, row) => sum + row.before - row.after,
      0,
    ),
  };
}
