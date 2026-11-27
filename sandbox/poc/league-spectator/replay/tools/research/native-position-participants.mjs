/** Bind the independently verified opening actor contexts to original footer rows. */
export function bindNativeSceneParticipants(identity, observations) {
  if (
    observations.build !== identity.build ||
    observations.protocol !== identity.protocol ||
    observations.duration * 1000 !== identity.durationMilliseconds ||
    observations.roster.length !== identity.participantCount
  )
    throw Error("Prepared observation identity mismatch");

  const rows = new Map(),
    contexts = new Set();
  for (const { context, footerRow } of observations.binding.verified) {
    if (
      !Number.isSafeInteger(context) ||
      context < 0 ||
      contexts.has(context) ||
      !Number.isInteger(footerRow) ||
      footerRow < 1 ||
      footerRow > identity.participantCount ||
      rows.has(footerRow)
    )
      throw Error("Invalid or ambiguous verified footer binding");
    rows.set(footerRow, context);
    contexts.add(context);
  }
  if (
    rows.size !== identity.participantCount ||
    observations.binding.unresolved.length
  )
    throw Error(
      "Every scene participant requires an unambiguous verified binding",
    );

  const participants = [...rows]
    .sort(([a], [b]) => a - b)
    .map(([row, participantId]) => {
      const { champion, team } = observations.roster[row - 1];
      if (
        typeof champion !== "string" ||
        !champion ||
        ![100, 200].includes(team)
      )
        throw Error("Verified champion/team metadata required");
      return {
        participantId,
        name: champion,
        championName: champion,
        teamId: team,
      };
    });
  return { rows, participants };
}
