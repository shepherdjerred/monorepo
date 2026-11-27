/**
 * The viewer's team's gold lead over the other team at each timeline frame.
 * Positive is ahead, negative is behind. A frame is one point, so a standard
 * game has one per minute plus the closing frame.
 */
export type GoldLeadPoint = {
  timestampMs: number;
  minute: number;
  leadGold: number;
};

export type GoldLead = {
  /** The team the lead is measured for. */
  teamId: number;
  points: GoldLeadPoint[];
};

type GoldFrame = {
  readonly frame_timestamp_ms: number;
  readonly participant_id: number;
  readonly total_gold: number;
};

/**
 * `null` unless exactly two teams played and every frame belongs to a rostered
 * participant; Arena and games without a timeline have no lead to draw.
 */
export function buildGoldLead(options: {
  frames: readonly GoldFrame[];
  teamByParticipant: ReadonlyMap<number, number>;
  viewerTeamId: number;
}): GoldLead | null {
  const teams = new Set(options.teamByParticipant.values());
  if (teams.size !== 2 || !teams.has(options.viewerTeamId)) return null;
  if (options.frames.length === 0) return null;
  const byTimestamp = new Map<number, { own: number; other: number }>();
  for (const frame of options.frames) {
    const teamId = options.teamByParticipant.get(frame.participant_id);
    // A frame for a participant the roster does not state cannot be placed on
    // either side, so the lead is not computable.
    if (teamId === undefined) return null;
    const totals = byTimestamp.get(frame.frame_timestamp_ms) ?? {
      own: 0,
      other: 0,
    };
    if (teamId === options.viewerTeamId) totals.own += frame.total_gold;
    else totals.other += frame.total_gold;
    byTimestamp.set(frame.frame_timestamp_ms, totals);
  }
  return {
    teamId: options.viewerTeamId,
    points: [...byTimestamp.entries()]
      .toSorted(([left], [right]) => left - right)
      .map(([timestampMs, totals]) => ({
        timestampMs,
        minute: Math.floor(timestampMs / 60_000),
        leadGold: totals.own - totals.other,
      })),
  };
}
