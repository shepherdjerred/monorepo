import type { RegressionSample } from "#learning/native/regression-client.ts";

export function liveOpponents(
  state: RegressionSample,
  victimKit: "trooper" | "any",
) {
  const first = state.transitions.find((row) => row.phase === "LIVE");
  const attacker = first?.fighters.find(
    (row) => row.bot && row.alive && row.kit === "trooper",
  );
  const victim = first?.fighters.find(
    (row) =>
      row.bot &&
      row.alive &&
      row.team !== attacker?.team &&
      (victimKit === "any" || row.kit === "trooper"),
  );
  if (first === undefined || attacker === undefined || victim === undefined)
    throw new Error("Original live draft lacks opposing fighters");
  return { first, attacker, victim };
}
